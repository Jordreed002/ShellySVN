import type { SvnStatusEntry } from '@shared/types';

export function getTextConflictPathsFromStatus(entries: Pick<SvnStatusEntry, 'path' | 'status'>[]): string[] {
  return entries.filter((entry) => entry.status === 'C').map((entry) => entry.path);
}

export function getTextConflictPathsFromSvnOutput(output = ''): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^C\s+/.test(line))
    .map((line) => line.replace(/^C\s+/, '').trim())
    .filter(Boolean);
}
