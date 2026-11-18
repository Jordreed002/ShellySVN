/**
 * SettingsDialog shell — tab persistence across immediate settings writes.
 *
 * The AI tab persists its changes straight through useSettings while the
 * dialog is open (every other tab only writes on Save). That cache update
 * must not re-run the dialog's open initialization: doing so reset the active
 * tab to `initialTab` (default 'general'), so toggling "Enable generated
 * commit-message drafts" yanked the user off the AI tab. Defended here:
 * the toggle keeps the dialog on the AI tab and enables Save like any other
 * tab's edit, a later Save cannot revert the already-persisted aiCommit
 * values with the draft snapshot from open, and saving keeps the dialog
 * open with a clean footer instead of closing it.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SettingsDialog } from '../SettingsDialog';
import { SettingsPreviewProvider } from '../../../contexts/SettingsPreviewContext';

const providers = vi.fn();
const summary = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      app: { getVersion: vi.fn().mockResolvedValue('1.2.0') },
      updater: {
        getState: vi.fn().mockResolvedValue({
          status: 'idle',
          installedVersion: '1.2.0',
          channel: 'stable',
        }),
        check: vi.fn(),
        download: vi.fn(),
        cancelDownload: vi.fn(),
        restartAndInstall: vi.fn(),
        onStateChanged: vi.fn().mockReturnValue(() => {}),
      },
      // useSettings reads/writes settings through the store namespace.
      store: {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
      },
      ai: {
        providers,
        credentials: { summary, save: vi.fn(), remove: vi.fn() },
        customProviders: { upsert: vi.fn() },
        listModels: vi.fn().mockResolvedValue([]),
        estimateCost: vi.fn().mockResolvedValue(null),
        usageHistory: vi.fn().mockResolvedValue([]),
        clearUsageHistory: vi.fn().mockResolvedValue(undefined),
      },
    },
  });
  providers.mockResolvedValue([
    { provider: 'codex', available: true, kind: 'cli', version: '0.9.1' },
    { provider: 'claude', available: false, kind: 'cli', reason: 'Not installed' },
  ]);
  summary.mockResolvedValue({ encryptionAvailable: true, providers: [] });
});

afterEach(cleanup);

function renderDialog(): { onClose: ReturnType<typeof vi.fn> } {
  // Fresh client per render so cached settings never leak between tests.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsPreviewProvider>
        <SettingsDialog isOpen onClose={onClose} />
      </SettingsPreviewProvider>
    </QueryClientProvider>
  );
  return { onClose };
}

async function openAiTab() {
  const { onClose } = renderDialog();
  fireEvent.click(await screen.findByRole('button', { name: 'AI Providers' }));
  await screen.findByText('Enable generated commit-message drafts');
  return { onClose };
}

describe('SettingsDialog AI tab', () => {
  it('marks the dialog dirty and enables Save when the enable toggle persists its write', async () => {
    await openAiTab();

    const toggle = screen.getByRole('checkbox', {
      name: /^Enable generated commit-message drafts/,
    });
    const saveButton = screen.getByRole('button', { name: /Save changes/ });
    expect(saveButton).toBeDisabled();
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);

    // The write lands (immediate persistence through useSettings)…
    await waitFor(() => {
      expect(window.api.store.set).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });

    // …the dialog must still show the AI tab, not fall back to General…
    expect(screen.getByRole('heading', { level: 3, name: 'AI Providers' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 3, name: 'General' })
    ).not.toBeInTheDocument();

    // …and the edit must register: chip + clickable Save, like every other tab.
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(saveButton).toBeEnabled();
  });

  it('does not revert the persisted toggle when saving an unrelated change', async () => {
    const { onClose } = await openAiTab();

    fireEvent.click(
      screen.getByRole('checkbox', { name: /^Enable generated commit-message drafts/ })
    );
    await waitFor(() => {
      expect(window.api.store.set).toHaveBeenCalled();
    });

    // An unrelated local edit in another tab, then Save.
    fireEvent.click(screen.getByRole('button', { name: 'General' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dark' }));
    fireEvent.click(await screen.findByRole('button', { name: /Save changes/ }));

    await waitFor(() => {
      expect(window.api.store.set).toHaveBeenCalledTimes(2);
    });
    // store.set(key, payload) — the settings object is the second argument.
    const savedPayload = vi.mocked(window.api.store.set).mock.calls[1][1] as {
      aiCommit: { enabled: boolean };
      theme: string;
    };
    expect(savedPayload.theme).toBe('dark');
    expect(savedPayload.aiCommit.enabled).toBe(true);

    // Saving keeps the dialog open with a clean footer — no spurious dirty
    // state from the saved values landing back in the settings cache.
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Save changes/ })).toBeDisabled();
    });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'General' })).toBeInTheDocument();
  });
});

describe('SettingsDialog navigation and search coverage', () => {
  it('renders a section for every search index entry so jumps always land', async () => {
    const { SETTINGS_SEARCH_INDEX, sectionSlug } = await import('../../../lib/settingsSearch');
    // Backend probes the other tabs start on mount; every one resolves empty.
    Object.assign(window.api, {
      auth: {
        list: vi.fn().mockResolvedValue([]),
        isEncryptionAvailable: vi.fn().mockResolvedValue(true),
      },
      svn: {
        info: vi.fn().mockResolvedValue({}),
        nativeAuth: { list: vi.fn().mockResolvedValue([]) },
      },
      monitor: { getWorkingCopies: vi.fn().mockResolvedValue([]) },
      shell: { isRegistered: vi.fn().mockResolvedValue({ registered: false }) },
      externalTools: { list: vi.fn().mockResolvedValue([]) },
    });
    Object.assign(window.api.app, {
      getPlatform: vi.fn().mockResolvedValue('win32'),
      getCacheSize: vi.fn().mockResolvedValue({ size: 0, files: 0 }),
    });
    renderDialog();
    await screen.findByRole('heading', { level: 3, name: 'General' });

    const tabs = Array.from(new Set(SETTINGS_SEARCH_INDEX.map((entry) => entry.tab)));
    for (const tab of tabs) {
      const navButton = document.querySelector<HTMLButtonElement>(
        `button[data-settings-tab="${tab}"]`
      );
      expect(navButton).not.toBeNull();
      fireEvent.click(navButton!);
      const expected = SETTINGS_SEARCH_INDEX.filter((entry) => entry.tab === tab).map((entry) =>
        sectionSlug(entry.section)
      );
      await waitFor(() => {
        const rendered = new Set(
          Array.from(document.querySelectorAll<HTMLElement>('[data-settings-section]')).map(
            (node) => node.dataset.settingsSection
          )
        );
        for (const slug of expected) expect(rendered.has(slug), `${tab}: ${slug}`).toBe(true);
      });
    }
  });

  it('moves between sections with the arrow keys and marks the current page', async () => {
    renderDialog();
    const general = await screen.findByRole('button', { name: 'General' });
    expect(general).toHaveAttribute('aria-current', 'page');

    general.focus();
    fireEvent.keyDown(general, { key: 'ArrowDown' });

    const appearance = screen.getByRole('button', { name: 'Appearance' });
    expect(appearance).toHaveFocus();
    expect(appearance).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 3, name: 'Appearance' })).toBeInTheDocument();

    fireEvent.keyDown(appearance, { key: 'End' });
    expect(screen.getByRole('heading', { level: 3, name: 'Advanced' })).toBeInTheDocument();
  });

  it('saves pending changes with Ctrl+S', async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Dark' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 's', ctrlKey: true });

    await waitFor(() => {
      expect(window.api.store.set).toHaveBeenCalledTimes(1);
    });
    const savedPayload = vi.mocked(window.api.store.set).mock.calls[0][1] as { theme: string };
    expect(savedPayload.theme).toBe('dark');
  });
});
