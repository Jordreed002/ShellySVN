/**
 * Settings import / export / reset (#89).
 *
 * Export writes a versioned envelope (`shellysvn-settings-export`, v1) as JSON
 * through the native save dialog + `window.api.fs.writeFile`, exactly like
 * `lib/logExport.ts`. Secret-bearing fields (saved credentials, the proxy
 * password) never leave the app: they are dropped or blanked before
 * serialization.
 *
 * Import is defensive by construction: hostile JSON parses inside a try/catch,
 * only known AppSettings keys survive, values must type-check against the
 * defaults, prototype-poisoning keys are skipped, and arrays are length-capped.
 * Unknown keys are reported back to the UI instead of crashing it.
 */

import type { AppSettings, AppSettingsExport } from '@shared/types';
import { DEFAULT_SETTINGS, mergeSettings } from '@shared/settings-defaults';

export const SETTINGS_EXPORT_FORMAT = 'shellysvn-settings-export';
export const SETTINGS_EXPORT_VERSION = 1;

/** Keys never written to an export: secret material (savedCredentials). */
const REDACTED_KEYS = ['savedCredentials'] as const;
/** Nested secret fields exported as empty strings instead of their values. */
const BLANKED_NESTED_SECRETS = new Set(['password']);
/** Hard cap so a hostile file cannot inject a multi-megabyte array. */
const MAX_IMPORTED_ARRAY_LENGTH = 500;
/** Cap on how many unknown keys are reported (the count keeps going up). */
const MAX_REPORTED_UNKNOWN_KEYS = 20;

export interface SettingsImportResult {
  ok: boolean;
  /** Merged settings — present only when `ok` is true. */
  settings?: AppSettings;
  /** Top-level keys present in the file but unknown to this app version. */
  unknownKeys: string[];
  /** Human-readable notes (skipped bad values, redactions, leniency). */
  warnings: string[];
  /** Fatal problem (bad JSON, wrong envelope, nothing importable). */
  error?: string;
  importedKeyCount: number;
}

export interface SettingsFileExportResult {
  status: 'saved' | 'cancelled' | 'copied' | 'failed';
  path?: string;
  message: string;
  content: string;
}

export type SettingsFileImportResult =
  | { status: 'cancelled' }
  | { status: 'read'; content: string }
  | { status: 'failed'; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Keys we refuse to copy from untrusted input, ever. */
function isUnsafeKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

const SKIP = Symbol('settings-import-skip');

type WarningSink = (message: string) => void;

function sanitizeValue(
  defaultValue: unknown,
  value: unknown,
  path: string,
  warn: WarningSink
): typeof SKIP | unknown {
  if (isPlainObject(defaultValue) && isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (isUnsafeKey(key)) continue;
      if (!(key in defaultValue)) continue;
      const sanitized = sanitizeValue(defaultValue[key], nested, `${path}.${key}`, warn);
      if (sanitized !== SKIP) out[key] = sanitized;
    }
    return out;
  }
  if (Array.isArray(defaultValue)) {
    if (!Array.isArray(value)) {
      warn(`Skipped "${path}": expected a list.`);
      return SKIP;
    }
    if (value.length > MAX_IMPORTED_ARRAY_LENGTH) {
      warn(`Truncated "${path}" to ${MAX_IMPORTED_ARRAY_LENGTH} entries.`);
      return value.slice(0, MAX_IMPORTED_ARRAY_LENGTH);
    }
    return [...value];
  }
  const expected = typeof defaultValue;
  if (expected === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    warn(`Skipped "${path}": expected a number.`);
    return SKIP;
  }
  if (typeof value === expected) return value;
  warn(`Skipped "${path}": expected ${expected}.`);
  return SKIP;
}

/**
 * Remove secret-bearing data before it is serialized: `savedCredentials` is
 * dropped entirely and nested `password` fields are blanked.
 */
export function redactSettingsForExport(settings: AppSettings): Partial<AppSettings> {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if ((REDACTED_KEYS as readonly string[]).includes(key)) continue;
    clone[key] = isPlainObject(value) ? redactNested(value) : value;
  }
  return clone as Partial<AppSettings>;
}

function redactNested(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] =
      BLANKED_NESTED_SECRETS.has(key) && typeof nested === 'string'
        ? ''
        : isPlainObject(nested)
          ? redactNested(nested)
          : nested;
  }
  return out;
}

export function serializeSettingsExport(
  settings: AppSettings,
  options?: { appVersion?: string; exportedAt?: Date }
): string {
  const payload: AppSettingsExport = {
    format: SETTINGS_EXPORT_FORMAT,
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: (options?.exportedAt ?? new Date()).toISOString(),
    ...(options?.appVersion ? { appVersion: options.appVersion } : {}),
    settings: redactSettingsForExport(settings),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function defaultSettingsExportFileName(now?: Date): string {
  const day = (now ?? new Date()).toISOString().slice(0, 10);
  return `shellysvn-settings-${day}.json`;
}

/**
 * Validate an imported payload (raw JSON string or pre-parsed value).
 * Anything hostile degrades to `{ ok: false, error }` or skipped keys with
 * warnings — this function never throws.
 */
export function parseSettingsImport(input: string | unknown): SettingsImportResult {
  const unknownKeys: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      return { ok: false, unknownKeys, warnings, error: 'The file is empty.', importedKeyCount: 0 };
    }
    if (trimmed.length > 5_000_000) {
      return {
        ok: false,
        unknownKeys,
        warnings,
        error: 'The file is too large to be a settings export.',
        importedKeyCount: 0,
      };
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        ok: false,
        unknownKeys,
        warnings,
        error: 'The file is not valid JSON.',
        importedKeyCount: 0,
      };
    }
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      unknownKeys,
      warnings,
      error: 'Expected a settings export object.',
      importedKeyCount: 0,
    };
  }

  let settingsRecord: unknown;
  if (parsed.format === SETTINGS_EXPORT_FORMAT) {
    if (parsed.version !== SETTINGS_EXPORT_VERSION) {
      warnings.push(
        `Export version ${String(parsed.version)} differs from the supported version ${SETTINGS_EXPORT_VERSION}; importing anyway.`
      );
    }
    settingsRecord = parsed.settings;
  } else {
    warnings.push('Missing settings-export envelope; treating the file as a bare settings object.');
    settingsRecord = parsed;
  }

  if (!isPlainObject(settingsRecord)) {
    return {
      ok: false,
      unknownKeys,
      warnings,
      error: 'The export contains no settings object.',
      importedKeyCount: 0,
    };
  }

  const defaultsRecord = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settingsRecord)) {
    if (isUnsafeKey(key)) continue;
    if (!(key in defaultsRecord)) {
      if (unknownKeys.length < MAX_REPORTED_UNKNOWN_KEYS) unknownKeys.push(key);
      continue;
    }
    const result = sanitizeValue(defaultsRecord[key], value, key, (message) =>
      warnings.push(message)
    );
    if (result !== SKIP) sanitized[key] = result;
  }

  if (unknownKeys.length > MAX_REPORTED_UNKNOWN_KEYS) {
    warnings.push(`${unknownKeys.length} unknown keys were skipped in total.`);
  }
  if ((REDACTED_KEYS as readonly string[]).some((key) => key in sanitized)) {
    // Defensive: the sanitizer copies from DEFAULT_SETTINGS' shape, which has
    // no reason to contain these — but never allow them through regardless.
    for (const key of REDACTED_KEYS) delete sanitized[key];
  }

  if (Object.keys(sanitized).length === 0) {
    return {
      ok: false,
      unknownKeys,
      warnings,
      error: 'None of the keys in the file are recognized settings.',
      importedKeyCount: 0,
    };
  }

  return {
    ok: true,
    settings: mergeSettings(sanitized as unknown as Partial<AppSettings>),
    unknownKeys,
    warnings,
    importedKeyCount: Object.keys(sanitized).length,
  };
}

/**
 * Reset the given top-level settings keys to their defaults, leaving the rest
 * of `settings` untouched. Returned copies are deep-cloned so the shared
 * DEFAULT_SETTINGS nested objects are never handed out mutably.
 */
export function applySectionReset(
  settings: AppSettings,
  keys: readonly (keyof AppSettings)[]
): AppSettings {
  const next: Record<string, unknown> = { ...settings };
  for (const key of keys) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    const value = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
    next[key as string] = isPlainObject(value) || Array.isArray(value)
      ? (JSON.parse(JSON.stringify(value)) as unknown)
      : value;
  }
  return next as unknown as AppSettings;
}

async function copyToClipboard(content: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch {
    return false;
  }
}

/** Export settings through the native save dialog; falls back to the clipboard. */
export async function exportSettingsToFile(
  settings: AppSettings,
  options?: { appVersion?: string; defaultName?: string; exportedAt?: Date }
): Promise<SettingsFileExportResult> {
  const content = serializeSettingsExport(settings, options);
  const defaultName =
    options?.defaultName ?? defaultSettingsExportFileName(options?.exportedAt);

  const saveFile = window.api?.dialog?.saveFile?.bind(window.api.dialog);
  const writeFile = window.api?.fs?.writeFile?.bind(window.api.fs);

  if (saveFile && writeFile) {
    try {
      const target = await saveFile(defaultName);
      if (!target) {
        return { status: 'cancelled', message: 'Export cancelled', content };
      }
      const result = await writeFile(target, content);
      if (result.success) {
        return { status: 'saved', path: target, message: `Saved ${target}`, content };
      }
      throw new Error(result.error || 'Writing the export file failed');
    } catch {
      // fall through to the clipboard fallback below
    }
  }

  const copied = await copyToClipboard(content);
  if (copied) {
    return {
      status: 'copied',
      message: 'File save unavailable — settings JSON copied to clipboard instead',
      content,
    };
  }
  return {
    status: 'failed',
    message: 'Export failed: could not write a file or reach the clipboard',
    content,
  };
}

/** Ask for a settings export file and read it. Never throws. */
export async function readSettingsImportFile(): Promise<SettingsFileImportResult> {
  const openFile = window.api?.dialog?.openFile?.bind(window.api.dialog);
  const readFile = window.api?.fs?.readFile?.bind(window.api.fs);
  if (!openFile || !readFile) {
    return { status: 'failed', message: 'File dialogs are unavailable in this environment.' };
  }
  let path: string | null = null;
  try {
    path = await openFile([{ name: 'Settings export', extensions: ['json'] }]);
  } catch {
    return { status: 'failed', message: 'Could not open the file picker.' };
  }
  if (!path) return { status: 'cancelled' };
  try {
    const result = await readFile(path);
    if (!result.success || typeof result.content !== 'string') {
      return { status: 'failed', message: result.error || 'Could not read the selected file.' };
    }
    return { status: 'read', content: result.content };
  } catch {
    return { status: 'failed', message: 'Could not read the selected file.' };
  }
}
