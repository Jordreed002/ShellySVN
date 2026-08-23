import React from 'react';
import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnListResult, SvnOperationProgress } from '@shared/types';
import { ImportDialog } from '../ImportDialog';

const SOURCE_PATH = '/projects/my-app';
const REPO_URL = 'svn://example.com/repo/trunk';

function repoEntry(name: string, kind: 'file' | 'dir', size?: number) {
  return {
    name,
    path: `${REPO_URL}/${name}`,
    url: `${REPO_URL}/${name}`,
    kind,
    size,
    revision: 8,
    author: 'someone',
    date: '2026-01-01T00:00:00Z',
  };
}

function listingOf(entries: ReturnType<typeof repoEntry>[]): SvnListResult {
  return { path: REPO_URL, entries };
}

function importProgress(partial: Partial<SvnOperationProgress>): SvnOperationProgress {
  return {
    operationId: 'import-op-9',
    operation: 'import',
    status: 'running',
    filesProcessed: 0,
    ...partial,
  };
}

function fillSource(path = SOURCE_PATH) {
  fireEvent.change(screen.getByLabelText(/source folder/i), { target: { value: path } });
}

function walkToReview() {
  render(<ImportDialog isOpen onClose={() => undefined} />);
  fillSource();
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
  fireEvent.change(screen.getByLabelText(/repository url/i), { target: { value: REPO_URL } });
  fireEvent.change(screen.getByLabelText(/log message/i), { target: { value: 'Initial import' } });
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
}

describe('ImportDialog wizard', () => {
  beforeEach(() => {
    window.api = createMockElectronAPI();
    window.api.svn.importWithProgress = vi.fn();
    window.api.svn.cancelOperation = vi.fn().mockResolvedValue({ success: true });
    window.api.svn.list = vi.fn().mockResolvedValue(listingOf([]));
    window.api.fs.listDirectory = vi.fn().mockResolvedValue([]);
    window.api.fs.getFolderSizes = vi.fn().mockResolvedValue({});
  });

  afterEach(cleanup);

  it('scans the chosen folder and warns about unversioned junk with sizes', async () => {
    window.api.fs.listDirectory = vi.fn().mockResolvedValue([
      { name: 'node_modules', path: `${SOURCE_PATH}/node_modules`, isDirectory: true, size: 0, modifiedTime: '2026-01-01T00:00:00Z' },
      { name: '.git', path: `${SOURCE_PATH}/.git`, isDirectory: true, size: 0, modifiedTime: '2026-01-01T00:00:00Z' },
      { name: 'src', path: `${SOURCE_PATH}/src`, isDirectory: true, size: 0, modifiedTime: '2026-01-01T00:00:00Z' },
    ]);
    window.api.fs.getFolderSizes = vi
      .fn()
      .mockResolvedValue({ [`${SOURCE_PATH}/node_modules`]: 262_144_000 });

    render(<ImportDialog isOpen onClose={() => undefined} />);
    fillSource();

    const advisory = await screen.findByTestId('import-junk-advisory');
    expect(advisory.textContent).toContain('Unversioned junk detected');
    expect(advisory.textContent).toContain('node_modules/');
    expect(advisory.textContent).toContain('250.0 MB');
    expect(advisory.textContent).toContain('Pending backend');
    expect(window.api.fs.getFolderSizes).toHaveBeenCalledWith([`${SOURCE_PATH}/node_modules`, `${SOURCE_PATH}/.git`]);
  });

  it('reassures when the top level is clean and survives scan failures', async () => {
    window.api.fs.listDirectory = vi.fn().mockRejectedValue(new Error('gone'));

    render(<ImportDialog isOpen onClose={() => undefined} />);
    fillSource();

    await waitFor(() => {
      expect(screen.getByText(/junk detection is unavailable/i)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled();
  });

  it('does not scan the same path twice while editing', async () => {
    render(<ImportDialog isOpen onClose={() => undefined} />);
    fillSource();
    await waitFor(() => expect(window.api.fs.listDirectory).toHaveBeenCalledTimes(1));

    // An unrelated re-render trigger (same value) must not rescan.
    fillSource();
    expect(window.api.fs.listDirectory).toHaveBeenCalledTimes(1);
  });

  it('browses repository folders through svn:list and uses the selected URL', async () => {
    window.api.svn.list = vi.fn().mockImplementation(async (url: string) => {
      if (url === REPO_URL) {
        return listingOf([
          repoEntry('branches', 'dir'),
          repoEntry('README.md', 'file', 1200),
        ]);
      }
      return listingOf([repoEntry('1.x', 'dir')]);
    });

    render(<ImportDialog isOpen onClose={() => undefined} />);
    fillSource();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    const browse = screen.getByRole('button', { name: /browse/i });
    expect(browse).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/repository url/i), { target: { value: REPO_URL } });
    expect(browse).not.toBeDisabled();
    fireEvent.click(browse);

    const browserPanel = await screen.findByTestId('import-repo-browser');
    expect(browserPanel.textContent).toContain('branches');
    expect(browserPanel.textContent).toContain('README.md');
    expect(window.api.svn.list).toHaveBeenCalledWith(REPO_URL, undefined, 'immediates');

    // Navigate into a directory, then commit it as the destination.
    fireEvent.click(screen.getByRole('button', { name: 'branches' }));
    await waitFor(() =>
      expect(window.api.svn.list).toHaveBeenCalledWith(
        `${REPO_URL}/branches`,
        undefined,
        'immediates'
      )
    );
    fireEvent.click(screen.getByRole('button', { name: /use this folder/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/repository url/i)).toHaveValue(`${REPO_URL}/branches`);
    });
  });

  it('requires destination and message before the review step', () => {
    render(<ImportDialog isOpen onClose={() => undefined} />);
    fillSource();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    const next = screen.getByRole('button', { name: /next/i });
    expect(next).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/repository url/i), { target: { value: REPO_URL } });
    expect(next).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/log message/i), { target: { value: 'Initial import' } });
    expect(next).not.toBeDisabled();
  });

  it('recaps source, destination, message and junk on the review step', async () => {
    window.api.fs.listDirectory = vi.fn().mockResolvedValue([
      { name: 'node_modules', path: `${SOURCE_PATH}/node_modules`, isDirectory: true, size: 0, modifiedTime: '2026-01-01T00:00:00Z' },
    ]);

    walkToReview();

    const recap = await screen.findByTestId('import-recap');
    expect(recap.textContent).toContain(SOURCE_PATH);
    expect(recap.textContent).toContain(REPO_URL);
    expect(recap.textContent).toContain('Initial import');
    expect(screen.getByTestId('import-junk-advisory').textContent).toContain('node_modules/');
  });

  it('plumbs path, URL and message into importWithProgress and completes with rN', async () => {
    walkToReview();

    window.api.svn.importWithProgress = vi.fn().mockImplementation(
      (_path: string, _url: string, _message: string, onProgress: (p: SvnOperationProgress) => void) => {
        onProgress(importProgress({ filesProcessed: 4, currentFile: 'src/main.ts' }));
        return Promise.resolve({ success: true, revision: 9 });
      }
    );

    fireEvent.click(screen.getByRole('button', { name: /start import/i }));

    await waitFor(() => {
      expect(window.api.svn.importWithProgress).toHaveBeenCalledWith(
        SOURCE_PATH,
        REPO_URL,
        'Initial import',
        expect.any(Function)
      );
    });

    expect(await screen.findByText('Import complete')).toBeTruthy();
    const summary = screen.getByTestId('import-summary');
    expect(summary.textContent).toContain('r9');
    expect(summary.textContent).toContain('4');
    expect(summary.textContent).toContain(REPO_URL);
  });

  it('cancels a running import through cancelOperation', async () => {
    walkToReview();

    let rejectOperation: (reason?: unknown) => void = () => undefined;
    window.api.svn.importWithProgress = vi.fn().mockImplementation(
      (_path: string, _url: string, _message: string, onProgress: (p: SvnOperationProgress) => void) => {
        onProgress(importProgress({ filesProcessed: 2, totalFiles: 6 }));
        return new Promise((_resolve, reject) => {
          rejectOperation = reject;
        });
      }
    );

    fireEvent.click(screen.getByRole('button', { name: /start import/i }));
    await screen.findByRole('status');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(window.api.svn.cancelOperation).toHaveBeenCalledWith('import-op-9');

    await waitFor(() => rejectOperation(new Error('Terminated')));
    expect(await screen.findByText(/import cancelled/i)).toBeTruthy();
    expect(screen.getByText(/nothing was committed/i)).toBeTruthy();
  });

  it('surfaces import failures through the error state', async () => {
    walkToReview();

    window.api.svn.importWithProgress = vi.fn().mockResolvedValue({
      success: false,
      revision: null,
      error: 'svn: E160024: conflict',
    });

    fireEvent.click(screen.getByRole('button', { name: /start import/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('E160024');
    expect(screen.getByRole('button', { name: /back to review/i })).toBeTruthy();
  });

  it('reports the committed revision to onComplete on close', async () => {
    const onComplete = vi.fn();
    const onClose = vi.fn();
    render(<ImportDialog isOpen onClose={onClose} onComplete={onComplete} />);
    fillSource();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.change(screen.getByLabelText(/repository url/i), { target: { value: REPO_URL } });
    fireEvent.change(screen.getByLabelText(/log message/i), { target: { value: 'Initial import' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    window.api.svn.importWithProgress = vi.fn().mockResolvedValue({ success: true, revision: 31 });
    fireEvent.click(screen.getByRole('button', { name: /start import/i }));
    await screen.findByText('Import complete');

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onComplete).toHaveBeenCalledWith(31);
    expect(onClose).toHaveBeenCalled();
  });
});
