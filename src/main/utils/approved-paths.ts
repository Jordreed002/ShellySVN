import { isAbsolute, relative, resolve } from 'path';

const approvedRoots = new Set<string>();

function normalizePath(path: string): string {
  return resolve(path);
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function approvePathForIpc(path: string): string {
  const normalized = normalizePath(path);
  approvedRoots.add(normalized);
  return path;
}

export function clearApprovedPathsForTests(): void {
  approvedRoots.clear();
}

export function isPathApprovedForIpc(path: string): boolean {
  const normalized = normalizePath(path);
  for (const root of approvedRoots) {
    if (isInsideRoot(root, normalized)) {
      return true;
    }
  }

  return false;
}

export function assertPathApprovedForIpc(path: string, operation: string): string {
  const normalized = normalizePath(path);
  if (!isPathApprovedForIpc(normalized)) {
    throw new Error(
      `${operation} is only allowed inside a folder selected through ShellySVN.`
    );
  }

  return normalized;
}
