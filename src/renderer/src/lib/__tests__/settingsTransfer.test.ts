import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, mergeSettings } from '@shared/settings-defaults';
import type { AppSettings } from '@shared/types';

import {
  applySectionReset,
  defaultSettingsExportFileName,
  parseSettingsImport,
  redactSettingsForExport,
  serializeSettingsExport,
  SETTINGS_EXPORT_FORMAT,
} from '../settingsTransfer';

function sampleSettings(): AppSettings {
  return mergeSettings({
    theme: 'dark',
    proxySettings: {
      enabled: true,
      host: 'proxy.internal',
      port: 3128,
      username: 'svc',
      password: 'hunter2',
      bypassForLocal: false,
    },
    savedCredentials: [
      { realm: 'https://svn.example.com', username: 'alice', password: 'secret' },
    ] as AppSettings['savedCredentials'],
    connectionTimeout: 90,
  });
}

describe('settings export', () => {
  it('writes the versioned envelope around a partial settings record', () => {
    const json = serializeSettingsExport(sampleSettings(), {
      appVersion: '1.2.3',
      exportedAt: new Date('2026-01-02T03:04:05Z'),
    });
    const parsed = JSON.parse(json) as {
      format: string;
      version: number;
      exportedAt: string;
      appVersion?: string;
      settings: Record<string, unknown>;
    };
    expect(parsed.format).toBe(SETTINGS_EXPORT_FORMAT);
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(parsed.appVersion).toBe('1.2.3');
    expect(parsed.settings.theme).toBe('dark');
  });

  it('never exports saved credentials and blanks the proxy password', () => {
    const redacted = redactSettingsForExport(sampleSettings());
    expect(redacted.savedCredentials).toBeUndefined();
    expect(redacted.proxySettings?.password).toBe('');
    expect(redacted.proxySettings?.username).toBe('svc'); // non-secret proxy fields stay
    const json = JSON.stringify(redacted);
    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('secret');
  });

  it('round-trips through parseSettingsImport', () => {
    const json = serializeSettingsExport(sampleSettings());
    const result = parseSettingsImport(json);
    expect(result.ok).toBe(true);
    expect(result.settings?.theme).toBe('dark');
    expect(result.settings?.connectionTimeout).toBe(90);
    expect(result.settings?.proxySettings?.host).toBe('proxy.internal');
    // Redacted fields fall back to defaults rather than the original secrets.
    expect(result.settings?.proxySettings?.password).toBe('');
    expect(result.importedKeyCount).toBeGreaterThan(0);
  });

  it('derives a dated default file name', () => {
    expect(defaultSettingsExportFileName(new Date('2026-08-23T00:00:00Z'))).toBe(
      'shellysvn-settings-2026-08-23.json'
    );
  });
});

describe('settings import validation', () => {
  it('reports unknown top-level keys without failing the import', () => {
    const json = JSON.stringify({
      format: SETTINGS_EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { theme: 'light', teleport: true, quantum: 'yes' },
    });
    const result = parseSettingsImport(json);
    expect(result.ok).toBe(true);
    expect(result.unknownKeys).toEqual(['teleport', 'quantum']);
    expect(result.settings?.theme).toBe('light');
  });

  it('never crashes on hostile JSON payloads', () => {
    expect(parseSettingsImport('not json {{{').ok).toBe(false);
    expect(parseSettingsImport('').ok).toBe(false);
    expect(parseSettingsImport('123').ok).toBe(false);
    expect(parseSettingsImport('null').ok).toBe(false);
    expect(parseSettingsImport('[1,2,3]').ok).toBe(false);
    expect(parseSettingsImport('"a string"').ok).toBe(false);
    expect(parseSettingsImport('true').ok).toBe(false);
  });

  it('skips wrong-typed values with a warning instead of applying them', () => {
    const result = parseSettingsImport({
      format: SETTINGS_EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        theme: 'dark',
        connectionTimeout: 'soon',
        autoRefreshInterval: null,
        globalIgnorePatterns: 'nope',
      },
    });
    expect(result.ok).toBe(true);
    expect(result.settings?.theme).toBe('dark');
    expect(result.settings?.connectionTimeout).toBe(DEFAULT_SETTINGS.connectionTimeout);
    expect(result.settings?.autoRefreshInterval).toBe(DEFAULT_SETTINGS.autoRefreshInterval);
    expect(result.settings?.globalIgnorePatterns).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes('connectionTimeout'))).toBe(true);
  });

  it('rejects prototype poisoning keys', () => {
    const hostile = JSON.parse(
      '{"format":"shellysvn-settings-export","version":1,"settings":{"theme":"dark","__proto__":{"polluted":true}}}'
    );
    const result = parseSettingsImport(hostile);
    expect(result.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(result.settings?.theme).toBe('dark');
  });

  it('truncates hostile oversized arrays', () => {
    const bigArray = Array.from({ length: 5_000 }, (_, index) => `*.ext${index}`);
    const result = parseSettingsImport({
      format: SETTINGS_EXPORT_FORMAT,
      version: 1,
      settings: { globalIgnorePatterns: bigArray },
    });
    expect(result.ok).toBe(true);
    expect(result.settings?.globalIgnorePatterns.length).toBe(500);
  });

  it('rejects payloads with no recognized settings at all', () => {
    const result = parseSettingsImport({
      format: SETTINGS_EXPORT_FORMAT,
      version: 1,
      settings: { completelyUnknown: 1, alsoUnknown: true },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('None of the keys');
    expect(result.unknownKeys).toEqual(['completelyUnknown', 'alsoUnknown']);
  });

  it('accepts a bare settings object with a leniency warning', () => {
    const result = parseSettingsImport(JSON.stringify({ theme: 'system' }));
    expect(result.ok).toBe(true);
    expect(result.settings?.theme).toBe('system');
    expect(result.warnings.some((warning) => warning.includes('envelope'))).toBe(true);
  });

  it('warns but imports when the export version differs', () => {
    const result = parseSettingsImport({
      format: SETTINGS_EXPORT_FORMAT,
      version: 99,
      settings: { theme: 'dark' },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('99'))).toBe(true);
  });

  it('drops unknown nested keys inside known groups', () => {
    const result = parseSettingsImport({
      format: SETTINGS_EXPORT_FORMAT,
      version: 1,
      settings: { proxySettings: { host: 'p', evil: 'x' } },
    });
    expect(result.ok).toBe(true);
    expect(result.settings?.proxySettings).not.toHaveProperty('evil');
  });
});

describe('reset semantics', () => {
  it('resets only the requested keys and leaves the rest untouched', () => {
    const settings = mergeSettings({ theme: 'dark', language: 'de', connectionTimeout: 120 });
    const next = applySectionReset(settings, ['theme', 'connectionTimeout']);
    expect(next.theme).toBe('system');
    expect(next.connectionTimeout).toBe(30);
    expect(next.language).toBe('de');
  });

  it('deep-copies reset values so the shared defaults stay immutable', () => {
    const next = applySectionReset(mergeSettings({ globalIgnorePatterns: ['x'] }), [
      'globalIgnorePatterns',
    ]);
    expect(next.globalIgnorePatterns).toEqual([]);
    next.globalIgnorePatterns.push('mutated');
    expect(DEFAULT_SETTINGS.globalIgnorePatterns).toEqual([]);
  });
});
