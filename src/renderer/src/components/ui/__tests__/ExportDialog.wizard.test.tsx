import React from 'react';
import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnListResult, SvnOperationProgress } from '@shared/types';
import { ExportDialog } from '../ExportDialog';

const SOURCE_URL = 'svn://example.com/repo/trunk';
const DEST_PATH = '/exports/my-project';

function makeListing(
  entries: Array<{ name: string; kind: 'file' | 'dir'; size?: number }> = []
): SvnListResult {
  return {
    path: SOURCE_URL,
    entries: entries.map((entry) => ({
      name: entry.name,
      path: `${SOURCE_URL}/${entry.name}`,
      url: `${SOURCE_URL}/${entry.name}`,
      kind: entry.kind,
      size: entry.size,
      revision: 12,
      author: 'someone',
      date: '2026-01-01T00:00:00Z',
    })),
  };
}

async function walkToReview(
  listResult: SvnListResult | Error = makeListing([
    { name: 'a.txt', kind: 'file', size: 512 },
    { name: 'b.txt', kind: 'file', size: 512 },
    { name: 'src', kind: 'dir' },
  ]),
  props: Partial<Parameters<typeof ExportDialog>[0]> = {}
): Promise<void> {  if (listResult instanceof Error) {
    window.api.svn.list = vi.fn().mockRejectedValue(listResult);
  } else {
    window.api.svn.list = vi.fn().mockResolvedValue(listResult);
  }
  window.api.dialog.openDirectory = vi.fn().mockResolvedValue(DEST_PATH);

  render(<ExportDialog isOpen onClose={() => undefined} initialPath={SOURCE_URL} {...props} />);

  // Step 1 → 2
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  // Step 2 → 3 (destination via the native picker; its promise resolves async)
  fireEvent.click(screen.getByRole('button', { name: /browse/i }));
  const nextFromOptions = screen.getByRole('button', { name: /next/i });
  await waitFor(() => expect(nextFromOptions).not.toBeDisabled());
  fireEvent.click(nextFromOptions);
}

function exportProgress(partial: Partial<SvnOperationProgress>): SvnOperationProgress {
  return {
    operationId: 'export-op-1',
    operation: 'export',
    status: 'running',
    filesProcessed: 0,
    ...partial,
  };
}

describe('ExportDialog wizard', () => {
  beforeEach(() => {
    window.api = createMockElectronAPI();
    window.api.svn.exportWithProgress = vi.fn();
    window.api.svn.cancelOperation = vi.fn().mockResolvedValue({ success: true });
    window.api.svn.list = vi.fn().mockResolvedValue(makeListing([]));
    window.api.external.revealPath = vi.fn().mockResolvedValue({ success: true });
  });

  afterEach(cleanup);

  it('steps source → options → review and gates Next on required input', () => {
    render(<ExportDialog isOpen onClose={() => undefined} />);
    const next = screen.getByRole('button', { name: /next/i });
    expect(next).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/source url or path/i), {
      target: { value: SOURCE_URL },
    });
    expect(screen.getByText('Repository URL')).toBeTruthy();
    expect(next).not.toBeDisabled();

    fireEvent.click(next);
    expect(screen.getByRole('heading', { name: /export options/i })).toBeTruthy();

    // Destination is required before the review step.
    const nextFromOptions = screen.getByRole('button', { name: /next/i });
    expect(nextFromOptions).toBeDisabled();
  });

  it('marks a local path source (BASE available) and disables BASE for URL sources', () => {
    const { unmount } = render(
      <ExportDialog isOpen onClose={() => undefined} initialPath="/work/my-copy" />
    );
    expect(screen.getByText('Working copy path')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('radio', { name: /BASE — pristine revision/i })).not.toBeDisabled();

    unmount();

    render(<ExportDialog isOpen onClose={() => undefined} initialPath={SOURCE_URL} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByRole('radio', { name: /BASE — pristine revision/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /HEAD — latest/i })).not.toBeDisabled();
    expect(screen.getByRole('radio', { name: /specific revision/i })).not.toBeDisabled();
  });

  it('disables depth, ignore-externals and native EOL with an honest pending-backend note', () => {
    render(<ExportDialog isOpen onClose={() => undefined} initialPath={SOURCE_URL} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByRole('radio', { name: 'Fully recursive' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Immediate children only' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'File only' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Ignore externals' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /convert line endings/i })).toBeDisabled();

    const notes = screen.getAllByText(/pending backend/i);
    expect(notes.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a non-numeric specific revision before leaving the options step', () => {
    render(<ExportDialog isOpen onClose={() => undefined} initialPath={SOURCE_URL} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    window.api.dialog.openDirectory = vi.fn().mockResolvedValue(DEST_PATH);
    fireEvent.click(screen.getByRole('button', { name: /browse/i }));
    fireEvent.click(screen.getByRole('radio', { name: /specific revision/i }));
    fireEvent.change(screen.getByLabelText(/specific revision number/i), {
      target: { value: 'twelve' },
    });

    expect(screen.getByRole('alert').textContent).toContain('positive number');
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('shows a dry-run estimate from svn:list and an honest unknown fallback', async () => {
    await walkToReview();

    expect(await screen.findByTestId('export-estimate')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/≈ 2 files/)).toBeTruthy();
    });
    expect(screen.getByText(/1 KB/)).toBeTruthy();
    expect(window.api.svn.list).toHaveBeenCalledWith(SOURCE_URL, undefined, 'infinity');
  });

  it('falls back to unknown when the listing fails, without blocking the export', async () => {
    await walkToReview(new Error('repository unavailable'));

    expect(await screen.findByText(/repository listing unavailable/i)).toBeTruthy();
    const start = screen.getByRole('button', { name: /start export/i });
    expect(start).not.toBeDisabled();
  });

  it('plumbs source, destination and pinned revision into exportWithProgress', async () => {
    await walkToReview();

    window.api.svn.exportWithProgress = vi.fn().mockImplementation(
      (_url: string, _path: string, onProgress: (p: SvnOperationProgress) => void) => {
        onProgress(exportProgress({ filesProcessed: 1 }));
        return Promise.resolve({ success: true, revision: 42 });
      }
    );

    // Pin a specific revision from the review recap's back-navigation path.
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    fireEvent.click(screen.getByRole('radio', { name: /specific revision/i }));
    fireEvent.change(screen.getByLabelText(/specific revision number/i), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(await screen.findByRole('button', { name: /start export/i }));

    await waitFor(() => {
      expect(window.api.svn.exportWithProgress).toHaveBeenCalledWith(
        SOURCE_URL,
        DEST_PATH,
        expect.any(Function),
        '42'
      );
    });
    await waitFor(() => screen.getByText('Export complete'));
  });

  it('renders live progress with totals and cancels mid-flight through cancelOperation', async () => {
    await walkToReview();

    let rejectOperation: (reason?: unknown) => void = () => undefined;
    window.api.svn.exportWithProgress = vi.fn().mockImplementation(
      (_url: string, _path: string, onProgress: (p: SvnOperationProgress) => void) => {
        onProgress(
          exportProgress({
            filesProcessed: 3,
            totalFiles: 10,
            currentFile: 'trunk/src/app.tsx',
            bytesTransferred: 2048,
            totalBytes: 8192,
          })
        );
        return new Promise((_resolve, reject) => {
          rejectOperation = reject;
        });
      }
    );

    fireEvent.click(screen.getByRole('button', { name: /start export/i }));

    const status = await screen.findByRole('status');
    // ProgressIndicator prefers byte-based progress when totals exist: 2048/8192.
    expect(status.getAttribute('aria-label')).toContain('25% complete');
    expect(screen.getByText('trunk/src/app.tsx')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(window.api.svn.cancelOperation).toHaveBeenCalledWith('export-op-1');

    await waitFor(() => rejectOperation(new Error('Terminated')));
    expect(await screen.findByText(/export cancelled/i)).toBeTruthy();
    // The cancelled state offers a way back to the review step.
    expect(screen.getByRole('button', { name: /back to review/i })).toBeTruthy();
  });

  it('marks progress as indeterminate when svn reports no totals', async () => {
    await walkToReview();

    window.api.svn.exportWithProgress = vi.fn().mockImplementation(
      (_url: string, _path: string, onProgress: (p: SvnOperationProgress) => void) => {
        onProgress(exportProgress({ filesProcessed: 2 }));
        return new Promise(() => undefined);
      }
    );

    fireEvent.click(screen.getByRole('button', { name: /start export/i }));

    const status = await screen.findByRole('status');
    expect(status.getAttribute('aria-label')).toContain('indeterminate');
  });

  it('summarises completion and reveals the destination in the file manager', async () => {
    await walkToReview();

    window.api.svn.exportWithProgress = vi.fn().mockImplementation(
      (_url: string, _path: string, onProgress: (p: SvnOperationProgress) => void) => {
        onProgress(
          exportProgress({
            filesProcessed: 5,
            bytesTransferred: 2048,
            status: 'completed',
            revision: 12,
          })
        );
        return Promise.resolve({ success: true, revision: 12 });
      }
    );

    fireEvent.click(screen.getByRole('button', { name: /start export/i }));
    await screen.findByText('Export complete');

    const summary = screen.getByTestId('export-summary');
    expect(summary.textContent).toContain('r12');
    expect(summary.textContent).toContain('5');
    expect(summary.textContent).toContain('2 KB');
    expect(summary.textContent).toContain(DEST_PATH);

    fireEvent.click(screen.getByRole('button', { name: /reveal in folder/i }));
    expect(window.api.external.revealPath).toHaveBeenCalledWith(DEST_PATH);
  });

  it('reports failures through the error state and offers a retry path', async () => {
    await walkToReview();

    window.api.svn.exportWithProgress = vi.fn().mockResolvedValue({
      success: false,
      revision: null,
      error: 'svn: E155007: not a working copy',
    });

    fireEvent.click(screen.getByRole('button', { name: /start export/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('E155007');

    fireEvent.click(screen.getByRole('button', { name: /back to review/i }));
    expect(screen.getByRole('heading', { name: /review and export/i })).toBeTruthy();
  });

  it('delivers the destination to onComplete when closed after success', async () => {
    const onComplete = vi.fn();
    const onClose = vi.fn();
    await walkToReview(makeListing(), { onComplete, onClose });

    window.api.svn.exportWithProgress = vi.fn().mockResolvedValue({ success: true, revision: 3 });
    fireEvent.click(screen.getByRole('button', { name: /start export/i }));
    await screen.findByText('Export complete');

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onComplete).toHaveBeenCalledWith(DEST_PATH);
    expect(onClose).toHaveBeenCalled();
  });
});
