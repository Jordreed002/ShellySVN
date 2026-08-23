import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyReviewCenterWorkspace } from '../reviewCenterStore';
import type { ReviewCenterWorkspace } from '../types';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#files">{children}</a>,
}));

const triageFinding = vi.fn();
const triageFindings = vi.fn().mockReturnValue(true);
const restoreWorkspace = vi.fn();
let workspace: ReviewCenterWorkspace | null = null;

vi.mock('../useAiReviewCenter', () => ({
  useAiReviewCenter: () => ({
    workspace,
    isLoading: false,
    triageFinding,
    triageFindings,
    restoreWorkspace,
    clear: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('../CommitStackPanel', () => ({ CommitStackPanel: () => <div>stack</div> }));
vi.mock('../RepositoryProfilePanel', () => ({
  RepositoryProfilePanel: () => <div>profile</div>,
}));
vi.mock('../ConsentToggle', () => ({
  ConsentToggle: () => <div data-testid="consent-toggle-stub" />,
}));
vi.mock('@renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}));

import { AiReviewCenter } from '../AiReviewCenter';

function finding(id: string, severity: 'danger' | 'warning' | 'info') {
  return {
    id,
    severity,
    category: 'test',
    title: `Finding ${id}`,
    detail: 'Detail',
    filePath: '/wc/src/app.ts',
    line: 1,
    confidence: 0.9,
    evidence: [],
    state: 'open' as const,
  };
}

function loadWorkspace(findings: ReviewCenterWorkspace['findings']): void {
  workspace = { ...emptyReviewCenterWorkspace('/wc'), findings };
}

describe('AiReviewCenter bulk triage (#112)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadWorkspace([
      finding('critical-1', 'danger'),
      finding('critical-2', 'danger'),
      finding('warn-1', 'warning'),
      finding('info-1', 'info'),
    ]);
  });

  it('renders severity filter chips with counts', () => {
    render(<AiReviewCenter workingCopyPath="/wc" onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: /Critical · 2/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Warning · 1/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Info · 1/ })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('hides findings whose severity filter is disabled', () => {
    render(<AiReviewCenter workingCopyPath="/wc" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Critical · 2/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Critical · 2/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('accepts all visible findings from the toolbar and undoes it', async () => {
    render(<AiReviewCenter workingCopyPath="/wc" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /^Accept all \(4\)/ }));
    expect(triageFindings).toHaveBeenCalledWith(
      ['critical-1', 'critical-2', 'warn-1', 'info-1'],
      'accepted'
    );
    await waitFor(() => expect(screen.getByText('Accepted 4 findings')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    expect(restoreWorkspace).toHaveBeenCalledWith(workspace);
  });

  it('bulk actions respect the active severity filter', () => {
    render(<AiReviewCenter workingCopyPath="/wc" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Warning · 1/ }));
    fireEvent.click(screen.getByRole('button', { name: /Info · 1/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Accept all \(2\)/ }));
    expect(triageFindings).toHaveBeenCalledWith(['critical-1', 'critical-2'], 'accepted');
  });

  it('accepts and dismisses via keyboard, with j/k navigation', () => {
    render(<AiReviewCenter workingCopyPath="/wc" onClose={() => undefined} />);
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(triageFinding).toHaveBeenCalledWith('critical-2', 'accepted');
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'd' });
    expect(triageFinding).toHaveBeenCalledWith('critical-1', 'dismissed');
    fireEvent.keyDown(window, { key: 'D' });
    expect(triageFindings).toHaveBeenCalledWith(
      ['critical-1', 'critical-2', 'warn-1', 'info-1'],
      'dismissed'
    );
  });

  it('shows the undo strip after a keyboard bulk action and undoes with U', async () => {
    render(<AiReviewCenter workingCopyPath="/wc" onClose={() => undefined} />);
    fireEvent.keyDown(window, { key: 'A' });
    await waitFor(() => expect(screen.getByText('Accepted 4 findings')).toBeTruthy());
    act(() => {
      fireEvent.keyDown(window, { key: 'u' });
    });
    expect(restoreWorkspace).toHaveBeenCalledWith(workspace);
  });

  it('shows accepted and dismissed findings in the Triaged tab with restore', () => {
    loadWorkspace([
      { ...finding('acc-1', 'warning'), state: 'accepted' },
      { ...finding('dis-1', 'info'), state: 'dismissed' },
    ]);
    render(<AiReviewCenter workingCopyPath="/wc" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('tab', { name: /Triaged/ }));
    expect(screen.getByRole('heading', { name: 'Finding acc-1' })).toBeTruthy();
    expect(screen.getByText('accepted')).toBeTruthy();
    expect(screen.getByText('dismissed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Restore all \(2\)/ }));
    expect(triageFindings).toHaveBeenCalledWith(['acc-1', 'dis-1'], 'open');
  });

  it('never lets the severity filter set become empty', () => {
    render(<AiReviewCenter workingCopyPath="/wc" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Warning · 1/ }));
    fireEvent.click(screen.getByRole('button', { name: /Info · 1/ }));
    fireEvent.click(screen.getByRole('button', { name: /Critical · 2/ }));
    // Critical stays on because disabling it would hide everything.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Critical · 2/ }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('renders the consent toggle in the header (#113)', () => {
    render(<AiReviewCenter workingCopyPath="/wc" onClose={() => undefined} />);
    expect(screen.getByTestId('consent-toggle-stub')).toBeTruthy();
  });
});
