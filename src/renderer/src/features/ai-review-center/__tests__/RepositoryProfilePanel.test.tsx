import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyRepositoryProfile } from '../repositoryProfileAdapter';
import { RepositoryProfilePanel } from '../RepositoryProfilePanel';

const actions = {
  setProfile: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  previewImport: vi.fn(),
  applyImportPreview: vi.fn(),
  setImportPreview: vi.fn(),
  learnStyle: vi.fn().mockResolvedValue(3),
  clearStyleHints: vi.fn(),
};
let preview: ReturnType<typeof emptyRepositoryProfile> | undefined;

vi.mock('../useRepositoryProfile', () => ({
  useRepositoryProfile: () => ({
    profile: emptyRepositoryProfile(),
    exists: true,
    isLoading: false,
    isSaving: false,
    isLearningStyle: false,
    error: null,
    importPreview: preview
      ? { valid: true, profile: preview, warnings: ['Ignored unsafe repository-relative pattern'] }
      : null,
    ...actions,
  }),
}));

describe('RepositoryProfilePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preview = undefined;
  });

  it('edits conventions and saves only through an explicit action', () => {
    render(<RepositoryProfilePanel workingCopyPath="/wc" />);
    const prefixes = screen.getByPlaceholderText(/feat:, fix:, docs:/);
    fireEvent.change(prefixes, {
      target: { value: 'feat:, fix:' },
    });
    fireEvent.blur(prefixes);
    expect(actions.setProfile).toHaveBeenCalled();
    expect(actions.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(actions.save).toHaveBeenCalledOnce();
  });

  it('requires import preview and exposes sanitizer warnings', () => {
    preview = emptyRepositoryProfile();
    render(<RepositoryProfilePanel workingCopyPath="/wc" />);
    fireEvent.click(screen.getByRole('button', { name: /Import JSON with preview/ }));
    const input = screen.getByLabelText('Repository profile JSON');
    fireEvent.change(input, { target: { value: '{"version":1}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(actions.previewImport).toHaveBeenCalledWith('{"version":1}');
    expect(screen.getByText('Ignored unsafe repository-relative pattern')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use preview in editor' }));
    expect(actions.applyImportPreview).toHaveBeenCalledOnce();
  });

  it('states that repository instruction files are never read automatically', () => {
    render(<RepositoryProfilePanel workingCopyPath="/wc" />);
    expect(
      screen.getByText(/never searches for or reads repository instruction files automatically/i)
    ).toBeTruthy();
  });

  it('learns commit style locally without sending anything to a provider', async () => {
    render(<RepositoryProfilePanel workingCopyPath="/wc" />);
    fireEvent.click(screen.getByRole('button', { name: /Learn style from history/ }));
    await waitFor(() => expect(actions.learnStyle).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByText(/Learned style from 3 recent commits/)).toBeTruthy()
    );
    expect(screen.getByText(/Nothing is sent to any provider/)).toBeTruthy();
  });
});
