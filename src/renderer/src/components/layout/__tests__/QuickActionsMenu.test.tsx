import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QuickActionsContextMenu, QuickActionsMenuButton } from '../QuickActionsMenu';
import {
  getNotificationCenterSnapshot,
  resetNotificationCenterForTests,
} from '@renderer/lib/notificationCenterStore';

const listEditors = vi.fn();
const externalToolsList = vi.fn();
const revealPath = vi.fn().mockResolvedValue({ success: true });
const openFolder = vi.fn().mockResolvedValue({ success: true });
const openInEditor = vi.fn().mockResolvedValue({ success: true });

function mockApi() {
  window.api = {
    store: { get: vi.fn().mockResolvedValue(undefined), set: vi.fn().mockResolvedValue(undefined) },
    external: { listEditors, revealPath, openFolder, openInEditor },
    externalTools: { list: externalToolsList },
    notification: { show: vi.fn().mockResolvedValue(true) },
  } as unknown as Window['api'];
}

function wrappers({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function mockRegistry({
  editors = [],
  tools = [],
}: {
  editors?: object[];
  tools?: object[];
} = {}) {
  listEditors.mockResolvedValue(editors);
  externalToolsList.mockResolvedValue(tools);
}

describe('QuickActionsMenuButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNotificationCenterForTests();
    mockApi();
    mockRegistry({
      editors: [
        { id: 'code', label: 'Visual Studio Code', command: 'code', appliesTo: 'both' },
        { id: 'hex', label: 'Hex Fiend', command: 'hex', appliesTo: 'files' },
      ],
      tools: [
        {
          id: 'sublime',
          name: 'Sublime Text',
          roles: ['editor'],
          builtIn: false,
          available: true,
          argumentTemplate: [],
        },
        {
          id: 'gone',
          name: 'Registered Elsewhere',
          roles: ['editor'],
          builtIn: false,
          available: false,
          argumentTemplate: [],
        },
      ],
    });
  });

  it('builds the menu from the mocked registry: reveal, folder, editors, absent terminal', async () => {
    render(wrappers({ children: <QuickActionsMenuButton workingCopyPath="/wc/atlas" /> }));
    fireEvent.click(screen.getByRole('button', { name: 'Quick actions for this working copy' }));

    const menu = await screen.findByRole('menu', { name: 'Quick actions' });
    // Wait for the registry-driven rows before asserting the whole surface.
    expect(
      await screen.findByRole('menuitem', { name: 'Open in Visual Studio Code' })
    ).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: /Reveal in / })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: /Open folder/ })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Open in Sublime Text' })).toBeEnabled();
    // Files-only editors never appear.
    expect(screen.queryByText('Open in Hex Fiend')).not.toBeInTheDocument();
    // Unavailable registry tool stays visible but disabled, with its reason.
    const elsewhere = screen.getByRole('menuitem', { name: /Open in Registered Elsewhere/ });
    expect(elsewhere).toBeDisabled();
    expect(screen.getByText('Registered but not found on this machine')).toBeInTheDocument();
    // Terminal is offered only as a graceful absence (name carries its reason).
    const terminal = screen.getByRole('menuitem', { name: /Open in Terminal/ });
    expect(terminal).toBeDisabled();
    expect(screen.getByText('No terminal tool is registered')).toBeInTheDocument();
    expect(menu).toBeInTheDocument();
  });

  it('launches the chosen editor through the external IPC and closes the menu', async () => {
    render(wrappers({ children: <QuickActionsMenuButton workingCopyPath="/wc/atlas" /> }));
    fireEvent.click(screen.getByRole('button', { name: 'Quick actions for this working copy' }));

    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Open in Visual Studio Code' })
    );

    await waitFor(() => expect(openInEditor).toHaveBeenCalledWith('code', '/wc/atlas'));
    expect(screen.queryByRole('menu', { name: 'Quick actions' })).not.toBeInTheDocument();
  });

  it('surfaces launcher failures as warning notifications instead of throwing', async () => {
    openInEditor.mockResolvedValueOnce({ success: false, error: 'code: not found' });
    render(wrappers({ children: <QuickActionsMenuButton workingCopyPath="/wc/atlas" /> }));
    fireEvent.click(screen.getByRole('button', { name: 'Quick actions for this working copy' }));

    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Open in Visual Studio Code' })
    );

    await waitFor(() => expect(openInEditor).toHaveBeenCalledWith('code', '/wc/atlas'));
    const { items } = getNotificationCenterSnapshot();
    expect(items.at(-1)).toMatchObject({
      severity: 'warning',
      title: 'Could not open the working copy in the editor',
      body: 'code: not found',
    });
  });

  it('disables every row when no working copy is open', async () => {
    render(wrappers({ children: <QuickActionsMenuButton /> }));
    fireEvent.click(screen.getByRole('button', { name: 'Quick actions for this working copy' }));

    await screen.findByRole('menu', { name: 'Quick actions' });
    const items = screen.getAllByRole('menuitem');
    expect(items.length).toBeGreaterThan(1);
    for (const item of items) expect(item).toBeDisabled();
  });

  it('closes on Escape and outside pointer', async () => {
    render(wrappers({ children: <QuickActionsMenuButton workingCopyPath="/wc/atlas" /> }));
    fireEvent.click(screen.getByRole('button', { name: 'Quick actions for this working copy' }));
    await screen.findByRole('menu', { name: 'Quick actions' });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Quick actions' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quick actions for this working copy' }));
    await screen.findByRole('menu', { name: 'Quick actions' });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu', { name: 'Quick actions' })).not.toBeInTheDocument();
  });
});

describe('QuickActionsContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
    mockRegistry({
      editors: [{ id: 'code', label: 'Visual Studio Code', command: 'code', appliesTo: 'both' }],
      tools: [],
    });
  });

  it('renders at the pointer position for the repository pill right-click', async () => {
    const onClose = vi.fn();
    const { container } = render(
      wrappers({
        children: (
          <QuickActionsContextMenu
            position={{ x: 120, y: 40 }}
            workingCopyPath="/wc/atlas"
            onClose={onClose}
          />
        ),
      })
    );
    const menu = await screen.findByRole('menu', { name: 'Quick actions for this working copy' });
    expect((menu as HTMLElement).style.left).toBe('120px');
    expect((menu as HTMLElement).style.top).toBe('40px');

    fireEvent.click(screen.getByRole('menuitem', { name: /Reveal in / }));
    await waitFor(() => expect(revealPath).toHaveBeenCalledWith('/wc/atlas'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(container).toBeInTheDocument();
  });
});
