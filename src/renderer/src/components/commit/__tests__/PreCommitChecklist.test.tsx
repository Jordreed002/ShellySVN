import React from 'react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PreCommitChecklist } from '../PreCommitChecklist';
import { PRE_COMMIT_CHECKS_KEY } from '../preCommitChecks';

function setupWindowApi(overrides: { storeGet?: unknown } = {}) {
  const storeGet = vi.fn().mockResolvedValue(overrides.storeGet ?? undefined);
  const storeSet = vi.fn().mockResolvedValue(undefined);
  const readFile = vi
    .fn()
    .mockResolvedValue({ success: true, content: 'const a = 1;\nconsole.log(a); // TODO cleanup\n' });
  const scanSecrets = vi.fn().mockResolvedValue({
    findings: [
      {
        path: '/repo/a.ts',
        line: 2,
        column: 1,
        patternId: 'aws-access-key',
        severity: 'critical',
        redactedPreview: 'AKIA…',
      },
    ],
    scannedFileCount: 1,
    skippedBinaryCount: 0,
    skippedOversizeCount: 0,
    truncatedLineCount: 0,
    errorFiles: [],
    cancelled: false,
    durationMs: 5,
  });

  window.api = {
    store: { get: storeGet, set: storeSet },
    fs: { readFile },
    svn: { scanSecrets },
  } as unknown as Window['api'];
  return { storeGet, storeSet, readFile, scanSecrets };
}

describe('PreCommitChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders collapsed with a run button and no findings yet', () => {
    setupWindowApi();
    render(<PreCommitChecklist files={[{ path: '/repo/a.ts' }]} />);
    expect(screen.getByRole('button', { name: 'Run pre-commit checks' })).toBeEnabled();
    expect(screen.getByText('Not run yet')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Pre-commit findings' })).toBeNull();
  });

  it('runs the checks on demand and lists dismissible findings with severities', async () => {
    setupWindowApi();
    render(<PreCommitChecklist files={[{ path: '/repo/a.ts' }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Run pre-commit checks' }));

    await waitFor(() => {
      expect(screen.getByText('2 warnings — commit anyway')).toBeInTheDocument();
    });

    // Expand the panel to see the rows.
    fireEvent.click(screen.getByRole('button', { name: /Pre-commit checks/ }));

    const dismissDebug = screen.getByRole('button', {
      name: 'Dismiss finding: Debug leftover statement',
    });
    expect(dismissDebug).toBeInTheDocument();
    expect(
      screen.getByText('Possible secret (aws-access-key)')
    ).toBeInTheDocument();

    // Findings are dismissible rows.
    fireEvent.click(dismissDebug);
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Dismiss finding: Debug leftover statement' })
      ).toBeNull();
    });
    expect(screen.getByText('1 warning — commit anyway')).toBeInTheDocument();
  });

  it('shows the ErrorPanel banner and keeps retry available when the run throws', async () => {
    const api = setupWindowApi();
    api.readFile.mockRejectedValue(new Error('fs bridge exploded'));
    render(<PreCommitChecklist files={[{ path: '/repo/a.ts' }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Run pre-commit checks' }));

    await waitFor(() => {
      expect(screen.getByText('fs bridge exploded')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('marks results stale when the file selection changes after a run', async () => {
    setupWindowApi();
    const { rerender } = render(<PreCommitChecklist files={[{ path: '/repo/a.ts' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run pre-commit checks' }));
    await waitFor(() => expect(screen.getByText(/warning/)).toBeInTheDocument());

    rerender(
      <PreCommitChecklist files={[{ path: '/repo/a.ts' }, { path: '/repo/b.ts' }]} />
    );
    expect(screen.getByText('Selection changed — run again')).toBeInTheDocument();
  });

  it('loads forbidden patterns and the size threshold from the store', async () => {
    const api = setupWindowApi({
      storeGet: {
        forbiddenPatterns: ['\\.only\\s*\\('],
        oversizedThresholdBytes: 2 * 1024 * 1024,
        toggles: { todoMarkers: false },
      },
    });
    render(<PreCommitChecklist files={[{ path: '/repo/a.ts' }]} />);

    await waitFor(() => expect(api.storeGet).toHaveBeenCalledWith(PRE_COMMIT_CHECKS_KEY));
    fireEvent.click(screen.getByRole('button', { name: 'Run pre-commit checks' }));
    await waitFor(() => expect(screen.getByText(/warning|No findings/)).toBeInTheDocument());
    // TODO markers are toggled off in the stored config, so only the debug
    // leftover and the secret remain.
    await waitFor(() => {
      expect(screen.getByText('2 warnings — commit anyway')).toBeInTheDocument();
    });
  });

  it('disables the run button while submitting and with no files', () => {
    setupWindowApi();
    const { rerender } = render(<PreCommitChecklist files={[]} />);
    expect(screen.getByRole('button', { name: 'Run pre-commit checks' })).toBeDisabled();

    rerender(<PreCommitChecklist files={[{ path: '/repo/a.ts' }]} disabled={true} />);
    expect(screen.getByRole('button', { name: 'Run pre-commit checks' })).toBeDisabled();
  });
});
