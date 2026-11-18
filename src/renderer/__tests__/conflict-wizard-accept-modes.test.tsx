import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictResolutionWizard } from '../src/components/ui/ConflictResolutionWizard';

const mockUseSettings = vi.hoisted(() => vi.fn());

vi.mock('../src/hooks/useSettings', () => ({
  useSettings: () => mockUseSettings(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function conflictRegion(mine: string, theirs: string): string {
  return ['<<<<<<< .mine', mine, '=======', theirs, '>>>>>>> .r14'].join('\n');
}

describe('conflict wizard accept modes, previews, and batch resolution (#55)', () => {
  const resolve = vi.fn();
  const cat = vi.fn();
  const listDirectory = vi.fn();
  const readFile = vi.fn();
  const writeFile = vi.fn();
  const confirm = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    writeFile.mockResolvedValue({ success: true });
    confirm.mockResolvedValue(true);
    mockUseSettings.mockReturnValue({
      settings: {
        diffMerge: {
          externalDiffTool: '',
          externalMergeTool: '',
          externalToolOverrides: [],
        },
      },
    });
    resolve.mockResolvedValue({ success: true });
    cat.mockResolvedValue({
      target: 'src/app.ts',
      revision: 'BASE',
      contentBase64: btoa('base from svn cat'),
      byteLength: 16,
      binary: false,
      truncated: false,
    });
    listDirectory.mockResolvedValue([
      { name: 'app.ts', path: 'src/app.ts', isDirectory: false, size: 100, modifiedTime: '2026-01-01T00:00:00Z' },
      { name: 'app.ts.mine', path: 'src/app.ts.mine', isDirectory: false, size: 90, modifiedTime: '2026-01-01T00:00:00Z' },
      { name: 'app.ts.r10', path: 'src/app.ts.r10', isDirectory: false, size: 80, modifiedTime: '2026-01-01T00:00:00Z' },
      { name: 'app.ts.r14', path: 'src/app.ts.r14', isDirectory: false, size: 85, modifiedTime: '2026-01-01T00:00:00Z' },
    ]);
    readFile.mockImplementation((path: string) =>
      Promise.resolve({
        success: true,
        content: {
          'src/app.ts.mine': 'mine content line A',
          'src/app.ts.r10': 'base content',
          'src/app.ts.r14': 'theirs content line Z',
          'src/app.ts': 'merged working content',
        }[path],
      })
    );

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        svn: { resolve, cat },
        fs: { listDirectory, readFile, writeFile },
        dialog: { confirm },
      },
    });
  });

  function openMergeWizard(conflictPaths: string[]) {
    const props = { conflictPaths, workingCopyPath: '/wc', onClose: vi.fn() };
    const view = render(<ConflictResolutionWizard isOpen {...props} />, {
      wrapper: createWrapper(),
    });
    fireEvent.click(screen.getByText('resolve'));
    return { ...view, props };
  }

  it('discards an old merge read after moving to a different file', async () => {
    const a = 'src/a.ts';
    const b = 'src/b.ts';
    listDirectory.mockResolvedValue(
      ['a.ts.mine', 'b.ts.mine'].map((name) => ({ name, isDirectory: false }))
    );
    const aConflict = conflictRegion('A mine', 'A theirs');
    const bConflict = conflictRegion('B mine', 'B theirs');
    readFile.mockImplementation(async (path: string) => ({
      success: true,
      content: path === a ? aConflict : bConflict,
    }));
    openMergeWizard([a, b]);
    await waitFor(() => expect(readFile).toHaveBeenCalledWith(b));

    let finishA!: (result: { success: boolean; content: string }) => void;
    const delayedA = new Promise<{ success: boolean; content: string }>((resolve) => {
      finishA = resolve;
    });
    readFile.mockImplementation((path: string) =>
      path === a ? delayedA : Promise.resolve({ success: true, content: bConflict })
    );

    const openEditor = () =>
      fireEvent.click(screen.getByRole('button', { name: /Open Built-in Merge Editor/ }));
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Defer' }));
    await screen.findByText('Conflict 2 of 2');
    openEditor();
    await screen.findByRole('button', { name: 'Use All Mine' });

    await act(async () => finishA({ success: true, content: aConflict }));
    expect(screen.queryByText('A mine')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use All Mine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Merged File' }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(b, 'working'));
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(b, 'B mine');
  });

  it('discards a pending read when the wizard closes and reopens for the same file', async () => {
    const path = 'src/app.ts';
    const conflict = conflictRegion('mine', 'theirs');
    readFile.mockResolvedValue({ success: true, content: conflict });
    const { rerender, props } = openMergeWizard([path]);
    await waitFor(() => expect(readFile).toHaveBeenCalledWith(path));

    let finishRead!: (result: { success: boolean; content: string }) => void;
    const pendingRead = new Promise<{ success: boolean; content: string }>((resolve) => {
      finishRead = resolve;
    });
    readFile.mockImplementation((requestedPath: string) =>
      requestedPath === path
        ? pendingRead
        : Promise.resolve({ success: true, content: 'artifact' })
    );
    fireEvent.click(screen.getByRole('button', { name: /Open Built-in Merge Editor/ }));
    rerender(<ConflictResolutionWizard isOpen={false} {...props} />);
    rerender(<ConflictResolutionWizard isOpen {...props} />);
    fireEvent.click(screen.getByText('resolve'));

    await act(async () => finishRead({ success: true, content: conflict }));
    expect(screen.queryByRole('button', { name: 'Save Merged File' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Built-in Merge Editor/ })).toBeEnabled();
  });

  it('saves a partial merge as a draft without clearing SVN conflict status', async () => {
    const remaining = conflictRegion('second mine', 'second theirs');
    readFile.mockResolvedValue({
      success: true,
      content: `${conflictRegion('first mine', 'first theirs')}\n${remaining}`,
    });
    openMergeWizard(['src/app.ts']);
    fireEvent.click(screen.getByRole('button', { name: /Open Built-in Merge Editor/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Mine', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Merged File' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save Merged File' })).not.toBeInTheDocument()
    );
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Save Draft' }));
    expect(writeFile).toHaveBeenCalledExactlyOnceWith('src/app.ts', `first mine\n${remaining}`);
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByText('0/1 resolved')).toBeInTheDocument();
  });

  it('keeps the editor open and reports text saved when SVN rejects resolution', async () => {
    readFile.mockResolvedValue({
      success: true,
      content: conflictRegion('mine', 'theirs'),
    });
    resolve.mockResolvedValueOnce({ success: false, error: 'Working copy locked' });
    openMergeWizard(['src/app.ts']);
    fireEvent.click(screen.getByRole('button', { name: /Open Built-in Merge Editor/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use All Mine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Merged File' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'File saved, but SVN could not mark it resolved: Working copy locked'
    );
    expect(writeFile).toHaveBeenCalledExactlyOnceWith('src/app.ts', 'mine');
    expect(screen.getByText('0/1 resolved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revert Changes' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save Merged File' }));
    await waitFor(() => expect(screen.getByText('1/1 resolved')).toBeInTheDocument());
  });

  it('offers every svn accept mode for text conflicts with plain-language consequences', async () => {
    render(
      <ConflictResolutionWizard
        isOpen
        conflictPaths={['src/app.ts']}
        workingCopyPath="/wc"
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByText('resolve'));

    // Two primary side-picking buttons…
    expect(screen.getByRole('button', { name: /^Use Mine/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Use Theirs/i })).toBeInTheDocument();
    // …plus the remaining accept modes with consequence descriptions.
    expect(screen.getByRole('button', { name: 'Keep my conflicting sections' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take their conflicting sections' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revert to base' })).toBeInTheDocument();
    expect(screen.getByText(/Both sides are discarded/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revert to base' }));
    await waitFor(() => {
      expect(resolve).toHaveBeenCalledWith('src/app.ts', 'base');
    });
  });

  it('runs section-level accept modes through svn resolve', async () => {
    render(
      <ConflictResolutionWizard
        isOpen
        conflictPaths={['src/app.ts']}
        workingCopyPath="/wc"
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByText('resolve'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep my conflicting sections' }));

    await waitFor(() => {
      expect(resolve).toHaveBeenCalledWith('src/app.ts', 'mine-conflict');
    });
  });

  it('previews mine/theirs/base/merged — base via svn cat at BASE', async () => {
    render(
      <ConflictResolutionWizard
        isOpen
        conflictPaths={['src/app.ts']}
        workingCopyPath="/wc"
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByText('resolve'));

    fireEvent.click(screen.getByRole('button', { name: 'mine' }));
    expect(await screen.findByText('mine content line A')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'theirs' }));
    expect(await screen.findByText('theirs content line Z')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'base' }));
    await waitFor(() => {
      expect(cat).toHaveBeenCalledWith('src/app.ts', 'BASE');
    });
    expect(await screen.findByText('base from svn cat')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'merged' }));
    expect(await screen.findByText('merged working content')).toBeInTheDocument();
  });

  it('quick-compares mine against theirs on the shared diff surface', async () => {
    render(
      <ConflictResolutionWizard
        isOpen
        conflictPaths={['src/app.ts']}
        workingCopyPath="/wc"
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByText('resolve'));
    fireEvent.click(screen.getByRole('button', { name: 'Compare mine vs theirs' }));

    expect(
      await screen.findByText(/Mine vs theirs — 1 line added, 1 line removed/)
    ).toBeInTheDocument();
  });

  it('batch resolves with per-conflict mode overrides after a per-conflict confirmation', async () => {
    listDirectory.mockResolvedValue([
      { name: 'a.ts', path: 'src/a.ts', isDirectory: false, size: 10, modifiedTime: '2026-01-01T00:00:00Z' },
      { name: 'a.ts.mine', path: 'src/a.ts.mine', isDirectory: false, size: 10, modifiedTime: '2026-01-01T00:00:00Z' },
      { name: 'b.ts', path: 'src/b.ts', isDirectory: false, size: 10, modifiedTime: '2026-01-01T00:00:00Z' },
    ]);

    render(
      <ConflictResolutionWizard
        isOpen
        conflictPaths={['src/a.ts', 'src/b.ts']}
        workingCopyPath="/wc"
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper() }
    );

    // Overview step hosts the batch panel.
    expect(screen.getByTestId('batch-resolve-panel')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Default resolution mode'), {
      target: { value: 'theirs-full' },
    });
    fireEvent.change(screen.getByLabelText('Override for b.ts'), {
      target: { value: 'postpone' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Review batch for 2 conflicts/i }));

    // Final confirmation summarizes the chosen action per conflict.
    const confirmation = await screen.findByTestId('batch-confirmation');
    expect(confirmation).toHaveTextContent('Use their version (full)');
    expect(confirmation).toHaveTextContent('Takes theirs, discards yours');
    expect(confirmation).toHaveTextContent('1 conflict(s) left unresolved');

    fireEvent.click(screen.getByRole('button', { name: /^Resolve 1$/i }));

    await waitFor(() => {
      expect(resolve).toHaveBeenCalledTimes(1);
    });
    expect(resolve).toHaveBeenCalledWith('src/a.ts', 'theirs-full');
    expect(resolve).not.toHaveBeenCalledWith('src/b.ts', expect.anything());
  });

  it('routes property and binary conflicts to their dedicated flows', async () => {
    listDirectory.mockResolvedValue([
      { name: 'props.txt', path: 'src/props.txt', isDirectory: false, size: 10, modifiedTime: '2026-01-01T00:00:00Z' },
      { name: 'props.txt.mine.prej', path: 'src/props.txt.mine.prej', isDirectory: false, size: 10, modifiedTime: '2026-01-01T00:00:00Z' },
      { name: 'logo.png', path: 'src/logo.png', isDirectory: false, size: 10, modifiedTime: '2026-01-01T00:00:00Z' },
      { name: 'logo.png.mine', path: 'src/logo.png.mine', isDirectory: false, size: 10, modifiedTime: '2026-01-01T00:00:00Z' },
      { name: 'logo.png.r9', path: 'src/logo.png.r9', isDirectory: false, size: 10, modifiedTime: '2026-01-01T00:00:00Z' },
      { name: 'logo.png.r12', path: 'src/logo.png.r12', isDirectory: false, size: 10, modifiedTime: '2026-01-01T00:00:00Z' },
    ]);
    readFile.mockImplementation((path: string) =>
      Promise.resolve({
        success: true,
        content: path === 'src/logo.png' ? 'bin\u0000ary' : 'prop reject text',
      })
    );

    render(
      <ConflictResolutionWizard
        isOpen
        conflictPaths={['src/props.txt', 'src/logo.png']}
        workingCopyPath="/wc"
        onClose={vi.fn()}
      />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByText('resolve'));
    expect(await screen.findByTestId('property-conflict-panel')).toBeInTheDocument();
    expect(screen.getByTestId('conflict-kind-badge')).toHaveTextContent('property conflict');

    // Move to the binary conflict (second tab).
    const logoTab = screen.getByTitle('src/logo.png');
    fireEvent.click(logoTab);

    expect(await screen.findByTestId('binary-conflict-panel')).toBeInTheDocument();
    expect(screen.getAllByText(/cannot be merged line by line/i).length).toBeGreaterThanOrEqual(2);
  });
});
