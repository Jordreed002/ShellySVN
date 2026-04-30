import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadMergeEditorContents } from '../src/components/ui/ConflictResolutionWizard';
import { ThreeWayMergeEditor } from '../src/components/ui/ThreeWayMergeEditor';

vi.mock('../src/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      diffMerge: {
        mergeTool: '',
        fileTypeOverrides: [],
      },
    },
  }),
}));

describe('three-way merge editor loading', () => {
  const listDirectory = vi.fn();
  const readFile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        fs: {
          listDirectory,
          readFile,
        },
      },
    });
  });

  it('loads base, mine, theirs, and merged conflict artifacts from SVN file naming', async () => {
    listDirectory.mockResolvedValue([
      { name: 'app.ts.mine', path: 'C:/wc/src/app.ts.mine', isDirectory: false },
      { name: 'app.ts.r10', path: 'C:/wc/src/app.ts.r10', isDirectory: false },
      { name: 'app.ts.r14', path: 'C:/wc/src/app.ts.r14', isDirectory: false },
    ]);
    readFile.mockImplementation((path: string) =>
      Promise.resolve({
        success: true,
        content: {
          'C:/wc/src/app.ts.r10': 'base content',
          'C:/wc/src/app.ts.mine': 'mine content',
          'C:/wc/src/app.ts.r14': 'theirs content',
          'C:/wc/src/app.ts': 'merged content with conflict markers',
        }[path],
      })
    );

    await expect(loadMergeEditorContents('C:/wc/src/app.ts')).resolves.toEqual({
      baseContent: 'base content',
      mineContent: 'mine content',
      theirsContent: 'theirs content',
      mergedContent: 'merged content with conflict markers',
    });
    expect(readFile).toHaveBeenCalledWith('C:/wc/src/app.ts.r10');
    expect(readFile).toHaveBeenCalledWith('C:/wc/src/app.ts.mine');
    expect(readFile).toHaveBeenCalledWith('C:/wc/src/app.ts.r14');
    expect(readFile).toHaveBeenCalledWith('C:/wc/src/app.ts');
  });

  it('renders loaded base, mine, theirs, and merged conflict content in the editor', async () => {
    render(
      <ThreeWayMergeEditor
        isOpen
        filePath="C:/wc/src/app.ts"
        baseContent={'shared line\nbase-only line'}
        mineContent={'shared line\nmine-only line'}
        theirsContent={'shared line\ntheirs-only line'}
        mergedContent={[
          'shared line',
          '<<<<<<< .mine',
          'mine-only line',
          '=======',
          'theirs-only line',
          '>>>>>>> .r14',
        ].join('\n')}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(await screen.findByText('Base (Common Ancestor)')).toBeInTheDocument();
    expect(screen.getByText('base-only line')).toBeInTheDocument();
    expect(screen.getAllByText('mine-only line').length).toBeGreaterThan(0);
    expect(screen.getAllByText('theirs-only line').length).toBeGreaterThan(0);
    expect(screen.getByText('Choose resolution from left panels')).toBeInTheDocument();
  });
});
