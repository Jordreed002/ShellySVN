import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AiPromptPreviewDialog } from '../AiPromptPreviewDialog';

const preview = {
  task: 'commit-message' as const,
  provider: 'codex' as const,
  model: 'gpt-5.6-luna',
  prompt: 'Review this bounded diff.',
  inputBytes: 512,
  truncated: false,
  redacted: true,
  omittedBinaryFiles: ['logo.png'],
  includedHistoryMessages: 2,
};

describe('AiPromptPreviewDialog accessibility', () => {
  it('labels the modal and restores focus when it closes', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const onCancel = vi.fn();
    const view = render(
      <AiPromptPreviewDialog
        preview={preview}
        title="Review AI payload"
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />
    );

    expect(
      screen.getByRole('dialog', { name: 'Review AI payload' }).getAttribute('aria-modal')
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Close prompt preview' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
    view.unmount();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it('exposes clipboard feedback through a polite live region', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(
      <AiPromptPreviewDialog
        preview={preview}
        title="Review AI payload"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /copy prompt/i }));
    expect((await screen.findByText('Prompt copied to clipboard')).getAttribute('aria-live')).toBe(
      'polite'
    );
  });
});
