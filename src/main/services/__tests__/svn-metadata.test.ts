// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(),
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
}));

vi.mock('../../utils/debug', () => ({
  debug: {
    error: vi.fn(),
  },
}));

import {
  externalsEdit,
  externalsList,
  externalsRemove,
  externalsUpdate,
  listRepository,
  propdel,
  proplist,
  propset,
  shelveApply,
  shelveDelete,
  shelveList,
  shelveSave,
} from '../svn-metadata';

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
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'list',
      '--xml',
      '--non-interactive',
      '-r',
      'HEAD',
      '--depth',
      'immediates',
      url,
    ], { credentials: undefined });
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

    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'list',
      '--xml',
      '--non-interactive',
      '-r',
      'HEAD',
      '--depth',
      'immediates',
      'https://svn.example.com/repo/trunk',
    ], { credentials: { username: 'alice', password: 'secret' } });
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
      'https://svn.example.com/tools tools\n-r123 https://svn.example.com/lib-new lib',
      'C:\\wc',
    ]);
  });

  it('lists recursive externals when Windows working-copy paths contain hyphens', async () => {
    mockState.runSvnText.mockResolvedValue(
      'C:\\Users\\alice\\AppData\\Local\\Temp\\shellysvn-release-workflows-abc123\\wc - https://svn.example.com/vendor vendor-lib'
    );

    await expect(externalsList('C:\\Users\\alice\\AppData\\Local\\Temp\\shellysvn-release-workflows-abc123\\wc')).resolves.toEqual([
      {
        name: 'vendor-lib',
        path: 'C:\\Users\\alice\\AppData\\Local\\Temp\\shellysvn-release-workflows-abc123\\wc/vendor-lib',
        revision: undefined,
        url: 'https://svn.example.com/vendor',
      },
    ]);
  });

  it('removes the svn:externals property when the last external is removed', async () => {
    mockState.runSvnText.mockResolvedValueOnce('https://svn.example.com/lib lib');

    await expect(externalsRemove('C:\\wc', 'lib')).resolves.toEqual({ success: true });

    expect(mockState.runSvnText).toHaveBeenLastCalledWith([
      'propdel',
      'svn:externals',
      'C:\\wc',
    ]);
  });

  it('updates all externals or a single external working-copy path', async () => {
    mockState.runSvnText.mockResolvedValue('');

    await expect(externalsUpdate('C:\\wc')).resolves.toEqual({ success: true });
    await expect(externalsUpdate('C:\\wc', 'lib')).resolves.toEqual({ success: true });

    expect(mockState.runSvnText).toHaveBeenCalledWith(['update', 'C:\\wc']);
    expect(mockState.runSvnText).toHaveBeenCalledWith(['update', 'C:\\wc\\lib']);
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

    expect(result.shelves).toEqual([{ name: 'work', date: '2026-04-29T08:00:00.000Z', path: 'C:/wc' }]);
    expect(mockState.runSvnText).toHaveBeenCalledWith(['shelve', '--list', '--xml', 'C:\\wc']);
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
      'C:\\wc',
    ]);
    expect(mockState.runSvnText).toHaveBeenCalledWith(['unshelve', 'work', 'C:\\wc']);
    expect(mockState.runSvnText).toHaveBeenCalledWith(['shelve', '--delete', 'work', 'C:\\wc']);
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

    await expect(proplist('C:\\wc')).resolves.toEqual([
      { name: 'svn:ignore', value: 'dist' },
      { name: 'svn:mime-type', value: 'text/plain' },
    ]);
    await expect(propset('C:\\wc', 'svn:eol-style', 'native')).resolves.toEqual({
      success: true,
    });
    await expect(propdel('C:\\wc', 'svn:keywords')).resolves.toEqual({ success: true });

    expect(mockState.runSvnText).toHaveBeenCalledWith(['proplist', '--xml', '-v', 'C:\\wc']);
    expect(mockState.runSvnText).toHaveBeenCalledWith([
      'propset',
      'svn:eol-style',
      'native',
      'C:\\wc',
    ]);
    expect(mockState.runSvnText).toHaveBeenCalledWith(['propdel', 'svn:keywords', 'C:\\wc']);
  });
});
