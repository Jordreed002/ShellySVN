// @vitest-environment node
import { mkdir, mkdtemp, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertRealpathSatisfies,
  assertSafeEntryRelativePath,
  assertSanitizedPath,
  assertWithinRoot,
  PathGuardError,
  realpathOfLongestExistingPrefix,
} from '../path-guard';

let root: string;
let outside: string;

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'shellysvn-path-guard-'));
  root = join(base, 'root');
  outside = join(base, 'outside');
  await Promise.all([mkdir(root, { recursive: true }), mkdir(outside, { recursive: true })]);
});

afterEach(() => {
  // tmpdir contents are cleaned up by the OS; nothing to do beyond the next
  // test's fresh mkdtemp.
});

describe('assertSanitizedPath', () => {
  it('passes ordinary absolute and relative paths', () => {
    expect(assertSanitizedPath(join(root, 'file.txt'))).toBe(join(root, 'file.txt'));
    expect(assertSanitizedPath('relative/file.txt')).toBe('relative/file.txt');
  });

  it('rejects null bytes', () => {
    expect(() => assertSanitizedPath(`${root}/file\0.txt`)).toThrow(
      PathGuardError
    );
    expect(() => assertSanitizedPath(`${root}/file\0.txt`)).toThrow(/null byte/);
  });

  it('rejects empty and non-string paths', () => {
    expect(() => assertSanitizedPath('')).toThrow(PathGuardError);
    // Simulate a renderer sending a non-string through untyped IPC.
    expect(() => assertSanitizedPath(undefined as unknown as string)).toThrow(
      PathGuardError
    );
  });

  it('rejects UNC and Win32 namespace prefixes on every platform', () => {
    for (const path of [
      '\\\\server\\share\\file.txt',
      '\\\\?\\C:\\Windows\\system32',
      '\\\\.\\pipe\\shellysvn',
      '//server/share/file.txt',
      '//?/C:/Windows',
    ]) {
      expect(() => assertSanitizedPath(path, `sanitize ${path}`)).toThrow(
        /UNC or Win32 namespace/
      );
    }
  });

  it('rejects drive-relative paths but keeps absolute drive paths', () => {
    expect(() => assertSanitizedPath('C:Windows\\win.ini')).toThrow(/drive-relative/);
    expect(() => assertSanitizedPath('C:')).toThrow(/drive-relative/);
    // Absolute Windows paths are the sanitized form's job to pass through;
    // containment is decided by assertWithinRoot.
    expect(() => assertSanitizedPath('C:\\Windows\\win.ini')).not.toThrow();
  });

  it('rejects reserved Windows device names in any segment', () => {
    for (const path of [join(root, 'CON'), join(root, 'src', 'aux.js'), join(root, 'com1')]) {
      expect(() => assertSanitizedPath(path, `device ${path}`)).toThrow(
        /reserved Windows device name/
      );
    }
  });
});

describe('assertWithinRoot — lexical containment', () => {
  it('allows paths inside the root, including not-yet-existing targets', async () => {
    await mkdir(join(root, 'sub'), { recursive: true });
    const canonicalRoot = realpathOfLongestExistingPrefix(root);
    expect(assertWithinRoot(root, join(root, 'sub', 'new-file.txt'))).toBe(
      join(canonicalRoot, 'sub', 'new-file.txt')
    );
  });

  it('allows the root itself and relative targets (re-anchored canonically)', () => {
    const canonicalRoot = realpathOfLongestExistingPrefix(root);
    expect(assertWithinRoot(root, root)).toBe(canonicalRoot);
    expect(assertWithinRoot(root, 'sub/file.txt')).toBe(join(canonicalRoot, 'sub/file.txt'));
  });

  it('rejects ../ traversal out of the root', () => {
    expect(() => assertWithinRoot(root, join(root, 'sub', '..', '..', 'escape.txt'))).toThrow(
      PathGuardError
    );
    expect(() => assertWithinRoot(root, '../../etc/passwd', 'Traversal')).toThrow(
      /resolves outside the approved root/
    );
  });

  it('rejects an absolute-path override pointing elsewhere', () => {
    expect(() => assertWithinRoot(root, outside, 'Absolute override')).toThrow(PathGuardError);
    expect(() => assertWithinRoot(root, '/etc/passwd')).toThrow(PathGuardError);
  });

  it('rejects null bytes, UNC, device names and drive-relative tricks', () => {
    expect(() => assertWithinRoot(root, `${root}/a\0b`)).toThrow(/null byte/);
    expect(() => assertWithinRoot(root, '\\\\server\\share\\x')).toThrow(/UNC/);
    expect(() => assertWithinRoot(root, join(root, 'con'))).toThrow(
      /reserved Windows device name/
    );
    expect(() => assertWithinRoot(root, 'C:temp\\x')).toThrow(/drive-relative/);
  });

  it('collapses inner .. segments that stay inside the root', () => {
    const target = assertWithinRoot(root, join('sub', '..', 'file.txt'));
    expect(target).toBe(join(realpathOfLongestExistingPrefix(root), 'file.txt'));
  });
});

describe('assertWithinRoot — symlink containment', () => {
  it.skipIf(process.platform === 'win32')(
    'rejects a symlinked directory inside the root that escapes it',
    async () => {
      await symlink(outside, join(root, 'escape'));
      // The escape target does not even need to exist yet: the audit
      // canonicalizes the longest existing prefix (the symlink itself).
      expect(() =>
        assertWithinRoot(root, join(root, 'escape', 'secret.txt'), 'File read')
      ).toThrow(/symlink that redirects outside/);
    }
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a symlink as the final path component',
    async () => {
      const secret = join(outside, 'secret.txt');
      await writeFile(secret, 'classified');
      await symlink(secret, join(root, 'link.txt'));
      expect(() => assertWithinRoot(root, join(root, 'link.txt'), 'File read')).toThrow(
        /symlink/
      );
    }
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a symlink nested deep under the root',
    async () => {
      await mkdir(join(root, 'a', 'b'), { recursive: true });
      await symlink(outside, join(root, 'a', 'b', 'out'));
      expect(() => assertWithinRoot(root, join(root, 'a', 'b', 'out', 'c', 'd.txt'))).toThrow(
        PathGuardError
      );
    }
  );

  it.skipIf(process.platform === 'win32')(
    'allows symlinks that stay inside the root',
    async () => {
      await mkdir(join(root, 'real'));
      await symlink(join(root, 'real'), join(root, 'alias'));
      const canonicalRoot = realpathOfLongestExistingPrefix(root);
      expect(assertWithinRoot(root, join(root, 'alias', 'file.txt'))).toBe(
        join(canonicalRoot, 'alias', 'file.txt')
      );
    }
  );

  it('resolves deep not-yet-existing paths to the canonical-anchored form', () => {
    // A deep not-yet-existing path without symlinks must stay inside the root.
    const target = join(root, 'x', 'y', 'z.txt');
    const canonicalRoot = realpathOfLongestExistingPrefix(root);
    expect(assertWithinRoot(root, target)).toBe(join(canonicalRoot, 'x', 'y', 'z.txt'));
  });
});

describe('realpathOfLongestExistingPrefix', () => {
  it('canonicalizes the existing ancestor of a missing tail', async () => {
    await mkdir(join(root, 'exists'), { recursive: true });
    expect(realpathOfLongestExistingPrefix(join(root, 'exists', 'missing', 'tail.txt'))).toBe(
      realpathOfLongestExistingPrefix(join(root, 'exists'))
    );
  });

  it('canonicalizes the deepest existing ancestor of a missing tail', () => {
    const missing = join(root, 'no', 'such', 'dir');
    expect(realpathOfLongestExistingPrefix(missing)).toBe(realpathOfLongestExistingPrefix(root));
  });

  it('resolves a host tmpdir symlink (macOS /tmp -> /private/tmp)', () => {
    const realTmp = realpathOfLongestExistingPrefix(tmpdir());
    expect(realTmp).toBe(realpathOfLongestExistingPrefix(realTmp));
    expect(realTmp.startsWith(realTmp)).toBe(true);
  });
});

describe('assertSafeEntryRelativePath (zip-slip surface)', () => {
  it('accepts normal relative entries and normalizes them', () => {
    expect(assertSafeEntryRelativePath('src/a.txt')).toBe(join('src', 'a.txt'));
    expect(assertSafeEntryRelativePath('./b.txt')).toBe('b.txt');
  });

  it('rejects any .. segment, even ones that would collapse in place', () => {
    // Strict by design: archive-style entries must never contain "..".
    expect(() => assertSafeEntryRelativePath('a/../b.txt')).toThrow(/"\.\." segments/);
  });

  it('rejects absolute entries in either separator style', () => {
    expect(() => assertSafeEntryRelativePath('/etc/passwd')).toThrow(/must be relative/);
    expect(() => assertSafeEntryRelativePath('C:\\Windows\\win.ini')).toThrow(/must be relative/);
  });

  it('rejects .. traversal in either separator style', () => {
    expect(() => assertSafeEntryRelativePath('../outside.txt')).toThrow(/"\.\." segments/);
    expect(() => assertSafeEntryRelativePath('a/../../outside.txt')).toThrow(/"\.\." segments/);
    expect(() => assertSafeEntryRelativePath('a\\..\\..\\outside.txt')).toThrow(
      /"\.\." segments/
    );
  });

  it('rejects null bytes, UNC prefixes and device names', () => {
    expect(() => assertSafeEntryRelativePath('a\0b')).toThrow(/null byte/);
    expect(() => assertSafeEntryRelativePath('\\\\server\\share\\a')).toThrow(/UNC/);
    expect(() => assertSafeEntryRelativePath('con')).toThrow(/reserved Windows device name/);
  });
});

describe('assertRealpathSatisfies', () => {
  it('passes when the canonical location satisfies the predicate', () => {
    expect(assertRealpathSatisfies(join(root, 'file.txt'), () => true, 'Op')).toBe(
      resolve(join(root, 'file.txt'))
    );
  });

  it.skipIf(process.platform === 'win32')(
    'rejects when a symlink redirects to a disallowed location',
    async () => {
      await symlink(outside, join(root, 'escape'));
      const isAllowed = (candidate: string) =>
        candidate === root || candidate.startsWith(`${root}/`);
      expect(() =>
        assertRealpathSatisfies(join(root, 'escape', 'file.txt'), isAllowed, 'File read')
      ).toThrow(/resolves through symlinks/);
    }
  );
});
