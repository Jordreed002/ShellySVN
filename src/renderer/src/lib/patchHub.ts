/**
 * Patch Hub support library (#63).
 *
 * Three concerns, all renderer-side:
 *
 * 1. A persistent index of created patch files (`window.api.store`, same
 *    pattern as `lib/savedComparisons.ts`). The patch files themselves live
 *    wherever the user saved them; the hub remembers where.
 * 2. Parsing `svn patch --dry-run` output into a conflict preview (action
 *    lines `U path`, `C path`, reject counts) so the UI can warn before a
 *    real apply.
 * 3. Reject-file (`.rej` / `.svnpatch.rej`) recovery: scanning the working
 *    copy after an apply, parsing rejected hunks out of the reject files and
 *    locating the surrounding content in the target files.
 */

import type { FileInfo } from '@shared/types';

// ============================================
// 1. Patch index persistence
// ============================================

export const PATCH_HUB_INDEX_KEY = 'shellysvn:patch-hub:v1';

export interface PatchHubEntry {
  id: string;
  /** File name of the patch (display). */
  name: string;
  /** Absolute path of the patch file on disk. */
  path: string;
  /** Working copy the patch was created from / applies to. */
  workingCopyPath: string;
  createdAt: string;
}

export function newPatchId(): string {
  return `patch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Validate an unknown payload as the patch index; malformed entries drop. */
export function parsePatchHubIndex(value: unknown): PatchHubEntry[] {
  if (!Array.isArray(value)) return [];
  const result: PatchHubEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, path, workingCopyPath, createdAt } = entry as Record<string, unknown>;
    if (
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      typeof path !== 'string' ||
      typeof workingCopyPath !== 'string'
    ) {
      continue;
    }
    result.push({
      id,
      name,
      path,
      workingCopyPath,
      createdAt: typeof createdAt === 'string' ? createdAt : new Date().toISOString(),
    });
  }
  return result;
}

export async function loadPatchIndex(): Promise<PatchHubEntry[]> {
  try {
    return parsePatchHubIndex(await window.api?.store?.get<unknown>(PATCH_HUB_INDEX_KEY));
  } catch {
    return [];
  }
}

export async function savePatchIndex(entries: PatchHubEntry[]): Promise<void> {
  await window.api?.store?.set(PATCH_HUB_INDEX_KEY, entries);
}

export async function addPatchToIndex(entry: PatchHubEntry): Promise<PatchHubEntry[]> {
  const entries = await loadPatchIndex();
  // Re-adding an existing path refreshes it instead of duplicating.
  const next = [entry, ...entries.filter((existing) => existing.path !== entry.path)];
  await savePatchIndex(next);
  return next;
}

export async function removePatchFromIndex(patchPath: string): Promise<PatchHubEntry[]> {
  const entries = (await loadPatchIndex()).filter((existing) => existing.path !== patchPath);
  await savePatchIndex(entries);
  return entries;
}

// ============================================
// 2. Dry-run conflict preview parsing
// ============================================

export interface PatchActionLine {
  /** Single action char: A (added), D (deleted), U (updated), G (merged), C (conflict). */
  action: string;
  path: string;
}

export interface PatchDryRunSummary {
  /** All action lines from the dry-run output. */
  actions: PatchActionLine[];
  /** Subset with action `C` — these files will conflict on a real apply. */
  conflicts: PatchActionLine[];
  rejects: number;
  offsetHunks: number;
  fuzzedHunks: number;
}

/** Parse `svn patch` action lines (`U path`, `C path`, …) from raw output. */
export function parsePatchActionLines(output: string): PatchActionLine[] {
  const matches = output.match(/^[ADUGC]\s+.+$/gm) ?? [];
  return matches.map((line) => ({
    action: line.slice(0, 1),
    path: line.slice(1).trim(),
  }));
}

export function summarizeDryRunOutput(output: string): PatchDryRunSummary {
  const actions = parsePatchActionLines(output);
  return {
    actions,
    conflicts: actions.filter((line) => line.action === 'C'),
    rejects: countRejects(output),
    offsetHunks: (output.match(/^>.*\bwith offset\b.*$/gim) ?? []).length,
    fuzzedHunks: (output.match(/^>.*\bfuzz\b.*$/gim) ?? []).length,
  };
}

function countRejects(output: string): number {
  const explicit = Number(output.match(/\b(\d+)\s+rejects?\b/i)?.[1] ?? 0);
  const rejectedHunkLines = (output.match(/^>.*(?:rejected|FAILED).*$/gim) ?? []).length;
  const textualRejected = (output.match(/^Rejected hunk(?! saved).*$/gim) ?? []).length;
  const conflicts = parsePatchActionLines(output).filter((line) => line.action === 'C').length;
  return Math.max(explicit, rejectedHunkLines + textualRejected + conflicts);
}

/** True when a dry-run (or apply) result indicates a risky real apply. */
export function dryRunHasConflicts(summary: PatchDryRunSummary): boolean {
  return summary.conflicts.length > 0 || summary.rejects > 0;
}

// ============================================
// 3. Reject-file scanning and recovery
// ============================================

/** `svn patch` writes `<target>.svnpatch.rej`; classic patch writes `<target>.rej`. */
export function isRejectFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.svnpatch.rej') || lower.endsWith('.rej');
}

/** Strip the reject suffix to get the target file path. */
export function rejectFileTarget(rejectPath: string): string {
  if (rejectPath.toLowerCase().endsWith('.svnpatch.rej')) {
    return rejectPath.slice(0, -'.svnpatch.rej'.length);
  }
  if (rejectPath.toLowerCase().endsWith('.rej')) {
    return rejectPath.slice(0, -'.rej'.length);
  }
  return rejectPath;
}

/**
 * Recursively scan a directory tree for reject files (bounded depth).
 *
 * `listDirectory` is injected so tests can stub the filesystem; in the app it
 * is `window.api.fs.listDirectory`.
 */
export async function findRejectFiles(
  rootPath: string,
  listDirectory: (path: string) => Promise<FileInfo[]>,
  maxDepth = 6
): Promise<string[]> {
  const results: string[] = [];

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: FileInfo[];
    try {
      entries = await listDirectory(directory);
    } catch {
      return; // unreadable directory — skip rather than fail the scan
    }
    for (const entry of entries) {
      if (entry.isDirectory) {
        // Skip .svn internals: pristines can be huge and never hold rejects.
        if (entry.name === '.svn') continue;
        await walk(entry.path, depth + 1);
      } else if (isRejectFileName(entry.name)) {
        results.push(entry.path);
      }
    }
  }

  await walk(rootPath, 0);
  return results.toSorted();
}

export interface RejectHunkLine {
  kind: 'context' | 'remove' | 'add';
  text: string;
}

export interface RejectHunk {
  /** Original `@@ -a,b +c,d @@ …` header. */
  header: string;
  /** Line number in the pre-patch file where the hunk expected to apply. */
  oldStart: number;
  lines: RejectHunkLine[];
}

export interface ParsedRejectFile {
  /** Target file path as recorded in the reject file's `---`/`+++` lines. */
  targetPath: string | null;
  hunks: RejectHunk[];
}

/** Match the `--- <path>` header line of a reject file. */
function matchRejectHeader(line: string): RegExpMatchArray | null {
  return line.match(/^---\s+(\S+?)(?:\s+.*)?$/);
}

/** Parse a unified-diff reject file into its hunks. */
export function parseRejectFile(content: string): ParsedRejectFile {
  const lines = content.split(/\r?\n/);
  let targetPath: string | null = null;
  const hunks: RejectHunk[] = [];

  for (const line of lines) {
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/);
    if (hunkMatch) {
      hunks.push({
        header: line.trim(),
        oldStart: Number(hunkMatch[1]),
        lines: [],
      });
      continue;
    }
    const current = hunks[hunks.length - 1];
    if (!current) {
      // Still in the file header area (`--- path`, `+++ path`, prose).
      const match = matchRejectHeader(line);
      if (match) targetPath = match[1];
      continue;
    }
    if (line.startsWith('+')) current.lines.push({ kind: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) current.lines.push({ kind: 'remove', text: line.slice(1) });
    else if (line.startsWith(' ') || line === '')
      current.lines.push({ kind: 'context', text: line.replace(/^ /, '') });
  }

  return { targetPath, hunks };
}

export interface RejectContextRow {
  /** 1-based line number in the target file; negative for rows that only
   * exist in the rejected hunk (would-have-been-added lines). */
  lineNumber: number;
  text: string;
  kind: 'context' | 'rejected-remove' | 'rejected-add';
}

export interface RejectContext {
  /** 1-based line in the target file where the hunk matches (or the oldStart fallback). */
  matchedAt: number;
  /** Whether the hunk's context actually matched the file content. */
  matched: boolean;
  rows: RejectContextRow[];
}

/**
 * Locate a rejected hunk inside the current target file content and build a
 * window of surrounding lines with the hunk's own lines interleaved, so the
 * recovery UI can show exactly where the patch failed to apply.
 */
export function locateHunkInContent(
  fileContent: string,
  hunk: RejectHunk,
  contextSize = 3
): RejectContext {
  const fileLines = fileContent.split(/\r?\n/);
  const contextLines = hunk.lines
    .filter((line) => line.kind !== 'add')
    .map((line) => line.text);

  let matchedAt = Math.max(1, hunk.oldStart) - 1; // 0-based index fallback
  let matched = false;
  if (contextLines.length > 0 && fileLines.length > 0) {
    for (let index = 0; index < fileLines.length; index += 1) {
      const window = fileLines.slice(index, index + contextLines.length);
      if (
        window.length === contextLines.length &&
        window.every((line, offset) => line === contextLines[offset])
      ) {
        matchedAt = index;
        matched = true;
        break;
      }
    }
  }

  const rows: RejectContextRow[] = [];
  // Rows before the hunk, drawn from the target file.
  const before = Math.max(0, matchedAt - contextSize);
  for (let index = before; index < matchedAt; index += 1) {
    rows.push({ lineNumber: index + 1, text: fileLines[index] ?? '', kind: 'context' });
  }
  // The hunk itself, interleaved with any matching file lines.
  let fileCursor = matchedAt;
  for (const line of hunk.lines) {
    if (line.kind === 'add') {
      rows.push({ lineNumber: -(rows.length + 1), text: line.text, kind: 'rejected-add' });
    } else {
      const fileLine = fileLines[fileCursor];
      const kind: RejectContextRow['kind'] =
        line.kind === 'remove'
          ? fileLine === line.text
            ? 'rejected-remove'
            : 'context'
          : 'context';
      rows.push({ lineNumber: fileCursor + 1, text: line.text, kind });
      fileCursor += 1;
    }
  }
  // Rows after the hunk, again from the target file.
  const afterEnd = Math.min(fileLines.length, fileCursor + contextSize);
  for (let index = fileCursor; index < afterEnd; index += 1) {
    rows.push({ lineNumber: index + 1, text: fileLines[index] ?? '', kind: 'context' });
  }

  return { matchedAt: matchedAt + 1, matched, rows };
}
