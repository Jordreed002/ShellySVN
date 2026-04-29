import { existsSync, statSync } from 'node:fs';
import { normalize } from 'node:path';

export const KNOWN_DIFF_TOOL_ALIASES = new Set([
  'bcompare',
  'bcomp',
  'meld',
  'kdiff3',
  'diffmerge',
  'p4merge',
  'tortoisediff',
  'vscode',
  'code',
]);

export const KNOWN_MERGE_TOOL_ALIASES = new Set([
  'bcompare',
  'bcomp',
  'meld',
  'kdiff3',
  'diffmerge',
  'p4merge',
  'tortoisemerge',
]);

export function validateExternalToolSetting(
  value: string,
  label: string,
  aliases: Set<string>
): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (aliases.has(trimmed.toLowerCase())) {
    return trimmed;
  }

  if (trimmed.split(/[/\\]+/).includes('..')) {
    throw new Error(`${label} path traversal is not allowed.`);
  }

  const normalized = normalize(trimmed);
  if (!existsSync(normalized)) {
    throw new Error(`${label} does not exist.`);
  }

  const stats = statSync(normalized);
  if (!stats.isFile()) {
    throw new Error(`${label} must point to an executable file.`);
  }

  return normalized;
}
