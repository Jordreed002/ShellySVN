/**
 * External diff/merge tool argument templates (#87).
 *
 * A template is a plain argument string with placeholders in braces:
 * `{mine}` `{theirs}` `{base}` `{merged}` (plus `{left}` / `{right}` accepted
 * as aliases of `{mine}` / `{theirs}`). Validation reports required-
 * placeholder errors per tool kind and warns about unknown placeholders;
 * expansion turns a template plus concrete paths into an argv array.
 */

import type { ExternalToolTemplateConfig } from '@shared/types';

export type ExternalToolKind = ExternalToolTemplateConfig['kind'];

/** Every placeholder understood by the launcher template. */
export const KNOWN_PLACEHOLDERS = ['mine', 'theirs', 'base', 'merged', 'left', 'right'] as const;

export type KnownPlaceholder = (typeof KNOWN_PLACEHOLDERS)[number];

/** Alias groups: satisfying either member satisfies the requirement. */
const REQUIRED_PLACEHOLDERS: Record<ExternalToolKind, string[][]> = {
  // A diff needs both sides.
  diff: [['mine', 'left'], ['theirs', 'right']],
  // A merge needs both sides plus the output file; {base} is optional.
  merge: [['mine', 'left'], ['theirs', 'right'], ['merged']],
};

export interface TemplateValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Requirement groups still unsatisfied (each entry lists its aliases). */
  missing: string[][];
  /** Unknown `{token}` placeholders found in the template. */
  unknown: string[];
}

/** All `{token}` occurrences, without braces, in order (duplicates kept). */
export function extractPlaceholders(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z][\w-]*)\}/g)].map((match) => match[1]);
}

function hasAny(template: string, aliases: readonly string[]): boolean {
  return aliases.some((alias) => new RegExp(`\\{${alias}\\}`).test(template));
}

/** Validate a template for the given tool kind; never throws. */
export function validateArgumentTemplate(kind: ExternalToolKind, template: string): TemplateValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missing: string[][] = [];

  for (const group of REQUIRED_PLACEHOLDERS[kind]) {
    if (!hasAny(template, group)) {
      missing.push(group);
      errors.push(`Missing required placeholder {${group[0]}}.`);
    }
  }

  const unknown = [...new Set(extractPlaceholders(template))].filter(
    (token) => !KNOWN_PLACEHOLDERS.includes(token as KnownPlaceholder)
  );
  for (const token of unknown) {
    warnings.push(`Unknown placeholder {${token}} — it will be passed through literally.`);
  }

  if (!template.trim()) {
    errors.push('The argument template cannot be empty.');
  }

  return { valid: errors.length === 0, errors, warnings, missing, unknown };
}

export interface PlaceholderValues {
  mine?: string;
  theirs?: string;
  base?: string;
  merged?: string;
  left?: string;
  right?: string;
}

/**
 * Expand a template into an argv array (without the executable). Double-quoted
 * segments stay a single argument; placeholders inside quotes are substituted.
 * Tokens a placeholder could not resolve for are passed through as-is.
 */
export function expandArgumentTemplate(template: string, values: PlaceholderValues): string[] {
  const withValues = template.replace(/\{([A-Za-z][\w-]*)\}/g, (whole, token: string) => {
    const value = (values as Record<string, string | undefined>)[token];
    return value === undefined ? whole : value;
  });

  const argv: string[] = [];
  for (const token of withValues.match(/"[^"]*"|\S+/g) ?? []) {
    if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) {
      const inner = token.slice(1, -1);
      if (inner) argv.push(inner);
      continue;
    }
    argv.push(token);
  }
  return argv;
}

/** Human-readable placeholder cheat sheet for the settings UI. */
export function describeRequiredPlaceholders(kind: ExternalToolKind): string {
  const required = REQUIRED_PLACEHOLDERS[kind]
    .map((group) => group.map((alias) => `{${alias}}`).join(' or '))
    .join(' + ');
  return kind === 'merge' ? `${required} ({base} optional)` : required;
}

/** Validate a stored tool entry (name + executable + template). */
export function validateExternalTool(tool: ExternalToolTemplateConfig): TemplateValidation & {
  nameError?: string;
  executableError?: string;
} {
  const template = validateArgumentTemplate(tool.kind, tool.argumentTemplate);
  return {
    ...template,
    valid: template.valid && Boolean(tool.name.trim()) && Boolean(tool.executablePath.trim()),
    nameError: tool.name.trim() ? undefined : 'A tool name is required.',
    executableError: tool.executablePath.trim() ? undefined : 'An executable path is required.',
  };
}

export function createExternalToolId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `tool-${crypto.randomUUID()}`;
  }
  return `tool-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
