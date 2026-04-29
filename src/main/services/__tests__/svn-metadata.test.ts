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

import { shelveApply, shelveDelete, shelveList, shelveSave } from '../svn-metadata';

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
