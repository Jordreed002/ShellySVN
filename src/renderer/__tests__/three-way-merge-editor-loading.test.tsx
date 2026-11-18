import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadMergeEditorContents } from '../src/components/ui/ConflictResolutionWizard';
import { ThreeWayMergeEditor } from '../src/components/ui/ThreeWayMergeEditor';

const mockConfirmAppAction = vi.hoisted(() => vi.fn());

vi.mock('../src/utils/dialogs', () => ({
  confirmAppAction: (options: unknown) => mockConfirmAppAction(options),
}));

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
          '||||||| .r10',
          'base-only line',
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

  it('prompts before discarding unsaved changes and keeps failed saves open', async () => {
    mockConfirmAppAction.mockResolvedValue(false);
    const onClose = vi.fn();
    const onSave = vi.fn().mockRejectedValue(new Error('disk is full'));

    render(
      <ThreeWayMergeEditor
        isOpen
        filePath="C:/wc/src/app.ts"
        baseContent="base line"
        mineContent="mine line"
        theirsContent="theirs line"
        mergedContent={[
          '<<<<<<< .mine',
          'mine line',
          '=======',
          'theirs line',
          '>>>>>>> .r14',
        ].join('\n')}
        onClose={onClose}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /use mine/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(mockConfirmAppAction).toHaveBeenCalledWith(
        expect.objectContaining({ confirmLabel: 'Discard' })
      );
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /save merged file/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('disk is full');
    expect(onClose).not.toHaveBeenCalled();

    mockConfirmAppAction.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: /revert changes/i }));

    await waitFor(() => {
      expect(screen.getByText('Choose resolution from left panels')).toBeInTheDocument();
    });
  });

  it.each([
    ['Use All Mine', 'mine one', 'mine two'],
    ['Use All Theirs', 'theirs one', 'theirs two'],
  ])('saves only conflict-region content with %s', async (button, first, second) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ThreeWayMergeEditor
        isOpen
        filePath="C:/wc/app.ts"
        mineContent={'header\nmine one\nmiddle\nmine two\nfooter\n'}
        theirsContent={'header\ntheirs one\nmiddle\ntheirs two\nfooter\n'}
        baseContent={'header\nbase one\nmiddle\nbase two\nfooter\n'}
        mergedContent={[
          'header',
          '<<<<<<< .mine',
          'mine one',
          '=======',
          'theirs one',
          '>>>>>>> .r14',
          'middle',
          '<<<<<<< .mine',
          'mine two',
          '=======',
          'theirs two',
          '>>>>>>> .r14',
          'footer',
          '',
        ].join('\n')}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: button }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Merged File' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(`header\n${first}\nmiddle\n${second}\nfooter\n`, 'resolve')
    );
  });

  it('uses inline ancestor regions and preserves surrounding content', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ThreeWayMergeEditor
        isOpen
        filePath="C:/wc/app.ts"
        mineContent={'header\nmine\nfooter'}
        theirsContent={'header\ntheirs\nfooter'}
        baseContent={'header\nbase\nfooter'}
        mergedContent={
          'header\n<<<<<<< .mine\nmine\n||||||| .r10\nbase\n=======\ntheirs\n>>>>>>> .r14\nfooter'
        }
        onClose={vi.fn()}
        onSave={onSave}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Merged File' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('header\nbase\nfooter', 'resolve'));
  });

  it('disables ancestor resolution when only the full base file is available', () => {
    render(
      <ThreeWayMergeEditor
        isOpen
        filePath="C:/wc/app.ts"
        mineContent={'header\nmine\nfooter'}
        theirsContent={'header\ntheirs\nfooter'}
        baseContent={'header\nbase\nfooter'}
        mergedContent={'header\n<<<<<<< .mine\nmine\n=======\ntheirs\n>>>>>>> .r14\nfooter'}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Use', exact: true })).toBeDisabled();
    expect(
      screen.getByText('Ancestor content is unavailable for this conflict region')
    ).toBeInTheDocument();
  });

  it('preserves unresolved diff3 markers exactly when saving', async () => {
    mockConfirmAppAction.mockResolvedValue(true);
    const onSave = vi.fn().mockResolvedValue(undefined);
    const source =
      'header\n<<<<<<< .mine\nmine\n||||||| .r10\nbase\n=======\ntheirs\n>>>>>>> .r14\nfooter\n';
    render(
      <ThreeWayMergeEditor
        isOpen
        filePath="C:/wc/app.ts"
        mineContent="whole mine"
        theirsContent="whole theirs"
        baseContent="whole base"
        mergedContent={source}
        onClose={vi.fn()}
        onSave={onSave}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save Merged File' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(source, 'draft'));
  });
});
