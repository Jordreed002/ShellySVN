import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictAiExplainer } from '../ConflictAiExplainer';

const contents = {
  baseContent: 'base',
  mineContent: 'mine',
  theirsContent: 'theirs',
  fingerprint: 'fp-1',
};

const proposal = {
  provider: 'codex' as const,
  model: 'gpt-5.6-luna',
  durationMs: 1500,
  truncated: false,
  redacted: true,
  explanation: 'Both sides **modified** the same line.',
  likelyIntent: 'Preserve both changes',
  confidence: 0.72,
  unresolvedQuestions: ['Which order?'],
  proposedMergedText: 'base\nmine\ntheirs',
};

const loadContents = vi.fn().mockResolvedValue(contents);
const propose = vi.fn().mockResolvedValue(proposal);

function mockApi(consent: unknown, proposeImpl = propose) {
  let value = consent;
  window.api = {
    store: {
      get: vi.fn().mockImplementation(() => Promise.resolve(value)),
      set: vi.fn().mockImplementation((_key: string, next: unknown) => {
        value = next;
        return Promise.resolve();
      }),
      delete: vi.fn(),
    },
    ai: { proposeConflictResolution: proposeImpl },
  } as unknown as Window['api'];
}

describe('ConflictAiExplainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadContents.mockResolvedValue(contents);
  });

  it('asks for consent first when the working copy has no entry', async () => {
    mockApi(undefined);
    render(
      <ConflictAiExplainer
        workingCopyPath="/wc"
        filePath="/wc/file.ts"
        loadContents={loadContents}
      />
    );
    await waitFor(() =>
      expect(screen.getByText(/No AI choice is recorded for this working copy/)).toBeTruthy()
    );
    // Lazy: nothing loaded and nothing proposed before the user opts in.
    expect(loadContents).not.toHaveBeenCalled();
    expect(propose).not.toHaveBeenCalled();
  });

  it('renders the disabled state when consent is off', async () => {
    mockApi({ '/wc': { aiEnabled: false, updatedAt: 'x' } });
    render(
      <ConflictAiExplainer
        workingCopyPath="/wc"
        filePath="/wc/file.ts"
        loadContents={loadContents}
      />
    );
    await waitFor(() => expect(screen.getByText(/AI is currently disabled/)).toBeTruthy());
  });

  it('opts in, then calls the API with loaded contents and renders sanitized output', async () => {
    mockApi(undefined);
    const onProposalMetadata = vi.fn();
    render(
      <ConflictAiExplainer
        workingCopyPath="/wc"
        filePath="/wc/file.ts"
        loadContents={loadContents}
        onProposalMetadata={onProposalMetadata}
      />
    );
    await waitFor(() => screen.getByRole('button', { name: /Enable AI and explain/ }));
    fireEvent.click(screen.getByRole('button', { name: /Enable AI and explain/ }));

    await waitFor(() => expect(propose).toHaveBeenCalledOnce());
    const request = propose.mock.calls[0]![0] as Record<string, string>;
    expect(request).toMatchObject({
      filePath: '/wc/file.ts',
      baseContent: 'base',
      mineContent: 'mine',
      theirsContent: 'theirs',
    });
    expect(request.operationId).toMatch(/^conflict-explain-/);

    await waitFor(() => expect(screen.getByText(/72% confidence/)).toBeTruthy());
    // Rich text is sanitized and attributed (#19).
    const rich = screen.getByLabelText('Conflict explanation (AI output)');
    expect(rich.getAttribute('data-sanitized')).toBe('ai');
    expect(rich.textContent).toContain('modified');
    expect(rich.querySelector('strong')).not.toBeNull();
    // Merged text renders as a text node — never interpreted.
    expect(screen.getByText(/base\s*mine\s*theirs/)).toBeTruthy();
    expect(onProposalMetadata).toHaveBeenCalledWith({
      confidence: 0.72,
      unresolvedQuestions: ['Which order?'],
      sourceFingerprint: 'fp-1',
    });
  });

  it('renders the actionable privacy notice for consent/secret error codes (#18)', async () => {
    mockApi(
      { '/wc': { aiEnabled: true, updatedAt: 'x' } },
      vi.fn().mockRejectedValue(new Error('[secrets_detected] potential credential found'))
    );
    render(
      <ConflictAiExplainer
        workingCopyPath="/wc"
        filePath="/wc/file.ts"
        loadContents={loadContents}
      />
    );
    await waitFor(() => screen.getByRole('button', { name: /Explain this conflict with AI/ }));
    fireEvent.click(screen.getByRole('button', { name: /Explain this conflict with AI/ }));
    await waitFor(() => expect(screen.getByTestId('ai-privacy-notice')).toBeTruthy());
    expect(screen.getByText(/nothing was sent to the provider/i)).toBeTruthy();
    expect(screen.getByText(/might contain a credential or secret/i)).toBeTruthy();
    // The notice links back to the consent choice.
    fireEvent.click(screen.getByRole('button', { name: /Review consent choice/ }));
    await waitFor(() => expect(screen.getByText(/No AI choice is recorded/)).toBeTruthy());
  });

  it('reuses ErrorPanel with retry for ordinary failures', async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error('[timeout] provider asleep'));
    mockApi({ '/wc': { aiEnabled: true, updatedAt: 'x' } }, failing);
    failing.mockResolvedValue(proposal);
    render(
      <ConflictAiExplainer
        workingCopyPath="/wc"
        filePath="/wc/file.ts"
        loadContents={loadContents}
      />
    );
    await waitFor(() => screen.getByRole('button', { name: /Explain this conflict with AI/ }));
    fireEvent.click(screen.getByRole('button', { name: /Explain this conflict with AI/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/provider asleep/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/72% confidence/)).toBeTruthy());
  });

  it('can cancel an in-flight explanation', async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<never>(() => undefined);
    const slowPropose = vi.fn().mockImplementation(() => {
      release = undefined;
      return pending;
    });
    mockApi({ '/wc': { aiEnabled: true, updatedAt: 'x' } }, slowPropose);
    render(
      <ConflictAiExplainer
        workingCopyPath="/wc"
        filePath="/wc/file.ts"
        loadContents={loadContents}
      />
    );
    await waitFor(() => screen.getByRole('button', { name: /Explain this conflict with AI/ }));
    fireEvent.click(screen.getByRole('button', { name: /Explain this conflict with AI/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Cancel/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Explain this conflict with AI/ })).toBeTruthy()
    );
    expect(release).toBeUndefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders streaming deltas progressively and clears them on completion', async () => {
    let emit: ((event: { operationId: string; delta?: string }) => void) | undefined;
    const onAiStream = vi.fn().mockImplementation(
      (callback: (event: { operationId: string; delta?: string }) => void) => {
        emit = callback;
        return () => undefined;
      }
    );
    const proposeMock = vi.fn().mockImplementation(
      () => new Promise<typeof proposal>((resolve) => {
        window.setTimeout(() => resolve(proposal), 50);
      })
    );
    window.api = {
      store: {
        get: vi.fn().mockResolvedValue({ '/wc': { aiEnabled: true, updatedAt: 'x' } }),
        set: vi.fn(),
        delete: vi.fn(),
      },
      ai: {
        proposeConflictResolution: proposeMock,
        onAiStream,
      },
    } as unknown as Window['api'];

    render(
      <ConflictAiExplainer
        workingCopyPath="/wc"
        filePath="/wc/file.ts"
        loadContents={loadContents}
      />
    );
    await waitFor(() => screen.getByRole('button', { name: /Explain this conflict with AI/ }));
    fireEvent.click(screen.getByRole('button', { name: /Explain this conflict with AI/ }));
    await waitFor(() => expect(onAiStream).toHaveBeenCalledOnce());

    // Deltas for other operations are ignored; ours accumulate.
    const request = proposeMock.mock.calls[0]![0] as { operationId: string };
    act(() => {
      emit!({ operationId: 'other-op', delta: 'IGNORE ME' });
      emit!({ operationId: request.operationId, delta: 'Both sides changed ' });
      emit!({ operationId: request.operationId, delta: 'the **same** line.' });
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Streaming explanation (AI output)')).toBeTruthy()
    );
    expect(screen.getByText('Streaming the explanation as it arrives…')).toBeTruthy();
    const streamBlock = screen.getByLabelText('Streaming explanation (AI output)');
    expect(streamBlock.textContent).toContain('Both sides changed the same line.');
    expect(streamBlock.textContent).not.toContain('IGNORE ME');

    await waitFor(() => expect(screen.getByText(/72% confidence/)).toBeTruthy());
    expect(screen.queryByLabelText('Streaming explanation (AI output)')).toBeNull();
  });

  it('works without any streaming surface (CLI providers emit nothing)', async () => {
    mockApi({ '/wc': { aiEnabled: true, updatedAt: 'x' } });
    render(
      <ConflictAiExplainer
        workingCopyPath="/wc"
        filePath="/wc/file.ts"
        loadContents={loadContents}
      />
    );
    await waitFor(() => screen.getByRole('button', { name: /Explain this conflict with AI/ }));
    fireEvent.click(screen.getByRole('button', { name: /Explain this conflict with AI/ }));
    await waitFor(() => expect(screen.getByText(/72% confidence/)).toBeTruthy());
    expect(screen.queryByLabelText('Streaming explanation (AI output)')).toBeNull();
  });
});
