import { app, shell } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { SvnMutationResult, SvnShelve, SvnShelveListResult } from '@shared/types';
import { parseSvnStatusEntriesXml } from '../utils/svn-xml';
import { validateSvnTargets, withSvnTargets } from '../utils/svn-targets';
import { assertSafeEntryRelativePath, assertWithinRoot } from '../utils/path-guard';
import { runSvnText } from './svn-executor';
import { collapseNestedFiles, type PortableShelfFile } from './svn-portable-shelf-files';

/**
 * Shelf names become directory names (base64url-encoded) inside the store, but
 * they are also passed to `svn shelve` as arguments and rendered in file-system
 * artifacts, so they must not carry path separators or option prefixes.
 */
export function assertSafeShelfName(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`);
  if (/[\u0000\u000D\u000A]/.test(value)) {
    throw new Error(`${label} contains invalid control characters`);
  }
  if (value.startsWith('-')) throw new Error(`${label} must not begin with an option prefix`);
  if (/[\\/]/.test(value)) throw new Error(`${label} must not contain path separators`);
}

/** File-system-safe slug for exported bundle directory names. */
export function shelfNameSlug(name: string): string {
  const slug = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '_').slice(0, 64);
  return slug || 'shelf';
}

interface PortableShelfMetadata {
  version: 1;
  name: string;
  message?: string;
  workingCopyPath: string;
  createdAt: string;
  files: PortableShelfFile[];
}

/**
 * The working-copy root owning the `.svn` admin area above `candidate`, or the
 * resolved candidate itself when none is found (a bare directory still gets a
 * working, isolated store). Bounded so a pathological loop of `..` resolves
 * instead of spinning.
 */
function resolveShelfStoreRoot(candidate: string): string {
  let current = resolve(candidate);
  for (let hops = 0; hops < 64; hops += 1) {
    if (existsSync(join(current, '.svn'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(candidate);
    current = parent;
  }
  return resolve(candidate);
}

/**
 * The store is keyed by the working-copy ROOT, not the exact path a shelf was
 * scoped to: a subpath-scoped save (e.g. from the repo browser) must stay
 * visible to list/apply against the root. Each shelf's metadata still records
 * the scope it was saved at, and apply restores into that scope.
 */
function shelfRoot(workingCopyPath: string): string {
  const key = createHash('sha256').update(resolveShelfStoreRoot(workingCopyPath)).digest('hex');
  const userDataRoot =
    process.env.SHELLYSVN_PORTABLE_SHELF_ROOT ||
    app?.getPath?.('userData') ||
    join(tmpdir(), 'shellysvn-portable-shelves');
  return join(userDataRoot, 'portable-shelves', key);
}

function shelfDirectory(workingCopyPath: string, name: string): string {
  const safeName = Buffer.from(name, 'utf8').toString('base64url');
  return join(shelfRoot(workingCopyPath), safeName);
}

function assertInsideWorkingCopy(workingCopyPath: string, candidate: string): string {
  const root = resolve(workingCopyPath);
  // SECURITY: path-guard containment — rejects lexical escapes (`..`, absolute
  // overrides) and symlinks under the working copy that redirect outside it.
  assertWithinRoot(root, candidate, 'Portable shelf entry');
  // Derive the relative path from the lexical form (the guard may re-anchor
  // the candidate under the canonical root).
  const relativePath = relative(root, resolve(root, candidate));
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('Portable shelf entry escapes the working copy');
  }
  return relativePath || '.';
}

async function readMetadata(directory: string): Promise<PortableShelfMetadata> {
  const parsed = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8')) as
    | PortableShelfMetadata
    | undefined;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.files)) {
    throw new Error('Portable shelf metadata is invalid');
  }
  return parsed;
}

export async function portableShelfList(workingCopyPath: string): Promise<SvnShelveListResult> {
  try {
    const root = shelfRoot(workingCopyPath);
    const directories = await readdir(root, { withFileTypes: true }).catch(() => []);
    const shelves: SvnShelve[] = [];
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      const metadata = await readMetadata(join(root, directory.name));
      shelves.push({
        name: metadata.name,
        message: metadata.message,
        path: metadata.workingCopyPath,
        date: metadata.createdAt,
      });
    }
    shelves.sort((left, right) => right.date.localeCompare(left.date));
    return { shelves };
  } catch (error) {
    return {
      shelves: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function portableShelfSave(
  name: string,
  workingCopyPath: string,
  message?: string
): Promise<SvnMutationResult> {
  validateSvnTargets([workingCopyPath], 'Portable shelf target');
  const directory = shelfDirectory(workingCopyPath, name);
  try {
    await stat(directory);
    return { success: false, error: `A shelf named "${name}" already exists.` };
  } catch {
    // Expected for a new shelf.
  }

  const statusXml = await runSvnText(
    withSvnTargets(['status', '--xml', '--no-ignore', '--depth', 'infinity'], [workingCopyPath])
  );
  const changed = parseSvnStatusEntriesXml(statusXml).filter(
    (entry) => !['normal', 'external', 'ignored'].includes(entry.item)
  );
  if (changed.length === 0) {
    return { success: false, error: 'There are no local changes to shelve.' };
  }
  if (changed.some((entry) => entry.item === 'conflicted')) {
    return {
      success: false,
      error: 'Resolve conflicts before creating a portable shelf.',
    };
  }

  await mkdir(join(directory, 'files'), { recursive: true });
  const files: PortableShelfFile[] = [];
  for (const entry of changed) {
    const absolutePath = isAbsolute(entry.path)
      ? resolve(entry.path)
      : resolve(workingCopyPath, entry.path);
    const relativePath = assertInsideWorkingCopy(workingCopyPath, absolutePath);
    const fileStat = await stat(absolutePath).catch(() => null);
    if (!fileStat) {
      files.push({ relativePath, status: entry.item, kind: 'file' });
      continue;
    }
    const kind = fileStat.isDirectory() ? 'directory' : 'file';
    files.push({ relativePath, status: entry.item, kind });
  }

  const collapsedFiles = collapseNestedFiles(files);
  for (const file of collapsedFiles) {
    if (
      ['deleted', 'missing'].includes(file.status) ||
      (file.kind === 'directory' && !['added', 'unversioned'].includes(file.status))
    ) {
      continue;
    }
    // SECURITY: both ends of the copy are guarded. The source must stay inside
    // the working copy (symlinks included) and the destination inside the
    // shelf's own `files` directory, so entry names cannot write elsewhere.
    const source = assertWithinRoot(
      workingCopyPath,
      resolve(workingCopyPath, file.relativePath),
      'Portable shelf capture'
    );
    const destinationRoot = join(directory, 'files');
    const destination = assertWithinRoot(
      destinationRoot,
      join(destinationRoot, file.relativePath),
      'Portable shelf capture'
    );
    await mkdir(resolve(destination, '..'), { recursive: true });
    await cp(source, destination, {
      recursive: file.kind === 'directory',
      force: false,
    });
  }

  const patch = await runSvnText(withSvnTargets(['diff', '--git'], [workingCopyPath]));
  const metadata: PortableShelfMetadata = {
    version: 1,
    name,
    ...(message ? { message } : {}),
    workingCopyPath: resolve(workingCopyPath),
    createdAt: new Date().toISOString(),
    files: collapsedFiles,
  };
  await writeFile(join(directory, 'changes.patch'), patch, { mode: 0o600 });
  await writeFile(join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2), {
    mode: 0o600,
  });

  await runSvnText(withSvnTargets(['revert', '--depth', 'infinity'], [workingCopyPath]));
  for (const file of collapsedFiles) {
    if (!['added', 'unversioned'].includes(file.status)) continue;
    const target = resolve(workingCopyPath, file.relativePath);
    await stat(target)
      .then(() => (shell?.trashItem ? shell.trashItem(target) : rm(target, { recursive: true })))
      .catch(() => undefined);
  }
  return { success: true, output: 'Saved with ShellySVN portable shelving.' };
}

export async function portableShelfApply(
  name: string,
  workingCopyPath: string
): Promise<SvnMutationResult> {
  validateSvnTargets([workingCopyPath], 'Portable shelf target');
  const directory = shelfDirectory(workingCopyPath, name);
  const metadata = await readMetadata(directory);
  // The shelf may have been saved at a sub-path scope (store is keyed by the
  // working-copy root). Restore into that recorded scope, not the path this
  // call addressed. SECURITY: metadata is on-disk data — a crafted scope must
  // not direct writes outside the working copy the store belongs to.
  const scope = resolve(metadata.workingCopyPath);
  try {
    assertWithinRoot(resolveShelfStoreRoot(workingCopyPath), scope, 'Portable shelf scope');
  } catch {
    return { success: false, error: 'This shelf belongs to a different working copy.' };
  }

  const statusXml = await runSvnText(
    withSvnTargets(['status', '--xml', '--depth', 'infinity'], [scope])
  );
  const currentChanges = parseSvnStatusEntriesXml(statusXml).filter(
    (entry) => !['normal', 'external', 'ignored'].includes(entry.item)
  );
  if (currentChanges.length > 0) {
    return {
      success: false,
      error: 'The working copy must be clean before applying a portable shelf.',
    };
  }

  const patchPath = join(directory, 'changes.patch');
  if ((await readFile(patchPath, 'utf8')).trim()) {
    await runSvnText(withSvnTargets(['patch'], [patchPath, scope]));
  }

  for (const file of metadata.files) {
    // SECURITY (zip-slip): `metadata.json` is on-disk data whose entry names
    // could be crafted. Every entry must be a safe relative path (no `..`,
    // absolute paths, null bytes, UNC or device-name tricks), the restore
    // target must stay inside the working copy under real path semantics
    // (symlinked directories cannot redirect the copy outside it), and the
    // copy source must stay inside the shelf's own `files` directory.
    assertSafeEntryRelativePath(file?.relativePath, 'Portable shelf entry');
    const target = resolve(scope, file.relativePath);
    assertInsideWorkingCopy(scope, target);
    if (
      ['deleted', 'missing'].includes(file.status) ||
      (file.kind === 'directory' && !['added', 'unversioned'].includes(file.status))
    ) {
      continue;
    }
    const filesRoot = join(directory, 'files');
    const source = assertWithinRoot(
      filesRoot,
      join(filesRoot, file.relativePath),
      'Portable shelf restore'
    );
    // SECURITY: a symlink planted in the shelf must not be copied verbatim
    // into the working copy, where later writes through it would escape.
    const sourceStat = await lstat(source).catch(() => null);
    if (sourceStat?.isSymbolicLink()) {
      throw new Error(
        `Portable shelf entry "${file.relativePath}" is a symlink and cannot be restored safely.`
      );
    }
    await mkdir(resolve(target, '..'), { recursive: true });
    await cp(source, target, { recursive: file.kind === 'directory', force: true });
    if (file.status === 'added') {
      await runSvnText(withSvnTargets(['add', '--force'], [target]));
    }
  }
  return { success: true, output: 'Applied ShellySVN portable shelf.' };
}

export async function portableShelfDelete(
  name: string,
  workingCopyPath: string
): Promise<SvnMutationResult> {
  const directory = shelfDirectory(workingCopyPath, name);
  await readMetadata(directory);
  await rm(directory, { recursive: true });
  return { success: true };
}

/** Does the portable store hold a shelf of this name for this working copy? */
export async function portableShelfExists(
  name: string,
  workingCopyPath: string
): Promise<boolean> {
  try {
    await readMetadata(shelfDirectory(workingCopyPath, name));
    return true;
  } catch {
    return false;
  }
}

/** The shelf's stored patch text (empty string when it holds no textual diff). */
export async function portableShelfReadPatch(
  name: string,
  workingCopyPath: string
): Promise<string> {
  const directory = shelfDirectory(workingCopyPath, name);
  await readMetadata(directory);
  return readFile(join(directory, 'changes.patch'), 'utf8');
}

export async function portableShelfRename(
  name: string,
  workingCopyPath: string,
  newName: string
): Promise<SvnMutationResult> {
  assertSafeShelfName(name, 'Shelf name');
  assertSafeShelfName(newName, 'New shelf name');
  validateSvnTargets([workingCopyPath], 'Portable shelf target');
  const directory = shelfDirectory(workingCopyPath, name);
  await readMetadata(directory);
  const newDirectory = shelfDirectory(workingCopyPath, newName);
  if (directory === newDirectory) {
    return { success: false, error: 'The new shelf name is the same as the old one.' };
  }
  try {
    await stat(newDirectory);
    return { success: false, error: `A shelf named "${newName}" already exists.` };
  } catch {
    // Expected when the target name is free.
  }
  await rename(directory, newDirectory);
  const metadata = await readMetadata(newDirectory);
  await writeFile(
    join(newDirectory, 'metadata.json'),
    JSON.stringify({ ...metadata, name: newName }, null, 2),
    { mode: 0o600 }
  );
  return { success: true, output: `Renamed shelf to "${newName}".` };
}

/**
 * Export a portable shelf as a bundle directory under `outputPath`:
 * `<outputPath>/portable-shelf-<slug>/{metadata.json,changes.patch,files/}` —
 * the exact shape `portableShelfImport` consumes.
 */
export async function portableShelfExport(
  name: string,
  workingCopyPath: string,
  outputPath: string
): Promise<SvnMutationResult> {
  assertSafeShelfName(name, 'Shelf name');
  validateSvnTargets([workingCopyPath, outputPath], 'Portable shelf export target');
  const directory = shelfDirectory(workingCopyPath, name);
  await readMetadata(directory);
  const destination = join(outputPath, `portable-shelf-${shelfNameSlug(name)}`);
  try {
    await stat(destination);
    return {
      success: false,
      error: `"${destination}" already exists — choose an empty destination folder.`,
    };
  } catch {
    // Expected when the destination is free.
  }
  await mkdir(outputPath, { recursive: true });
  // SECURITY: the destination stays under the user-chosen output directory; the
  // source is the store's own shelf directory.
  const guardedDestination = assertWithinRoot(outputPath, destination, 'Portable shelf export');
  await cp(directory, guardedDestination, { recursive: true });
  return { success: true, output: guardedDestination };
}

export async function portableShelfImport(
  portableShelfPath: string,
  targetWorkingCopyPath: string
): Promise<SvnMutationResult> {
  validateSvnTargets([portableShelfPath, targetWorkingCopyPath], 'Portable shelf import target');
  // SECURITY (zip-slip): the bundle is on-disk data; its metadata decides where
  // the shelf lands. Validate the shape and the name before any copy, and copy
  // only into the store's per-working-copy root (base64url directory), never to
  // an arbitrary location.
  const metadata = await readMetadata(portableShelfPath);
  assertSafeShelfName(metadata.name, 'Shelf name');
  for (const file of metadata.files) {
    assertSafeEntryRelativePath(file?.relativePath, 'Portable shelf entry');
  }
  const directory = shelfDirectory(targetWorkingCopyPath, metadata.name);
  try {
    await stat(directory);
    return {
      success: false,
      error: `A shelf named "${metadata.name}" already exists in this working copy.`,
    };
  } catch {
    // Expected when the name is free.
  }
  await mkdir(join(directory, '..'), { recursive: true });
  await cp(portableShelfPath, directory, { recursive: true });
  // The store's copy must claim the target working copy so a later apply works.
  const imported = await readMetadata(directory);
  await writeFile(
    join(directory, 'metadata.json'),
    JSON.stringify({ ...imported, workingCopyPath: resolve(targetWorkingCopyPath) }, null, 2),
    { mode: 0o600 }
  );
  return { success: true, output: `Imported shelf "${metadata.name}".` };
}
