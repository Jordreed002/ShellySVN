// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
  runSvnMuccText: vi.fn(),
  getNetworkOptionsForWorkingCopyPath: vi.fn(),
  portableShelfList: vi.fn(),
  portableShelfSave: vi.fn(),
  portableShelfApply: vi.fn(),
  portableShelfDelete: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mockState.existsSync,
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
  runSvnMuccText: mockState.runSvnMuccText,
}));

vi.mock('../svn-network-context', () => ({
  getNetworkOptionsForWorkingCopyPath: mockState.getNetworkOptionsForWorkingCopyPath,
}));

vi.mock('../svn-portable-shelves', () => ({
  portableShelfList: mockState.portableShelfList,
  portableShelfSave: mockState.portableShelfSave,
  portableShelfApply: mockState.portableShelfApply,
  portableShelfDelete: mockState.portableShelfDelete,
}));

vi.mock('../../utils/debug', () => ({
  debug: {
    error: vi.fn(),
  },
}));

import {
  classifyRepoLayout,
  externalsAdd,
  externalsEdit,
  externalsList,
  externalsRemove,
  externalsUpdate,
  getRepositoryLayout,
  listRepository,
  parseRepositoryListing,
  propdel,
  propdelRemote,
  propget,
  proplist,
  propset,
  propsetRemote,
  revpropdel,
  revpropget,
  revpropset,
  shelveApply,
  shelveDelete,
  shelveList,
  shelveSave,
} from '../svn-metadata';
import { normalizeRepoUrl } from '../../utils/svn-url';

beforeEach(() => {
  mockState.runSvnText.mockReset();
  mockState.runSvnMuccText.mockReset();
  mockState.getNetworkOptionsForWorkingCopyPath.mockReset();
  mockState.getNetworkOptionsForWorkingCopyPath.mockResolvedValue({ trustSslFailures: false });
  mockState.existsSync.mockReset();
  mockState.existsSync.mockReturnValue(true);
  mockState.portableShelfList.mockResolvedValue({ shelves: [] });
  mockState.portableShelfSave.mockResolvedValue({ success: true });
  mockState.portableShelfApply.mockResolvedValue({ success: true });
  mockState.portableShelfDelete.mockResolvedValue({ success: true });
});

describe('svn-metadata repository browsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    'http://svn.example.com/repo/trunk',
    'https://svn.example.com/repo/trunk',
    'svn://svn.example.com/repo/trunk',
    'svn+ssh://svn.example.com/repo/trunk',
  ])('lists remote repositories over supported protocol %s', async (url) => {
    mockState.runSvnText.mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="${url}">
    <entry kind="dir">
      <name>src</name>
      <commit revision="12">
        <author>alice</author>
        <date>2026-04-25T10:00:00.000Z</date>
      </commit>
    </entry>
  </list>
</lists>`);

    const result = await listRepository(url, 'HEAD', 'immediates');

    expect(result.entries[0]?.name).toBe('src');
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['list', '--xml', '--non-interactive', '-r', 'HEAD', '--depth', 'immediates', '--', url],
      { credentials: undefined }
    );
  });

  it('passes credentials through executor options without broad SSL trust flags', async () => {
    mockState.runSvnText.mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="https://svn.example.com/repo/trunk" />
</lists>`);

    await listRepository('https://svn.example.com/repo/trunk', 'HEAD', 'immediates', {
      username: 'alice',
      password: 'secret',
    });

    expect(mockState.runSvnText).toHaveBeenCalledWith(
      [
        'list',
        '--xml',
        '--non-interactive',
        '-r',
        'HEAD',
        '--depth',
        'immediates',
        '--',
        'https://svn.example.com/repo/trunk',
      ],
      { credentials: { username: 'alice', password: 'secret' } }
    );
  });

  it('returns a structured repository-list failure instead of successful-looking empty data', async () => {
    mockState.runSvnText.mockRejectedValue(
      new Error("svn: E170001: Authentication failed for 'svn://example.test/repo'")
    );

    await expect(listRepository('svn://example.test/repo')).resolves.toMatchObject({
      path: 'svn://example.test/repo',
      entries: [],
      errorCode: 'E170001',
      commandError: {
        command: 'list',
        target: 'svn://example.test/repo',
        category: 'authentication',
        authenticationRequired: true,
      },
    });
  });

  it('returns a well-formed empty listing for an r0 repository (no error fields)', async () => {
    // Real `svn list --xml` output for a repository with zero commits.
    mockState.runSvnText.mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<lists>
<list
   path="file:///tmp/empty-repo">
</list>
</lists>`);

    await expect(listRepository('file:///tmp/empty-repo')).resolves.toEqual({
      path: 'file:///tmp/empty-repo',
      entries: [],
    });
  });

  it('canonicalizes the listing root before invoking SVN and reporting paths', async () => {
    mockState.runSvnText.mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="ignored" />
</lists>`);

    await listRepository('SVN://SVN.Example.COM:3690/repo/trunk/');

    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['list', '--xml', '--non-interactive', '--', 'svn://svn.example.com/repo/trunk'],
      { credentials: undefined }
    );
    const result = await listRepository('svn://[0:0:0:0:0:0:0:1]:3690/Répo Dir');
    expect(result.path).toBe('svn://[::1]/R%C3%A9po%20Dir');
  });

  it('builds child entry URLs that round-trip unicode, spaces, and literal percents', async () => {
    // `svn list --xml` emits DECODED names: a raw `Répo Dir`, an `Ünicode
    // File.txt`, and a file literally named `a%20b.txt` (whose URL must
    // escape the percent to `%2520` so SVN does not resolve `a b.txt`).
    mockState.runSvnText.mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="svn://svn.example.com/repo/trunk">
    <entry kind="dir">
      <name>Répo Dir</name>
      <commit revision="12"><author>alice</author><date>2026-04-25T10:00:00.000Z</date></commit>
    </entry>
    <entry kind="file">
      <name>Ünicode File.txt</name>
      <size>3</size>
      <commit revision="12"><author>alice</author><date>2026-04-25T10:00:00.000Z</date></commit>
    </entry>
    <entry kind="file">
      <name>a%20b.txt</name>
      <size>3</size>
      <commit revision="12"><author>alice</author><date>2026-04-25T10:00:00.000Z</date></commit>
    </entry>
  </list>
</lists>`);

    const result = await listRepository('svn://svn.example.com/repo/trunk');

    expect(result.entries.map((entry) => entry.url)).toEqual([
      'svn://svn.example.com/repo/trunk/R%C3%A9po%20Dir',
      'svn://svn.example.com/repo/trunk/%C3%9Cnicode%20File.txt',
      'svn://svn.example.com/repo/trunk/a%2520b.txt',
    ]);
    expect(result.entries.every((entry) => entry.path === entry.url)).toBe(true);
    for (const entry of result.entries) {
      expect(entry.url).toBe(normalizeRepoUrl(entry.url));
    }
  });

  it('re-encodes list names exactly once regardless of prior encoding', () => {
    const listing = parseRepositoryListing(
      `<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="https://example.test/svn/repo">
    <entry kind="dir">
      <name>Feature Folder</name>
      <commit revision="1"><author>a</author><date>2026-01-01T00:00:00.000Z</date></commit>
    </entry>
  </list>
</lists>`,
      'https://example.test/svn/repo'
    );

    expect(listing.entries[0]).toMatchObject({
      name: 'Feature Folder',
      url: 'https://example.test/svn/repo/Feature%20Folder',
    });
  });
});

describe('svn-metadata repository layout detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function infoXml(url: string, revision: number): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<info>
<entry revision="${revision}" kind="dir" path="repo">
<url>${url}</url>
<repository><root>${url}</root><uuid>layout-uuid</uuid></repository>
<commit revision="${revision}"><date>2026-08-23T00:00:00.000Z</date></commit>
</entry>
</info>`;
  }

  function listXml(rootUrl: string, entries: Array<{ name: string; kind: 'dir' | 'file' }>): string {
    const entryXml = entries
      .map(
        (entry) => `    <entry kind="${entry.kind}">
      <name>${entry.name}</name>
      <commit revision="4"><author>alice</author><date>2026-04-25T10:00:00.000Z</date></commit>
    </entry>`
      )
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="${rootUrl}">
${entryXml}
  </list>
</lists>`;
  }

  it('classifies standard, trunk-only, and custom layouts as data', () => {
    const standard = classifyRepoLayout(
      'svn://svn.example.com/repo',
      [
        { name: 'trunk', kind: 'dir' },
        { name: 'branches', kind: 'dir' },
        { name: 'tags', kind: 'dir' },
      ],
      4
    );
    expect(standard).toMatchObject({
      kind: 'standard',
      empty: false,
      youngestRevision: 4,
      trunk: 'svn://svn.example.com/repo/trunk',
      branches: 'svn://svn.example.com/repo/branches',
      tags: 'svn://svn.example.com/repo/tags',
    });
    expect(standard.customDirs).toEqual([]);

    const trunkOnly = classifyRepoLayout(
      'svn://svn.example.com/repo',
      [
        { name: 'trunk', kind: 'dir' },
        { name: 'docs', kind: 'dir' },
      ],
      4
    );
    expect(trunkOnly).toMatchObject({ kind: 'trunk-only', trunk: 'svn://svn.example.com/repo/trunk' });
    expect(trunkOnly.branches).toBeUndefined();
    expect(trunkOnly.customDirs).toEqual([
      { name: 'docs', url: 'svn://svn.example.com/repo/docs', kind: 'dir' },
    ]);

    const custom = classifyRepoLayout(
      'svn://svn.example.com/repo',
      [
        { name: 'src', kind: 'dir' },
        { name: 'README.md', kind: 'file' },
      ],
      7
    );
    expect(custom).toMatchObject({ kind: 'custom', empty: false });
    expect(custom.trunk).toBeUndefined();
    expect(custom.customDirs).toEqual([
      { name: 'src', url: 'svn://svn.example.com/repo/src', kind: 'dir' },
      { name: 'README.md', url: 'svn://svn.example.com/repo/README.md', kind: 'file' },
    ]);
  });

  it('detects conventional directories case-insensitively and canonicalizes their URLs', () => {
    const layout = classifyRepoLayout(
      'svn://svn.example.com/repo',
      [{ name: 'Trunk', kind: 'dir' }],
      3
    );
    expect(layout).toMatchObject({
      kind: 'trunk-only',
      trunk: 'svn://svn.example.com/repo/Trunk',
    });
  });

  it('detects an empty r0 repository without assuming any layout', () => {
    const layout = classifyRepoLayout('svn://svn.example.com/repo', [], 0);
    expect(layout).toEqual({
      kind: 'empty',
      rootUrl: 'svn://svn.example.com/repo',
      customDirs: [],
      empty: true,
      youngestRevision: 0,
    });
  });

  it('keeps an empty root folder of a non-empty repository distinct from r0', () => {
    // Youngest revision > 0 with no root entries: an empty directory, not an
    // empty repository — classified as custom so the renderer can present it.
    const layout = classifyRepoLayout('svn://svn.example.com/repo/trunk', [], 9);
    expect(layout).toMatchObject({ kind: 'custom', empty: false, youngestRevision: 9 });
  });

  it('detects the layout of an r0 repository from info + list without errors', async () => {
    mockState.runSvnText.mockImplementation(async (args: string[]) =>
      args[0] === 'info'
        ? infoXml('file:///tmp/empty-repo', 0)
        : listXml('file:///tmp/empty-repo', [])
    );

    await expect(getRepositoryLayout('file:///tmp/empty-repo')).resolves.toEqual({
      kind: 'empty',
      rootUrl: 'file:///tmp/empty-repo',
      customDirs: [],
      empty: true,
      youngestRevision: 0,
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['info', '--xml', '--non-interactive', '--', 'file:///tmp/empty-repo'],
      { credentials: undefined }
    );
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['list', '--xml', '--non-interactive', '--depth', 'immediates', '--', 'file:///tmp/empty-repo'],
      { credentials: undefined }
    );
  });

  it('detects a standard layout and reports canonical child URLs', async () => {
    mockState.runSvnText.mockImplementation(async (args: string[]) =>
      args[0] === 'info'
        ? infoXml('svn://svn.example.com/repo', 12)
        : listXml('svn://svn.example.com/repo', [
            { name: 'trunk', kind: 'dir' },
            { name: 'branches', kind: 'dir' },
            { name: 'tags', kind: 'dir' },
            { name: 'website', kind: 'dir' },
          ])
    );

    await expect(getRepositoryLayout('svn://svn.example.com/repo/')).resolves.toMatchObject({
      kind: 'standard',
      rootUrl: 'svn://svn.example.com/repo',
      trunk: 'svn://svn.example.com/repo/trunk',
      branches: 'svn://svn.example.com/repo/branches',
      tags: 'svn://svn.example.com/repo/tags',
      customDirs: [{ name: 'website', url: 'svn://svn.example.com/repo/website', kind: 'dir' }],
      empty: false,
      youngestRevision: 12,
    });
  });

  it('reports layout failures structurally instead of throwing or claiming emptiness', async () => {
    mockState.runSvnText.mockRejectedValue(
      new Error("svn: E170001: Authentication failed for 'svn://svn.example.com/repo'")
    );

    await expect(getRepositoryLayout('svn://svn.example.com/repo')).resolves.toMatchObject({
      kind: 'custom',
      empty: false,
      errorCode: 'E170001',
      commandError: { category: 'authentication', authenticationRequired: true },
    });
  });
});

describe('svn-metadata externals management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('edits an existing external definition in svn:externals', async () => {
    mockState.runSvnText.mockResolvedValueOnce(
      'https://svn.example.com/lib-old lib\nhttps://svn.example.com/tools tools'
    );

    await expect(
      externalsEdit('C:\\wc', 'lib', {
        path: 'lib',
        name: 'lib',
        url: 'https://svn.example.com/lib-new',
        revision: 123,
      })
    ).resolves.toEqual({ success: true });

    expect(mockState.runSvnText).toHaveBeenLastCalledWith([
      'propset',
      'svn:externals',
      '-r123 https://svn.example.com/lib-new lib\nhttps://svn.example.com/tools tools',
      '--',
      'C:\\wc',
    ]);
  });

  it('lists recursive externals when Windows working-copy paths contain hyphens', async () => {
    mockState.runSvnText.mockResolvedValue(
      'C:\\Users\\alice\\AppData\\Local\\Temp\\shellysvn-release-workflows-abc123\\wc - https://svn.example.com/vendor vendor-lib'
    );

    await expect(
      externalsList(
        'C:\\Users\\alice\\AppData\\Local\\Temp\\shellysvn-release-workflows-abc123\\wc'
      )
    ).resolves.toEqual({
      externals: [
        {
          name: 'vendor-lib',
          path: 'C:\\Users\\alice\\AppData\\Local\\Temp\\shellysvn-release-workflows-abc123\\wc/vendor-lib',
          revision: undefined,
          url: 'https://svn.example.com/vendor',
        },
      ],
    });
  });

  it('removes the svn:externals property when the last external is removed', async () => {
    mockState.runSvnText.mockResolvedValueOnce('https://svn.example.com/lib lib');

    await expect(externalsRemove('C:\\wc', 'lib')).resolves.toEqual({ success: true });

    expect(mockState.runSvnText).toHaveBeenLastCalledWith([
      'propdel',
      'svn:externals',
      '--',
      'C:\\wc',
    ]);
  });

  it('removes only the exact external path and preserves sibling prefixes and comments', async () => {
    mockState.runSvnText.mockResolvedValueOnce(
      '# managed externals\nhttps://svn.example.com/lib lib\nhttps://svn.example.com/lib2 lib2'
    );

    await expect(externalsRemove('C:\\wc', 'lib')).resolves.toEqual({ success: true });

    expect(mockState.runSvnText).toHaveBeenLastCalledWith([
      'propset',
      'svn:externals',
      '# managed externals\nhttps://svn.example.com/lib2 lib2',
      '--',
      'C:\\wc',
    ]);
  });

  it('matches quoted and legacy external definitions by their exact local path', async () => {
    mockState.runSvnText.mockResolvedValueOnce(
      '"local library" -r 7 ^/vendor/lib\n-r8 ^/vendor/tools "tool suite"'
    );

    await externalsRemove('C:\\wc', 'local library');

    expect(mockState.runSvnText).toHaveBeenLastCalledWith([
      'propset',
      'svn:externals',
      '-r8 ^/vendor/tools "tool suite"',
      '--',
      'C:\\wc',
    ]);
  });

  it('preserves comments, blank lines, indentation, CRLF, and unrelated definitions exactly', async () => {
    const original = [
      '# managed externals  ',
      '',
      '  ^/vendor/lib "local library"',
      '\t-r8 ^/vendor/tools "tool suite"',
      '',
    ].join('\r\n');
    mockState.runSvnText.mockResolvedValueOnce(original);

    await externalsEdit('C:\\wc', 'local library', {
      path: 'local library',
      url: '^/vendor/lib-new@42',
      revision: 9,
    });

    expect(mockState.runSvnText).toHaveBeenLastCalledWith([
      'propset',
      'svn:externals',
      [
        '# managed externals  ',
        '',
        '  -r9 ^/vendor/lib-new@42 "local library"',
        '\t-r8 ^/vendor/tools "tool suite"',
        '',
      ].join('\r\n'),
      '--',
      'C:\\wc',
    ]);
  });

  it('rejects invalid external revisions and URL formats without changing properties', async () => {
    await expect(
      externalsAdd('C:\\wc', { path: 'lib', url: 'javascript:bad', revision: -1 })
    ).resolves.toMatchObject({
      success: false,
      error: 'External revision must be a non-negative whole number',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalledWith(expect.arrayContaining(['propset']));
  });

  it('rejects external paths that escape the working copy', async () => {
    await expect(externalsUpdate('C:\\wc', '..\\sibling')).rejects.toThrow(
      /must stay within the selected working copy/i
    );
    await expect(
      externalsAdd('C:\\wc', {
        path: 'outside',
        name: '../outside',
        url: '^/vendor/outside',
      })
    ).resolves.toMatchObject({
      success: false,
      error: 'External local path must stay within the selected working copy',
    });
  });

  it('does not turn an edit of a missing external into an add', async () => {
    mockState.runSvnText.mockResolvedValueOnce('-r8 ^/vendor/tools tools\n');

    await expect(
      externalsEdit('C:\\wc', 'missing', {
        path: 'replacement',
        url: '^/vendor/replacement',
      })
    ).resolves.toMatchObject({
      success: false,
      error: 'External definition "missing" was not found',
    });
    expect(mockState.runSvnText).not.toHaveBeenCalledWith(expect.arrayContaining(['propset']));
  });

  it('preserves SVN codes for failed external mutations', async () => {
    mockState.runSvnText.mockRejectedValue(new Error('svn: E155007: Not a working copy'));
    await expect(externalsUpdate('C:\\wc')).resolves.toMatchObject({
      success: false,
      error: 'svn: E155007: Not a working copy',
      errorCode: 'E155007',
      commandError: {
        category: 'working-copy',
        retryable: false,
      },
    });
  });

  it('returns structured errors for failed externals reads', async () => {
    mockState.runSvnText.mockRejectedValue(new Error('svn: E215004: Authentication failed'));
    await expect(externalsList('C:\\wc')).resolves.toMatchObject({
      externals: [],
      error: 'svn: E215004: Authentication failed',
      errorCode: 'E215004',
      commandError: {
        category: 'authentication',
        authenticationRequired: true,
      },
    });
  });

  it('updates all externals or a single external working-copy path', async () => {
    mockState.runSvnText.mockResolvedValue('');

    await expect(externalsUpdate('C:\\wc')).resolves.toEqual({ success: true });
    await expect(externalsUpdate('C:\\wc', 'lib')).resolves.toEqual({ success: true });

    expect(mockState.runSvnText).toHaveBeenCalledWith(['update', '--', 'C:\\wc'], {
      trustSslFailures: false,
    });
    expect(mockState.runSvnText).toHaveBeenCalledWith(['update', '--', 'C:\\wc\\lib'], {
      trustSslFailures: false,
    });
  });

  it('passes working-copy-derived credentials and SSL trust to externals updates', async () => {
    mockState.getNetworkOptionsForWorkingCopyPath.mockResolvedValue({
      credentials: { username: 'alice', password: 'secret' },
      trustSslFailures: true,
      trustedSslFailures: 'unknown-ca',
    });
    mockState.runSvnText.mockResolvedValue('');

    await externalsUpdate('C:\\wc', 'lib');

    expect(mockState.getNetworkOptionsForWorkingCopyPath).toHaveBeenCalledWith('C:\\wc\\lib');
    expect(mockState.runSvnText).toHaveBeenCalledWith(['update', '--', 'C:\\wc\\lib'], {
      credentials: { username: 'alice', password: 'secret' },
      trustSslFailures: true,
      trustedSslFailures: 'unknown-ca',
    });
  });

  it('updates the owning working copy when a selected external has not been materialized', async () => {
    mockState.existsSync.mockReturnValue(false);
    mockState.runSvnText.mockResolvedValue('');

    await expect(externalsUpdate('C:\\wc', 'new-lib')).resolves.toEqual({ success: true });

    expect(mockState.runSvnText).toHaveBeenCalledWith(['update', '--', 'C:\\wc'], {
      trustSslFailures: false,
    });
  });
});

describe('svn-metadata shelving', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists shelves using SVN XML output', async () => {
    mockState.runSvnText.mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<shelves>
  <shelf name="work" date="2026-04-29T08:00:00.000Z">
    <path>C:/wc</path>
    <date>2026-04-29T08:00:00.000Z</date>
  </shelf>
</shelves>`);

    const result = await shelveList('C:\\wc');

    expect(result.shelves).toEqual([
      { name: 'work', date: '2026-04-29T08:00:00.000Z', path: 'C:/wc' },
    ]);
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'shelve',
      '--list',
      '--xml',
      '--',
      'C:\\wc',
    ]);
  });

  it('saves, applies, and deletes shelves with SVN 1.14 commands', async () => {
    mockState.runSvnText.mockResolvedValue('');

    await expect(shelveSave('work', 'C:\\wc', 'WIP changes')).resolves.toEqual({ success: true });
    await expect(shelveApply('work', 'C:\\wc')).resolves.toEqual({ success: true });
    await expect(shelveDelete('work', 'C:\\wc')).resolves.toEqual({ success: true });

    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'shelve',
      'work',
      '-m',
      'WIP changes',
      '--',
      'C:\\wc',
    ]);
    expect(mockState.runSvnText).toHaveBeenCalledWith(['unshelve', 'work', '--', 'C:\\wc']);
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'shelve',
      '--delete',
      'work',
      '--',
      'C:\\wc',
    ]);
  });

  it('uses portable shelving when the active SVN binary lacks shelving commands', async () => {
    mockState.runSvnText.mockRejectedValue(new Error('"shelve": unknown command.'));

    await expect(shelveList('C:\\wc')).resolves.toEqual({ shelves: [] });
    await expect(shelveSave('work', 'C:\\wc', 'WIP changes')).resolves.toEqual({ success: true });
    await expect(shelveApply('work', 'C:\\wc')).resolves.toEqual({ success: true });
    await expect(shelveDelete('work', 'C:\\wc')).resolves.toEqual({ success: true });
    expect(mockState.portableShelfList).toHaveBeenCalledWith('C:\\wc');
    expect(mockState.portableShelfSave).toHaveBeenCalledWith('work', 'C:\\wc', 'WIP changes');
    expect(mockState.portableShelfApply).toHaveBeenCalledWith('work', 'C:\\wc');
    expect(mockState.portableShelfDelete).toHaveBeenCalledWith('work', 'C:\\wc');
  });

  it('distinguishes shelf read failures from an empty shelf list', async () => {
    mockState.runSvnText.mockRejectedValue(new Error('svn: E170013: Unable to connect'));
    await expect(shelveList('C:\\wc')).resolves.toMatchObject({
      shelves: [],
      error: 'svn: E170013: Unable to connect',
      errorCode: 'E170013',
      commandError: {
        category: 'network',
        retryable: true,
      },
    });
  });
});

describe('svn-metadata properties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists, sets, and deletes common SVN properties', async () => {
    mockState.runSvnText.mockResolvedValueOnce(`<?xml version="1.0" encoding="UTF-8"?>
<properties>
  <target path="C:/wc">
    <property name="svn:ignore">dist</property>
    <property name="svn:mime-type">text/plain</property>
  </target>
</properties>`);

    await expect(proplist('C:\\wc')).resolves.toEqual({
      properties: [
        { name: 'svn:ignore', value: 'dist' },
        { name: 'svn:mime-type', value: 'text/plain' },
      ],
    });
    await expect(propset('C:\\wc', 'svn:eol-style', 'native')).resolves.toEqual({
      success: true,
    });
    await expect(propdel('C:\\wc', 'svn:keywords')).resolves.toEqual({ success: true });

    expect(mockState.runSvnText).toHaveBeenCalledWith(['proplist', '--xml', '-v', '--', 'C:\\wc']);
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'propset',
      'svn:eol-style',
      'native',
      '--',
      'C:\\wc',
    ]);
    expect(mockState.runSvnText).toHaveBeenCalledWith(['propdel', 'svn:keywords', '--', 'C:\\wc']);
  });

  it('rejects malformed property names before invoking SVN', async () => {
    await expect(propset('C:\\wc', 'bad property', 'value')).rejects.toThrow(
      /property name must begin/i
    );
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('gets recursive and inherited properties at a revision', async () => {
    mockState.runSvnText.mockResolvedValue('*.tmp\n');
    await expect(
      propget('https://svn.example.com/repo/trunk', 'svn:global-ignores', {
        revision: '42',
        depth: 'infinity',
        showInherited: true,
      })
    ).resolves.toEqual({ value: '*.tmp\n' });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'propget',
      'svn:global-ignores',
      '-r',
      '42',
      '--depth',
      'infinity',
      '--show-inherited-props',
      '--',
      'https://svn.example.com/repo/trunk',
    ]);
  });

  it('lists inherited properties at an operative revision', async () => {
    mockState.runSvnText.mockResolvedValue('<properties />');

    await expect(
      proplist('https://svn.example.com/repo/trunk', {
        revision: '42',
        depth: 'empty',
        showInherited: true,
      })
    ).resolves.toEqual({ properties: [] });
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'proplist',
      '--xml',
      '-v',
      '-r',
      '42',
      '--depth',
      'empty',
      '--show-inherited-props',
      '--',
      'https://svn.example.com/repo/trunk',
    ]);
  });

  it('supports committed URL properties and explicit revision-property operations', async () => {
    mockState.runSvnText.mockResolvedValue('property output');
    mockState.runSvnMuccText.mockResolvedValue('property output');
    await expect(
      propsetRemote('https://svn.example.com/repo/trunk', 'custom:owner', 'team', 'set owner')
    ).resolves.toEqual({ success: true, output: 'property output' });
    await expect(
      propdelRemote('https://svn.example.com/repo/trunk', 'custom:owner', 'remove owner')
    ).resolves.toEqual({ success: true, output: 'property output' });
    await expect(revpropget('https://svn.example.com/repo', 'svn:log', '12')).resolves.toEqual({
      value: 'property output',
    });
    await expect(
      revpropset('https://svn.example.com/repo', 'svn:log', 'corrected', '12')
    ).resolves.toEqual({ success: true });
    await expect(
      revpropdel('https://svn.example.com/repo', 'custom:reviewed', '12')
    ).resolves.toEqual({ success: true });

    expect(mockState.runSvnMuccText).toHaveBeenCalledWith([
      '-m',
      'set owner',
      'propset',
      'custom:owner',
      'team',
      'https://svn.example.com/repo/trunk',
    ]);
    expect(mockState.runSvnMuccText).toHaveBeenCalledWith([
      '-m',
      'remove owner',
      'propdel',
      'custom:owner',
      'https://svn.example.com/repo/trunk',
    ]);
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'propget',
      '--revprop',
      '-r',
      '12',
      'svn:log',
      '--',
      'https://svn.example.com/repo',
    ]);
  });

  it('rejects unsafe property revisions and remote working-copy targets', async () => {
    await expect(propget('C:\\wc', 'svn:ignore', { revision: '1:2' })).resolves.toMatchObject({
      error: expect.stringMatching(/invalid svn revision/i),
      commandError: { category: 'validation', command: 'propget', target: 'C:\\wc' },
    });
    await expect(propsetRemote('C:\\wc', 'custom:x', 'y', 'message')).rejects.toThrow(
      /must be an svn url/i
    );
    await expect(propdelRemote('C:\\wc', 'custom:x', 'message')).rejects.toThrow(
      /must be an svn url/i
    );
  });
});
