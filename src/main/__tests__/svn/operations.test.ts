/**
 * Unit tests for SVN operations using MockSvnExecutor
 *
 * Tests the core SVN operations with mocked responses
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockSvnExecutor, MockSvnResponses } from '../mocks/MockSvnExecutor';

describe('MockSvnExecutor', () => {
  let mock: MockSvnExecutor;

  beforeEach(() => {
    mock = new MockSvnExecutor();
  });

  describe('basic functionality', () => {
    it('should return default responses when no mock is set', async () => {
      const result = await mock.execute(['status', '--xml', '/path/to/wc']);

      expect(result).toContain('<?xml');
      expect(result).toContain('<status>');
    });

    it('should return custom response when set', async () => {
      mock.setResponse('status', {
        stdout: '<?xml version="1.0"?><status><target><entry path="test.txt" /></target></status>',
      });

      const result = await mock.execute(['status', '--xml', '/path/to/wc']);

      expect(result).toContain('test.txt');
    });

    it('should throw error when configured', async () => {
      mock.setResponse('status', {
        stdout: '',
        error: new Error('Command failed'),
      });

      await expect(mock.execute(['status', '--xml', '/path'])).rejects.toThrow('Command failed');
    });

    it('should throw on non-zero exit code', async () => {
      mock.setResponse('status', {
        stdout: '',
        stderr: 'Authentication failed',
        exitCode: 1,
      });

      await expect(mock.execute(['status', '--xml', '/path'])).rejects.toThrow(
        'Authentication failed'
      );
    });
  });

  describe('call tracking', () => {
    it('should track command calls', async () => {
      await mock.execute(['status', '--xml', '/path1']);
      await mock.execute(['log', '--xml', '/path2']);

      expect(mock.wasCalled('status')).toBe(true);
      expect(mock.wasCalled('log')).toBe(true);
      expect(mock.wasCalled('info')).toBe(false);
    });

    it('should count command calls', async () => {
      await mock.execute(['status', '--xml', '/path1']);
      await mock.execute(['status', '--xml', '/path2']);
      await mock.execute(['status', '--xml', '/path3']);

      expect(mock.getCallCount('status')).toBe(3);
    });

    it('should return last call details', async () => {
      await mock.execute(['log', '-l', '10', '/path/to/wc']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('log');
      expect(lastCall?.args).toContain('-l');
      expect(lastCall?.cwd).toBeUndefined();
    });

    it('should clear history', async () => {
      await mock.execute(['status', '/path']);
      mock.clearHistory();

      expect(mock.getCallCount('status')).toBe(0);
    });
  });

  describe('custom handler', () => {
    it('should use custom handler when set', async () => {
      mock.setHandler((args, _cwd) => {
        if (args.includes('info')) {
          return {
            stdout: '<?xml version="1.0"?><info><entry revision="9999" /></info>',
          };
        }
        return { stdout: '' };
      });

      const result = await mock.execute(['info', '--xml', '/path']);

      expect(result).toContain('revision="9999"');
    });

    it('should allow async handlers', async () => {
      mock.setHandler(async (args) => {
        await new Promise((r) => setTimeout(r, 10));
        return { stdout: `processed: ${args[0]}` };
      });

      const result = await mock.execute(['test-command']);

      expect(result).toBe('processed: test-command');
    });
  });
});

describe('MockSvnResponses Factory', () => {
  describe('status response', () => {
    it('should generate status XML with entries', () => {
      const xml = MockSvnResponses.status([
        { path: 'file1.txt', status: 'modified', revision: 1234 },
        { path: 'file2.txt', status: 'added' },
      ]);

      expect(xml).toContain('file1.txt');
      expect(xml).toContain('modified');
      expect(xml).toContain('revision="1234"');
      expect(xml).toContain('file2.txt');
      expect(xml).toContain('added');
    });

    it('should include author when specified', () => {
      const xml = MockSvnResponses.status([
        { path: 'test.txt', status: 'modified', author: 'johndoe' },
      ]);

      expect(xml).toContain('johndoe');
    });
  });

  describe('info response', () => {
    it('should generate info XML with defaults', () => {
      const xml = MockSvnResponses.info({});

      expect(xml).toContain('revision="1234"');
      expect(xml).toContain('https://example.com/svn/repo/trunk');
      expect(xml).toContain('/path/to/working/copy');
    });

    it('should allow custom values', () => {
      const xml = MockSvnResponses.info({
        revision: 5678,
        url: 'https://custom.repo/svn/project',
        workingCopyRoot: '/custom/path',
      });

      expect(xml).toContain('revision="5678"');
      expect(xml).toContain('https://custom.repo/svn/project');
      expect(xml).toContain('/custom/path');
    });
  });

  describe('log response', () => {
    it('should generate log XML with entries', () => {
      const xml = MockSvnResponses.log([
        { revision: 1000, message: 'First commit' },
        { revision: 1001, message: 'Second commit', author: 'alice' },
      ]);

      expect(xml).toContain('revision="1000"');
      expect(xml).toContain('First commit');
      expect(xml).toContain('revision="1001"');
      expect(xml).toContain('alice');
    });
  });

  describe('list response', () => {
    it('should generate list XML with entries', () => {
      const xml = MockSvnResponses.list('https://repo/path', [
        { name: 'src', kind: 'dir' },
        { name: 'README.md', kind: 'file', size: 1024 },
      ]);

      expect(xml).toContain('src');
      expect(xml).toContain('kind="dir"');
      expect(xml).toContain('README.md');
      expect(xml).toContain('kind="file"');
      expect(xml).toContain('<size>1024</size>');
    });
  });

  describe('diff response', () => {
    it('should generate diff output', () => {
      const diff = MockSvnResponses.diff([
        {
          oldPath: 'a/file.ts',
          newPath: 'b/file.ts',
          hunks: [{ oldStart: 1, newStart: 1, content: '+new line' }],
        },
      ]);

      expect(diff).toContain('Index: b/file.ts');
      expect(diff).toContain('--- a/file.ts');
      expect(diff).toContain('+++ b/file.ts');
      expect(diff).toContain('@@ -1,1 +1,1 @@');
    });
  });

  describe('blame response', () => {
    it('should generate blame XML', () => {
      const xml = MockSvnResponses.blame([
        { lineNumber: 1, revision: 100, author: 'alice', content: 'first line' },
        { lineNumber: 2, revision: 101, author: 'bob', content: 'second line' },
      ]);

      expect(xml).toContain('line-number="1"');
      expect(xml).toContain('revision="100"');
      expect(xml).toContain('alice');
      expect(xml).toContain('first line');
    });
  });

  describe('success messages', () => {
    it('should generate update success message', () => {
      const msg = MockSvnResponses.updateSuccess(1234);
      expect(msg).toBe('Updated to revision 1234.\n');
    });

    it('should generate commit success message', () => {
      const msg = MockSvnResponses.commitSuccess(5678);
      expect(msg).toBe('Committed revision 5678.\n');
    });

    it('should generate checkout success message', () => {
      const msg = MockSvnResponses.checkoutSuccess(9999);
      expect(msg).toBe('Checked out revision 9999.\n');
    });

    it('should provide binary diff indicator', () => {
      expect(MockSvnResponses.binaryDiff).toContain('binary type');
    });
  });
});

describe('SVN Operations with MockSvnExecutor', () => {
  let mock: MockSvnExecutor;

  beforeEach(() => {
    mock = new MockSvnExecutor({ debug: false });
  });

  describe('update operation', () => {
    it('should parse revision from update output', async () => {
      mock.setResponse('update', {
        stdout: "Updating '.\nU    file1.txt\nUpdated to revision 1234.\n",
      });

      const output = await mock.execute(['update', '/path/to/wc']);

      expect(output).toContain('Updated to revision 1234');
    });

    it('should handle depth parameter', async () => {
      await mock.execute(['update', '--depth', 'empty', '/path/to/wc']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('--depth');
      expect(lastCall?.args).toContain('empty');
    });

    it('should handle set-depth parameter', async () => {
      await mock.execute(['update', '--set-depth', 'infinity', '/path/to/wc']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('--set-depth');
      expect(lastCall?.args).toContain('infinity');
    });
  });

  describe('commit operation', () => {
    it('should include commit message', async () => {
      mock.setResponse('commit', {
        stdout: 'Sending        file.txt\nCommitted revision 1235.\n',
      });

      await mock.execute(['commit', '-m', 'Test commit message', '/path/to/wc']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('-m');
      expect(lastCall?.args).toContain('Test commit message');
    });

    it('should handle multiple paths', async () => {
      await mock.execute(['commit', '-m', 'msg', '/path1', '/path2', '/path3']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('/path1');
      expect(lastCall?.args).toContain('/path2');
      expect(lastCall?.args).toContain('/path3');
    });
  });

  describe('checkout operation', () => {
    it('should include URL and path', async () => {
      mock.setResponse('checkout', {
        stdout: 'Checked out revision 1234.\n',
      });

      await mock.execute(['checkout', 'https://repo.url/trunk', '/local/path']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('checkout');
      expect(lastCall?.args).toContain('https://repo.url/trunk');
      expect(lastCall?.args).toContain('/local/path');
    });

    it('should handle depth parameter', async () => {
      await mock.execute(['checkout', '--depth', 'empty', 'https://repo.url', '/path']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('--depth');
      expect(lastCall?.args).toContain('empty');
    });

    it('should handle revision parameter', async () => {
      await mock.execute(['checkout', '-r', '1234', 'https://repo.url', '/path']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('-r');
      expect(lastCall?.args).toContain('1234');
    });

    it('should handle sparse paths', async () => {
      await mock.execute([
        'checkout',
        '--depth',
        'empty',
        'https://repo.url',
        '/path',
        'src',
        'docs',
      ]);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('src');
      expect(lastCall?.args).toContain('docs');
    });
  });

  describe('add operation', () => {
    it('should add single file', async () => {
      mock.setResponse('add', { stdout: '' });

      await mock.execute(['add', '/path/to/file.txt']);

      expect(mock.wasCalled('add')).toBe(true);
    });

    it('should add multiple files', async () => {
      await mock.execute(['add', '/path/file1.txt', '/path/file2.txt']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('/path/file1.txt');
      expect(lastCall?.args).toContain('/path/file2.txt');
    });
  });

  describe('delete operation', () => {
    it('should delete files', async () => {
      mock.setResponse('delete', { stdout: '' });

      await mock.execute(['delete', '/path/to/file.txt']);

      expect(mock.wasCalled('delete')).toBe(true);
    });
  });

  describe('revert operation', () => {
    it('should revert files', async () => {
      mock.setResponse('revert', { stdout: '' });

      await mock.execute(['revert', '/path/to/file.txt']);

      expect(mock.wasCalled('revert')).toBe(true);
    });
  });

  describe('cleanup operation', () => {
    it('should run cleanup', async () => {
      mock.setResponse('cleanup', { stdout: '' });

      await mock.execute(['cleanup', '/path/to/wc']);

      expect(mock.wasCalled('cleanup')).toBe(true);
    });
  });

  describe('lock/unlock operations', () => {
    it('should lock file with message', async () => {
      mock.setResponse('lock', { stdout: '' });

      await mock.execute(['lock', '-m', 'Locking for edit', '/path/to/file.txt']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('-m');
      expect(lastCall?.args).toContain('Locking for edit');
    });

    it('should unlock file', async () => {
      mock.setResponse('unlock', { stdout: '' });

      await mock.execute(['unlock', '/path/to/file.txt']);

      expect(mock.wasCalled('unlock')).toBe(true);
    });

    it('should force unlock', async () => {
      await mock.execute(['unlock', '--force', '/path/to/file.txt']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('--force');
    });
  });

  describe('switch operation', () => {
    it('should switch to URL', async () => {
      mock.setResponse('switch', { stdout: 'Updated to revision 1234.\n' });

      await mock.execute(['switch', 'https://repo.url/branch', '/path/to/wc']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('switch');
      expect(lastCall?.args).toContain('https://repo.url/branch');
    });
  });

  describe('merge operation', () => {
    it('should merge with revision', async () => {
      mock.setResponse('merge', { stdout: '' });

      await mock.execute(['merge', '-c', '1234', 'https://repo.url/trunk', '/path/to/wc']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('-c');
      expect(lastCall?.args).toContain('1234');
    });

    it('should merge with range', async () => {
      await mock.execute(['merge', '-r', '1000:1234', 'https://repo.url/trunk', '/path/to/wc']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('-r');
      expect(lastCall?.args).toContain('1000:1234');
    });
  });

  describe('changelist operations', () => {
    it('should add files to changelist', async () => {
      mock.setResponse('changelist', { stdout: '' });

      await mock.execute(['changelist', 'my-changes', '/path/file1.txt', '/path/file2.txt']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('my-changes');
    });

    it('should remove files from changelist', async () => {
      await mock.execute(['changelist', '--remove', '/path/file.txt']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('--remove');
    });
  });

  describe('property operations', () => {
    it('should list properties', async () => {
      mock.setResponse('proplist', {
        stdout:
          '<?xml version="1.0"?><properties><property name="svn:ignore">*.o</property></properties>',
      });

      const result = await mock.execute(['proplist', '--xml', '-v', '/path']);

      expect(result).toContain('svn:ignore');
    });

    it('should set property', async () => {
      mock.setResponse('propset', { stdout: '' });

      await mock.execute(['propset', 'svn:ignore', '*.o', '/path']);

      expect(mock.wasCalled('propset')).toBe(true);
    });

    it('should delete property', async () => {
      mock.setResponse('propdel', { stdout: '' });

      await mock.execute(['propdel', 'svn:ignore', '/path']);

      expect(mock.wasCalled('propdel')).toBe(true);
    });
  });

  describe('patch operations', () => {
    it('should create patch', async () => {
      mock.setResponse('patch', { stdout: 'Index: file.txt\n--- file.txt\n+++ file.txt\n' });

      const result = await mock.execute(['diff', '/path/file.txt']);

      expect(result).toContain('Index:');
    });
  });

  describe('export operation', () => {
    it('should export URL to path', async () => {
      mock.setResponse('export', { stdout: 'Exported revision 1234.\n' });

      await mock.execute(['export', 'https://repo.url/trunk', '/local/path']);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('export');
    });
  });

  describe('import operation', () => {
    it('should import path to URL', async () => {
      mock.setResponse('import', { stdout: 'Committed revision 1236.\n' });

      await mock.execute([
        'import',
        '-m',
        'Import message',
        '/local/path',
        'https://repo.url/trunk',
      ]);

      const lastCall = mock.getLastCall();
      expect(lastCall?.args).toContain('import');
      expect(lastCall?.args).toContain('-m');
    });
  });
});

describe('SVN Error Handling', () => {
  let mock: MockSvnExecutor;

  beforeEach(() => {
    mock = new MockSvnExecutor();
  });

  it('should handle authentication failure', async () => {
    mock.setResponse('status', {
      stdout: '',
      stderr: 'svn: E170013: Authentication failed',
      exitCode: 1,
    });

    await expect(mock.execute(['status', '/path'])).rejects.toThrow('Authentication failed');
  });

  it('should handle network error', async () => {
    mock.setResponse('info', {
      stdout: '',
      stderr: 'svn: E175002: Unable to connect to repository',
      exitCode: 1,
    });

    await expect(mock.execute(['info', 'https://repo.url'])).rejects.toThrow('Unable to connect');
  });

  it('should handle conflict error', async () => {
    mock.setResponse('update', {
      stdout: '',
      stderr: 'Conflict discovered in file.txt',
      exitCode: 1,
    });

    await expect(mock.execute(['update', '/path'])).rejects.toThrow('Conflict');
  });

  it('should handle working copy locked', async () => {
    mock.setResponse('commit', {
      stdout: '',
      stderr: 'svn: E155004: Working copy locked',
      exitCode: 1,
    });

    await expect(mock.execute(['commit', '/path'])).rejects.toThrow('locked');
  });

  it('should handle out of date error', async () => {
    mock.setResponse('commit', {
      stdout: '',
      stderr: 'svn: E160028: File is out of date',
      exitCode: 1,
    });

    await expect(mock.execute(['commit', '/path'])).rejects.toThrow('out of date');
  });
});
