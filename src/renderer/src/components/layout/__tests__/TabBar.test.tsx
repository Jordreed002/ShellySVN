import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SvnStatusResult } from '@shared/types';
import { svnStatus } from '@renderer/lib/queryKeys';

import { TabBar } from '../TabBar';
import type { ShellTab } from '@renderer/lib/tabsStore';

const tab = (id: string, path: string, pathname = '/files'): ShellTab => ({
  id,
  workingCopyPath: path,
  route: { pathname, search: { path } },
});

function mockApi() {
  window.api = {
    dialog: { openDirectory: vi.fn().mockResolvedValue('/wc/from-dialog') },
  } as unknown as Window['api'];
}

function renderTabBar(
  tabs: ShellTab[],
  activeTabId: string | null,
  props: Partial<React.ComponentProps<typeof TabBar>> = {}
) {
  const handlers = {
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onCloseOthers: vi.fn(),
    onOpenWorkingCopy: vi.fn(),
    recentRepositories: [],
    ...props,
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TabBar tabs={tabs} activeTabId={activeTabId} {...(handlers as object)} />
    </QueryClientProvider>
  );
  return handlers;
}

function statusOf(entries: SvnStatusResult['entries']): SvnStatusResult {
  return { path: '/wc', entries, revision: 1 };
}

describe('TabBar', () => {
  beforeEach(() => {
    mockApi();
  });

  it('renders one tab per working copy with the folder name and full path on hover', () => {
    renderTabBar([tab('a', '/wc/atlas'), tab('b', '/wc/nadir')], 'a');
    const strip = screen.getByRole('tablist', { name: 'Working copy tabs' });
    const tabs = within(strip).getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent('atlas');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[0]).toHaveAttribute('title', '/wc/atlas — /files');
  });

  it('switches tabs through the activation callback', () => {
    const handlers = renderTabBar([tab('a', '/wc/atlas'), tab('b', '/wc/nadir')], 'a');
    fireEvent.click(screen.getByRole('tab', { name: 'Working copy nadir' }));
    expect(handlers.onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    expect(handlers.onActivate).toHaveBeenCalledTimes(1);
  });

  it('closes via the X button, middle-click and the context menu (close others)', () => {
    const handlers = renderTabBar([tab('a', '/wc/atlas'), tab('b', '/wc/nadir')], 'a');

    // X button (stopPropagation keeps the switch handler out of it).
    fireEvent.click(screen.getByRole('button', { name: 'Close tab nadir' }));
    expect(handlers.onClose).toHaveBeenCalledWith('b');
    expect(handlers.onActivate).not.toHaveBeenCalled();

    // Middle click (jsdom has no fireEvent.auxClick; dispatch it directly).
    fireEvent(
      screen.getByRole('tab', { name: 'Working copy atlas' }),
      new MouseEvent('auxclick', { button: 1, bubbles: true })
    );
    expect(handlers.onClose).toHaveBeenCalledWith('a');

    // Context menu.
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Working copy atlas' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close other tabs' }));
    expect(handlers.onCloseOthers).toHaveBeenCalledWith('a');
  });

  it('opens the new-tab picker over recent repositories and the folder dialog', async () => {
    const handlers = renderTabBar([tab('a', '/wc/atlas')], 'a', {
      recentRepositories: ['/wc/atlas', '/wc/nadir'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open a working copy in a new tab' }));

    const menu = screen.getByRole('menu', { name: 'Open a working copy' });
    fireEvent.click(within(menu).getByText('nadir'));
    expect(handlers.onOpenWorkingCopy).toHaveBeenCalledWith('/wc/nadir');

    // Reopen and use the OS folder chooser.
    fireEvent.click(screen.getByRole('button', { name: 'Open a working copy in a new tab' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Choose a folder…' }));
    await vi.waitFor(() =>
      expect(handlers.onOpenWorkingCopy).toHaveBeenLastCalledWith('/wc/from-dialog')
    );
  });

  it('shows the empty-picker hint when there are no recent repositories', () => {
    renderTabBar([tab('a', '/wc/atlas')], 'a');
    fireEvent.click(screen.getByRole('button', { name: 'Open a working copy in a new tab' }));
    expect(screen.getByText('No recent working copies yet.')).toBeInTheDocument();
  });

  it('derives dirty/conflict dots from the shared svn status cache', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData<SvnStatusResult>(svnStatus('/wc/atlas'), {
      path: '/wc/atlas',
      revision: 3,
      entries: [
        { path: '/wc/atlas/a.txt', status: 'M', isDirectory: false },
        { path: '/wc/atlas/ok.txt', status: ' ', isDirectory: false },
      ],
    });
    queryClient.setQueryData<SvnStatusResult>(svnStatus('/wc/nadir'), {
      path: '/wc/nadir',
      revision: 1,
      entries: [{ path: '/wc/nadir/c.txt', status: 'C', isDirectory: false }],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <TabBar
          tabs={[tab('a', '/wc/atlas'), tab('b', '/wc/nadir')]}
          activeTabId="a"
          recentRepositories={[]}
          onActivate={vi.fn()}
          onClose={vi.fn()}
          onCloseOthers={vi.fn()}
          onOpenWorkingCopy={vi.fn()}
        />
      </QueryClientProvider>
    );

    const atlas = screen.getByRole('tab', { name: 'Working copy atlas' });
    expect(atlas.querySelector('.bg-svn-modified')).not.toBeNull();
    expect(atlas.querySelector('.bg-svn-conflict')).toBeNull();
    const nadir = screen.getByRole('tab', { name: 'Working copy nadir' });
    expect(nadir.querySelector('.bg-svn-conflict')).not.toBeNull();
  });

  it('uses statusOf helper expectations consistently (sanity)', () => {
    // Guards the local fixture helper against silent shape drift.
    expect(statusOf([{ path: '/x', status: 'A', isDirectory: false }]).entries).toHaveLength(1);
  });
});
