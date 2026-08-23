import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import { ChangelistDialog } from '../ChangelistDialog';

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('ChangelistDialog suggestions (#65)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.api = createMockElectronAPI();
    window.api.svn.changelist.list = vi.fn().mockResolvedValue({
      changelists: [],
      defaultFiles: [
        '/wc/src/core/alpha.ts',
        '/wc/src/core/beta.ts',
        '/wc/src/core/alpha.test.ts',
      ],
    });
  });

  afterEach(cleanup);

  it('shows suggestion cards on demand and assigns on accept without auto-applying', async () => {
    renderWithQueryClient(
      <ChangelistDialog isOpen onClose={vi.fn()} path="/wc" selectedFiles={[]} />
    );

    // Nothing is suggested (or assigned) until the user asks for it.
    expect(window.api.svn.changelist.add).not.toHaveBeenCalled();
    expect(screen.queryByTestId('changelist-suggestions')).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: /suggest changelists/i }));

    const section = await screen.findByTestId('changelist-suggestions');
    const card = within(section).getByRole('group', { name: 'Suggestion src: core' });
    fireEvent.click(within(card).getByRole('button', { name: /create changelist \(2\)/i }));

    await waitFor(() => {
      expect(window.api.svn.changelist.add).toHaveBeenCalledWith(
        ['/wc/src/core/alpha.ts', '/wc/src/core/beta.ts'],
        'src: core'
      );
    });
  });

  it('hides the suggestions section again on toggle', async () => {
    renderWithQueryClient(
      <ChangelistDialog isOpen onClose={vi.fn()} path="/wc" selectedFiles={[]} />
    );

    fireEvent.click(await screen.findByRole('button', { name: /suggest changelists/i }));
    expect(await screen.findByTestId('changelist-suggestions')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /hide suggestions/i }));
    expect(screen.queryByTestId('changelist-suggestions')).toBeNull();
  });
});
