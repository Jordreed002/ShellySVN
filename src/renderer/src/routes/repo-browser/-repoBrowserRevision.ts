export function normalizeRepoBrowserRevision(revision: string): string {
  const trimmedRevision = revision.trim();
  return trimmedRevision || 'HEAD';
}
