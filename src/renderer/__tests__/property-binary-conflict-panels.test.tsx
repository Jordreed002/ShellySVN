import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PropertyConflictPanel } from '../src/components/ui/PropertyConflictPanel';
import { BinaryConflictPanel } from '../src/components/ui/BinaryConflictPanel';

describe('property conflict panel (#56)', () => {
  const proplist = vi.fn();
  const propget = vi.fn();
  const propset = vi.fn();
  const propdel = vi.fn();
  const listDirectory = vi.fn();
  const readFile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    proplist.mockImplementation((_path: string, options?: { revision?: string }) =>
      Promise.resolve(
        options?.revision === 'BASE'
          ? {
              properties: [
                { name: 'svn:eol-style', value: 'LF' },
                { name: 'svn:keywords', value: 'Id' },
              ],
            }
          : {
              properties: [
                { name: 'svn:eol-style', value: 'native' },
                { name: 'svn:keywords', value: 'Id' },
              ],
            }
      )
    );
    propget.mockResolvedValue({
      value: 'CRLF',
      url: 'svn://host/repo/app.txt',
      kind: 'file',
      revision: 15,
      author: 'alice',
      date: '2026-01-01T00:00:00Z',
    });
    propset.mockResolvedValue({ success: true });
    propdel.mockResolvedValue({ success: true });
    listDirectory.mockResolvedValue([
      { name: 'app.txt', path: 'src/app.txt', isDirectory: false, size: 10, modifiedTime: '2026-01-01T00:00:00Z' },
      { name: 'app.txt.mine.prej', path: 'src/app.txt.mine.prej', isDirectory: false, size: 10, modifiedTime: '2026-01-01T00:00:00Z' },
    ]);
    readFile.mockResolvedValue({ success: true, content: "Conflict for property 'svn:eol-style' detected" });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        svn: { proplist, propget, propset, propdel },
        fs: { listDirectory, readFile },
      },
    });
  });

  it('shows mine/theirs/base values and applies the chosen side via propset', async () => {
    const onPropertiesApplied = vi.fn().mockResolvedValue(undefined);

    render(
      <PropertyConflictPanel
        conflictPath="src/app.txt"
        isProcessing={false}
        onPropertiesApplied={onPropertiesApplied}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /load property details/i }));

    // Three value boxes: base LF, mine native, theirs CRLF (from repository HEAD).
    expect(await screen.findByText('LF')).toBeInTheDocument();
    expect(screen.getAllByText('native').length).toBeGreaterThan(0);
    expect(screen.getByText('CRLF')).toBeInTheDocument();
    expect(screen.getByText('theirs from repository @ HEAD')).toBeInTheDocument();

    // Only the changed property is listed; the agreeing one is not.
    expect(screen.queryByText('svn:keywords')).not.toBeInTheDocument();

    // The merged editor starts from your value (you changed it from base).
    expect(screen.getByLabelText('Merged value for svn:eol-style')).toHaveValue('native');

    fireEvent.click(screen.getByRole('button', { name: 'Use their value' }));
    expect(screen.getByLabelText('Merged value for svn:eol-style')).toHaveValue('CRLF');

    fireEvent.click(screen.getByRole('button', { name: /apply 1 property and mark resolved/i }));

    // Final confirmation summarizes the property action.
    expect(await screen.findByText('svn:eol-style: take the incoming value')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /apply and resolve/i }));

    await waitFor(() => {
      expect(propset).toHaveBeenCalledWith('src/app.txt', 'svn:eol-style', 'CRLF');
    });
    await waitFor(() => {
      expect(onPropertiesApplied).toHaveBeenCalledTimes(1);
    });
  });

  it('supports hand-editing the merged result', async () => {
    const onPropertiesApplied = vi.fn().mockResolvedValue(undefined);

    render(
      <PropertyConflictPanel
        conflictPath="src/app.txt"
        isProcessing={false}
        onPropertiesApplied={onPropertiesApplied}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /load property details/i }));
    const editor = await screen.findByLabelText('Merged value for svn:eol-style');
    fireEvent.change(editor, { target: { value: 'CR+LF-mixed' } });

    fireEvent.click(screen.getByRole('button', { name: /apply 1 property and mark resolved/i }));
    fireEvent.click(await screen.findByRole('button', { name: /apply and resolve/i }));

    await waitFor(() => {
      expect(propset).toHaveBeenCalledWith('src/app.txt', 'svn:eol-style', 'CR+LF-mixed');
    });
  });

  it('removes the property when the merged result is emptied', async () => {
    const onPropertiesApplied = vi.fn().mockResolvedValue(undefined);

    render(
      <PropertyConflictPanel
        conflictPath="src/app.txt"
        isProcessing={false}
        onPropertiesApplied={onPropertiesApplied}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /load property details/i }));
    const editor = await screen.findByLabelText('Merged value for svn:eol-style');
    fireEvent.change(editor, { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: /apply 1 property and mark resolved/i }));
    fireEvent.click(await screen.findByRole('button', { name: /apply and resolve/i }));

    await waitFor(() => {
      expect(propdel).toHaveBeenCalledWith('src/app.txt', 'svn:eol-style');
    });
    expect(propset).not.toHaveBeenCalled();
  });
});

describe('binary conflict panel (#56)', () => {
  const listDirectory = vi.fn();
  const confirm = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    listDirectory.mockResolvedValue([
      { name: 'logo.png', path: 'src/logo.png', isDirectory: false, size: 4096, modifiedTime: '2026-06-01T10:00:00Z' },
      { name: 'logo.png.mine', path: 'src/logo.png.mine', isDirectory: false, size: 2048, modifiedTime: '2026-06-01T09:00:00Z' },
      { name: 'logo.png.r9', path: 'src/logo.png.r9', isDirectory: false, size: 1024, modifiedTime: '2026-05-01T09:00:00Z' },
      { name: 'logo.png.r12', path: 'src/logo.png.r12', isDirectory: false, size: 3072, modifiedTime: '2026-05-20T09:00:00Z' },
    ]);
    confirm.mockResolvedValue(true);

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        fs: { listDirectory },
        dialog: { confirm },
      },
    });
  });

  it('shows both sides metadata with revisions and sizes', async () => {
    render(
      <BinaryConflictPanel
        conflictPath="src/logo.png"
        isProcessing={false}
        externalMergeTool=""
        isLaunchingExternalTool={false}
        onOpenExternalMergeTool={vi.fn()}
        onResolve={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /load file details/i }));

    expect(await screen.findByText('Mine (working copy)')).toBeInTheDocument();
    expect(screen.getByText('Base (r9)')).toBeInTheDocument();
    expect(screen.getByText('Theirs (repository r12)')).toBeInTheDocument();
    expect(screen.getByText('4.0 KB')).toBeInTheDocument();
    expect(screen.getByText('3.0 KB')).toBeInTheDocument();
  });

  it('requires explicit confirmation before resolving to a side', async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);

    render(
      <BinaryConflictPanel
        conflictPath="src/logo.png"
        isProcessing={false}
        externalMergeTool=""
        isLaunchingExternalTool={false}
        onOpenExternalMergeTool={vi.fn()}
        onResolve={onResolve}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /keep my file/i }));

    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning',
          message: expect.stringContaining('logo.png'),
          detail: expect.stringContaining('discards the incoming changes'),
        })
      );
    });
    await waitFor(() => {
      expect(onResolve).toHaveBeenCalledWith('mine-full');
    });
  });

  it('respects a cancelled confirmation', async () => {
    confirm.mockResolvedValue(false);
    const onResolve = vi.fn().mockResolvedValue(undefined);

    render(
      <BinaryConflictPanel
        conflictPath="src/logo.png"
        isProcessing={false}
        externalMergeTool=""
        isLaunchingExternalTool={false}
        onOpenExternalMergeTool={vi.fn()}
        onResolve={onResolve}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /take their file/i }));
    await waitFor(() => {
      expect(confirm).toHaveBeenCalled();
    });
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('offers the external merge tool and a working-copy mark-resolved', async () => {
    const onOpenExternalMergeTool = vi.fn().mockResolvedValue(undefined);
    const onResolve = vi.fn().mockResolvedValue(undefined);

    render(
      <BinaryConflictPanel
        conflictPath="src/logo.png"
        isProcessing={false}
        externalMergeTool="kdiff3"
        isLaunchingExternalTool={false}
        onOpenExternalMergeTool={onOpenExternalMergeTool}
        onResolve={onResolve}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /open kdiff3/i }));
    await waitFor(() => {
      expect(onOpenExternalMergeTool).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: /mark resolved, keep the current file/i }));
    await waitFor(() => {
      expect(onResolve).toHaveBeenCalledWith('working');
    });
  });
});
