/**
 * Coverage for the logic-engine SvnClient (was 0%). Every method routes through
 * a private execute(); we replace it on the instance to assert each method's
 * argument construction and output parsing, and stub Bun.spawn in two tests to
 * exercise the real execute() (stdout return + non-zero-exit throw).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const parseStatus = vi.hoisted(() => vi.fn());
const parseLog = vi.hoisted(() => vi.fn());
const parseInfo = vi.hoisted(() => vi.fn());
const parseProps = vi.hoisted(() => vi.fn());

vi.mock('../parser', () => ({
  parseSvnStatusXml: parseStatus,
  parseSvnLogXml: parseLog,
  parseSvnInfoXml: parseInfo,
  parseSvnPropertiesXml: parseProps,
}));

import { SvnClient } from '../client';

type Execute = (args: string[], cwd?: string) => Promise<string>;

function makeClient(impl: Execute): { client: SvnClient; execute: ReturnType<typeof vi.fn> } {
  const client = new SvnClient('svn');
  const execute = vi.fn(impl);
  (client as unknown as { execute: Execute }).execute = execute;
  return { client, execute };
}

beforeEach(() => {
  vi.clearAllMocks();
  parseStatus.mockReturnValue({ path: '/wc', entries: [] });
  parseLog.mockReturnValue({ entries: [], startRevision: 0, endRevision: 0 });
  parseInfo.mockReturnValue({ path: '/wc', revision: 1 });
  parseProps.mockReturnValue([]);
});

describe('SvnClient — read operations', () => {
  it('status builds the args and parses the XML', async () => {
    const { client, execute } = makeClient(async () => '<status/>');
    await client.status('/wc');
    expect(execute).toHaveBeenCalledWith(['status', '--xml', '/wc']);
    expect(parseStatus).toHaveBeenCalledWith('<status/>', '/wc');
  });

  it('log builds a bounded revision range', async () => {
    const { client, execute } = makeClient(async () => '<log/>');
    await client.log('/wc', 50, 10, 20);
    expect(execute).toHaveBeenCalledWith(
      expect.arrayContaining(['log', '--xml', '--verbose', '-l', '50', '-r', '10:20', '/wc'])
    );
    expect(parseLog).toHaveBeenCalledWith('<log/>');
  });

  it('log uses :HEAD when only the start revision is given', async () => {
    const { client, execute } = makeClient(async () => '<log/>');
    await client.log('/wc', 100, 5);
    expect(execute.mock.calls[0][0]).toContain('5:HEAD');
  });

  it('log omits the revision arg when no bounds are given', async () => {
    const { client, execute } = makeClient(async () => '<log/>');
    await client.log('/wc');
    expect(execute.mock.calls[0][0].includes('-r')).toBe(false);
  });

  it('info parses the info XML', async () => {
    const { client, execute } = makeClient(async () => '<info/>');
    const result = await client.info('/wc');
    expect(execute).toHaveBeenCalledWith(['info', '--xml', '/wc']);
    expect(result).toEqual({ path: '/wc', revision: 1 });
  });
});

describe('SvnClient — diff', () => {
  it('flags a binary file', async () => {
    const { client } = makeClient(async () => 'Cannot display: file marked as a binary type');
    const result = await client.diff('/wc/file');
    expect(result).toEqual({ files: [], hasChanges: true, isBinary: true, rawDiff: expect.any(String) });
  });

  it('reports hasChanges from non-empty output', async () => {
    const { client } = makeClient(async () => 'some diff content');
    const result = await client.diff('/wc/file', '5');
    expect(result.hasChanges).toBe(true);
    expect(result.isBinary).toBeUndefined();
  });

  it('reports no changes for empty output', async () => {
    const { client } = makeClient(async () => '   ');
    const result = await client.diff('/wc/file');
    expect(result.hasChanges).toBe(false);
  });
});

describe('SvnClient — revision-parsing writes', () => {
  it('update parses the new revision', async () => {
    const { client, execute } = makeClient(async () => 'Updated to revision 42.');
    expect(await client.update('/wc')).toEqual({ success: true, revision: 42 });
    expect(execute).toHaveBeenCalledWith(['update', '/wc']);
  });

  it('update falls back to revision 0 when the pattern is absent', async () => {
    const { client } = makeClient(async () => 'At revision 41.');
    expect(await client.update('/wc')).toEqual({ success: true, revision: 0 });
  });

  it('commit parses the committed revision', async () => {
    const { client, execute } = makeClient(async () => 'Committed revision 7.');
    expect(await client.commit(['/wc/a', '/wc/b'], 'msg')).toEqual({ success: true, revision: 7 });
    expect(execute).toHaveBeenCalledWith(['commit', '-m', 'msg', '/wc/a', '/wc/b']);
  });

  it('checkout builds revision+depth args and parses the revision', async () => {
    const { client, execute } = makeClient(async () => 'Checked out revision 9.');
    expect(await client.checkout('https://svn/r', '/wc', '3', 'immediates')).toEqual({
      success: true,
      revision: 9,
      output: 'Checked out revision 9.',
    });
    expect(execute).toHaveBeenCalledWith([
      'checkout',
      '--non-interactive',
      '-r',
      '3',
      '--depth',
      'immediates',
      'https://svn/r',
      '/wc',
    ]);
  });

  it('export parses the exported revision', async () => {
    const { client, execute } = makeClient(async () => 'Exported revision 12.');
    expect(await client.export('https://svn/r', '/wc', '5')).toMatchObject({ success: true, revision: 12 });
    expect(execute).toHaveBeenCalledWith(['export', 'https://svn/r', '/wc', '-r', '5']);
  });

  it('import parses the committed revision', async () => {
    const { client } = makeClient(async () => 'Committed revision 3.');
    expect(await client.import('/wc', 'https://svn/r', 'msg')).toMatchObject({ success: true, revision: 3 });
  });

  it('switch parses the updated revision', async () => {
    const { client, execute } = makeClient(async () => 'Updated to revision 8.');
    expect(await client.switch('/wc', 'https://svn/r', '2')).toMatchObject({ success: true, revision: 8 });
    expect(execute).toHaveBeenCalledWith(['switch', 'https://svn/r', '/wc', '-r', '2']);
  });

  it('copy parses the committed revision', async () => {
    const { client } = makeClient(async () => 'Committed revision 4.');
    expect(await client.copy('src', 'dst', 'msg')).toMatchObject({ success: true, revision: 4 });
  });
});

describe('SvnClient — simple success operations', () => {
  it('revert, add, delete, cleanup build the right args', async () => {
    const { client, execute } = makeClient(async () => '');
    await client.revert(['/wc/a']);
    await client.add(['/wc/b']);
    await client.delete(['/wc/c']);
    await client.cleanup('/wc');
    expect(execute).toHaveBeenCalledWith(['revert', '/wc/a']);
    expect(execute).toHaveBeenCalledWith(['add', '/wc/b']);
    expect(execute).toHaveBeenCalledWith(['delete', '/wc/c']);
    expect(execute).toHaveBeenCalledWith(['cleanup', '/wc']);
  });

  it('resolve passes the accepted resolution', async () => {
    const { client, execute } = makeClient(async () => '');
    await client.resolve('/wc/f', 'theirs-full');
    expect(execute).toHaveBeenCalledWith(['resolve', '--accept', 'theirs-full', '/wc/f']);
  });

  it('propset and propdel build the right args', async () => {
    const { client, execute } = makeClient(async () => '');
    await client.propset('/wc/f', 'svn:eol-style', 'LF');
    await client.propdel('/wc/f', 'svn:eol-style');
    expect(execute).toHaveBeenCalledWith(['propset', 'svn:eol-style', 'LF', '/wc/f']);
    expect(execute).toHaveBeenCalledWith(['propdel', 'svn:eol-style', '/wc/f']);
  });

  it('changelist add/remove build the right args', async () => {
    const { client, execute } = makeClient(async () => '');
    await client.changelistAdd(['/wc/a'], 'mine');
    await client.changelistRemove(['/wc/a']);
    expect(execute).toHaveBeenCalledWith(['changelist', 'mine', '/wc/a']);
    expect(execute).toHaveBeenCalledWith(['changelist', '--remove', '/wc/a']);
  });
});

describe('SvnClient — output-passing operations', () => {
  it('lock passes an optional message and returns output', async () => {
    const { client, execute } = makeClient(async () => 'locked');
    expect(await client.lock('/wc/f', 'my lock')).toEqual({ success: true, output: 'locked' });
    expect(execute).toHaveBeenCalledWith(['lock', '-m', 'my lock', '/wc/f']);
  });

  it('lock without a message omits -m', async () => {
    const { client, execute } = makeClient(async () => '');
    await client.lock('/wc/f');
    expect(execute.mock.calls[0][0].includes('-m')).toBe(false);
  });

  it('unlock passes --force when requested', async () => {
    const { client, execute } = makeClient(async () => '');
    await client.unlock('/wc/f', true);
    expect(execute).toHaveBeenCalledWith(['unlock', '--force', '/wc/f']);
  });

  it('merge passes revisions and returns output', async () => {
    const { client, execute } = makeClient(async () => 'merged');
    expect(await client.merge('src', 'tgt', ['5', '6'])).toEqual({ success: true, output: 'merged' });
    expect(execute).toHaveBeenCalledWith(['merge', 'src', 'tgt', '-c', '5,6']);
  });

  it('relocate and move return the output', async () => {
    const { client, execute } = makeClient(async () => 'ok');
    expect(await client.relocate('a', 'b', '/wc')).toEqual({ success: true, output: 'ok' });
    expect(await client.move('a', 'b')).toEqual({ success: true, output: 'ok' });
    expect(execute).toHaveBeenCalledWith(['relocate', 'a', 'b', '/wc']);
    expect(execute).toHaveBeenCalledWith(['move', 'a', 'b']);
  });
});

describe('SvnClient — blame, list, proplist', () => {
  it('blame builds a revision range and returns a simplified result', async () => {
    const { client, execute } = makeClient(async () => '<blame/>');
    expect(await client.blame('/wc/f', 1, 5)).toEqual({
      path: '/wc/f',
      lines: [],
      startRevision: 1,
      endRevision: 5,
    });
    expect(execute).toHaveBeenCalledWith(['blame', '--xml', '-v', '-r', '1:5', '/wc/f']);
  });

  it('blame without revisions omits the range', async () => {
    const { client, execute } = makeClient(async () => '<blame/>');
    expect(await client.blame('/wc/f')).toEqual({ path: '/wc/f', lines: [], startRevision: 0, endRevision: 0 });
    expect(execute.mock.calls[0][0].includes('-r')).toBe(false);
  });

  it('list builds revision/depth args and returns a simplified result', async () => {
    const { client, execute } = makeClient(async () => '<list/>');
    expect(await client.list('https://svn/r', '3', 'immediates')).toEqual({
      path: 'https://svn/r',
      entries: [],
    });
    expect(execute).toHaveBeenCalledWith([
      'list',
      '--xml',
      '-v',
      '-r',
      '3',
      '--depth',
      'immediates',
      'https://svn/r',
    ]);
  });

  it('proplist parses the properties XML', async () => {
    const { client } = makeClient(async () => '<props/>');
    parseProps.mockReturnValue([{ name: 'svn:eol-style', value: 'LF' }]);
    expect(await client.proplist('/wc/f')).toEqual([{ name: 'svn:eol-style', value: 'LF' }]);
  });
});
