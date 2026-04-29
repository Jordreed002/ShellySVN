import type { DiffMergeSettings } from '@shared/types';

export type ExternalToolKind = 'diff' | 'merge';

function normalizeExtension(pathOrExtension: string): string {
  const candidate = pathOrExtension.includes('.')
    ? pathOrExtension.split('.').pop() || ''
    : pathOrExtension;
  return candidate.replace(/^\./, '').trim().toLowerCase();
}

export function resolveExternalToolForPath(
  diffMerge: DiffMergeSettings,
  filePath: string,
  kind: ExternalToolKind
): string {
  const extension = normalizeExtension(filePath);
  const override = diffMerge.externalToolOverrides?.find(
    (entry) => normalizeExtension(entry.extension) === extension
  );
  const overrideTool = kind === 'diff' ? override?.diffTool : override?.mergeTool;

  if (overrideTool?.trim()) {
    return overrideTool.trim();
  }

  const fallback = kind === 'diff' ? diffMerge.externalDiffTool : diffMerge.externalMergeTool;
  return fallback.trim();
}
