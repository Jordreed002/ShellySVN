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
  if (trimmed.startsWith('registered:')) return trimmed;
  throw new Error(`${label} must be a built-in or registered tool.`);
}
