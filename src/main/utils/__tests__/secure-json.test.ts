import { afterEach, describe, expect, it } from 'vitest';

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { hardenPrivateFile, writeSecureJson, writeSecureJsonSync } from '../secure-json';

/**
 * Settings and credentials are persisted via these helpers, so they must (a)
 * round-trip data faithfully and (b) land on disk with restrictive permissions
 * via an atomic rename that leaves no temp file behind.
 */
describe('secure-json', () => {
  let dir: string;

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  const isPosix = process.platform !== 'win32';

  describe('writeSecureJsonSync', () => {
    it('writes JSON that round-trips exactly', () => {
      dir = mkdtempSync(join(tmpdir(), 'secure-json-sync-'));
      const file = join(dir, 'nested', 'deep', 'data.json');
      const value = { name: 'shelly', tokens: ['a', 'b'], n: 42 };

      writeSecureJsonSync(file, value);

      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(value);
    });

    it('leaves no .tmp file behind after the rename', () => {
      dir = mkdtempSync(join(tmpdir(), 'secure-json-sync-'));
      const file = join(dir, 'data.json');
      writeSecureJsonSync(file, { ok: true });

      const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
      expect(leftovers).toEqual([]);
    });

    it('overwrites an existing file atomically', () => {
      dir = mkdtempSync(join(tmpdir(), 'secure-json-sync-'));
      const file = join(dir, 'data.json');
      writeSecureJsonSync(file, { v: 1 });
      writeSecureJsonSync(file, { v: 2 });

      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ v: 2 });
    });

    it('creates the file with 0600 permissions on POSIX', () => {
      if (!isPosix) return; // permission bits are a no-op on Windows
      dir = mkdtempSync(join(tmpdir(), 'secure-json-sync-'));
      const file = join(dir, 'data.json');
      writeSecureJsonSync(file, { secret: 'x' });

      expect(statSync(file).mode & 0o777).toBe(0o600);
    });
  });

  describe('writeSecureJson (async)', () => {
    it('writes JSON that round-trips exactly', async () => {
      dir = mkdtempSync(join(tmpdir(), 'secure-json-async-'));
      const file = join(dir, 'nested', 'data.json');
      const value = { a: [1, 2, 3], b: { c: true } };

      await writeSecureJson(file, value);

      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(value);
    });

    it('leaves no .tmp file behind after the rename', async () => {
      dir = mkdtempSync(join(tmpdir(), 'secure-json-async-'));
      const file = join(dir, 'data.json');
      await writeSecureJson(file, { ok: true });

      expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });

    it('creates the file with 0600 permissions on POSIX', async () => {
      if (!isPosix) return;
      dir = mkdtempSync(join(tmpdir(), 'secure-json-async-'));
      const file = join(dir, 'data.json');
      await writeSecureJson(file, { secret: 'x' });

      expect(statSync(file).mode & 0o777).toBe(0o600);
    });
  });

  describe('hardenPrivateFile', () => {
    it('tightens an existing file to 0600 on POSIX', () => {
      if (!isPosix) return;
      dir = mkdtempSync(join(tmpdir(), 'secure-json-harden-'));
      const file = join(dir, 'loose.json');
      writeFileSync(file, '{}', { mode: 0o644 });

      hardenPrivateFile(file);

      expect(statSync(file).mode & 0o777).toBe(0o600);
    });

    it('is a no-op when the file does not exist (no throw)', () => {
      dir = mkdtempSync(join(tmpdir(), 'secure-json-harden-'));
      expect(() => hardenPrivateFile(join(dir, 'missing.json'))).not.toThrow();
    });
  });
});
