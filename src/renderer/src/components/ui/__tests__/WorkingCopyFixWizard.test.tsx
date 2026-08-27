import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import type { SvnStatusEntry } from '@shared/types';

import { WorkingCopyFixWizard } from '../WorkingCopyFixWizard';

const WC = 'C:\\wc';

function entry(path: string, status: string, isDirectory = false): SvnStatusEntry {
  return { path, status: status as SvnStatusEntry['status'], isDirectory };
}

function statusWith(
  entries: SvnStatusEntry[]
): { path: string; entries: SvnStatusEntry[]; revision: number } {
  return { path: WC, entries, revision: 12 };
}

function renderWizard(props: Partial<Parameters<typeof WorkingCopyFixWizard>[0]> = {}) {
  const onRepaired = vi.fn();
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <WorkingCopyFixWizard
        isOpen
        onClose={onClose}
        workingCopyPath={WC}
        onRepaired={onRepaired}
        {...props}
      />
    </QueryClientProvider>
  );
  return { onRepaired, onClose, queryClient };
}

describe('WorkingCopyFixWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.api = createMockElectronAPI();
  });

  afterEach(cleanup);

  it('groups missing files by folder and restores the chosen group through the repair IPC', async () => {
    window.api.svn.status = vi.fn().mockResolvedValue(
      statusWith([
        entry(`${WC}\\Clients\\BESA\\www\\index.php`, '!'),
        entry(`${WC}\\Clients\\BESA\\www\\style.css`, '!'),
        entry(`${WC}\\Clients\\Other\\logo.png`, '!'),
        entry(`${WC}\\Clients\\BESA\\live\\config.php`, 'M'),
      ])
    );
    const repair = vi
      .fn()
      .mockResolvedValue({ success: true, restored: 3, completedDirs: 0, excludedDirs: 0, stepErrors: [] });
    window.api.svn.repairWorkingCopy = repair;

    const { onRepaired } = renderWizard();

    await screen.findByTestId('fix-wizard-choose');
    const groupCards = screen.getAllByTestId('fix-wizard-group');
    expect(groupCards).toHaveLength(2);
    expect(groupCards[0].textContent).toContain('Clients\\BESA');

    fireEvent.click(screen.getByTestId('fix-wizard-run'));

    await waitFor(() => expect(screen.getByTestId('fix-wizard-summary')).toBeTruthy());
    expect(repair).toHaveBeenCalledTimes(1);
    const plan = repair.mock.calls[0][0];
    expect(plan.workingCopyPath).toBe(WC);
    expect(plan.restoreFiles).toEqual([
      `${WC}\\Clients\\BESA\\www\\index.php`,
      `${WC}\\Clients\\BESA\\www\\style.css`,
      `${WC}\\Clients\\Other\\logo.png`,
    ]);
    expect(plan.excludeDirs).toEqual([]);
    expect(onRepaired).toHaveBeenCalled();
  });

  it('sends an excluded group to the remove-from-working-copy tool', async () => {
    window.api.svn.status = vi.fn().mockResolvedValue(
      statusWith([
        entry(`${WC}\\Clients\\Gone\\site\\a.php`, '!'),
        entry(`${WC}\\Clients\\Gone\\uploads\\banner.png`, '?'),
      ])
    );
    const repair = vi
      .fn()
      .mockResolvedValue({ success: true, restored: 0, completedDirs: 0, excludedDirs: 1, stepErrors: [] });
    window.api.svn.repairWorkingCopy = repair;

    renderWizard();
    await screen.findByTestId('fix-wizard-choose');

    fireEvent.click(screen.getByLabelText('Remove from working copy', { selector: 'input' }));
    fireEvent.click(screen.getByTestId('fix-wizard-run'));

    await waitFor(() => expect(screen.getByTestId('fix-wizard-summary')).toBeTruthy());
    const plan = repair.mock.calls[0][0];
    expect(plan.restoreFiles).toEqual([]);
    expect(plan.excludeDirs).toEqual([`${WC}\\Clients\\Gone`]);
  });

  it('completes missing directories with cleanup and update', async () => {
    window.api.svn.status = vi.fn().mockResolvedValue(
      statusWith([entry(`${WC}\\Clients\\Partial`, '!', true)])
    );
    const repair = vi
      .fn()
      .mockResolvedValue({ success: true, restored: 0, completedDirs: 1, excludedDirs: 0, stepErrors: [] });
    window.api.svn.repairWorkingCopy = repair;

    renderWizard();
    await screen.findByTestId('fix-wizard-choose');

    fireEvent.click(screen.getByTestId('fix-wizard-run'));

    await waitFor(() => expect(screen.getByTestId('fix-wizard-summary')).toBeTruthy());
    const plan = repair.mock.calls[0][0];
    expect(plan.completeDirs).toEqual([`${WC}\\Clients\\Partial`]);
  });

  it('reports a clean working copy when nothing is missing', async () => {
    window.api.svn.status = vi.fn().mockResolvedValue(
      statusWith([entry(`${WC}\\src\\main.ts`, 'M')])
    );

    renderWizard();

    await waitFor(() => expect(screen.getByTestId('fix-wizard-nothing')).toBeTruthy());
    expect(screen.queryByTestId('fix-wizard-run')).toBeNull();
  });
});
