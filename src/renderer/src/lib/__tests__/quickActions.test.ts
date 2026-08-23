import { describe, expect, it, vi } from 'vitest';

import type { CodeEditorInfo, ExternalToolSummary } from '@shared/types';
import { buildQuickActions, runQuickAction } from '../quickActions';

const editor = (overrides: Partial<CodeEditorInfo> = {}): CodeEditorInfo => ({
  id: 'code',
  label: 'Visual Studio Code',
  command: 'code',
  appliesTo: 'both',
  ...overrides,
});

const tool = (overrides: Partial<ExternalToolSummary> = {}): ExternalToolSummary => ({
  id: 'tool-1',
  name: 'Some Editor',
  roles: ['editor'],
  builtIn: false,
  available: true,
  argumentTemplate: [],
  ...overrides,
});

describe('buildQuickActions', () => {
  it('offers reveal + open-folder from the always-present IPC surface', () => {
    const actions = buildQuickActions({
      workingCopyPath: '/wc/atlas',
      editors: [],
      tools: [],
      isMac: true,
    });
    const reveal = actions.find((action) => action.id === 'reveal');
    expect(reveal).toMatchObject({ label: 'Reveal in Finder', available: true });
    expect(actions.find((action) => action.id === 'open-folder')).toMatchObject({
      available: true,
    });
    // Platform-appropriate label on Windows.
    expect(
      buildQuickActions({ workingCopyPath: '/wc', editors: [], tools: [], isMac: false }).find(
        (action) => action.id === 'reveal'
      )?.label
    ).toBe('Reveal in File Explorer');
  });

  it('lists folder-capable registered editors with launchers', () => {
    const actions = buildQuickActions({
      workingCopyPath: '/wc',
      editors: [
        editor(),
        editor({ id: 'file-only', label: 'Hex Fiend', appliesTo: 'files' }),
        editor({ id: 'zed', label: 'Zed', appliesTo: 'folders' }),
      ],
      tools: [],
    });
    const labels = actions.map((action) => action.label);
    expect(labels).toContain('Open in Visual Studio Code');
    expect(labels).toContain('Open in Zed');
    expect(labels).not.toContain('Open in Hex Fiend'); // files-only editor
    const code = actions.find((action) => action.id === 'editor:code');
    expect(code).toMatchObject({ available: true, launcherId: 'code' });
  });

  it('merges registry editor tools by name instead of duplicating them', () => {
    const actions = buildQuickActions({
      workingCopyPath: '/wc',
      editors: [editor()],
      tools: [tool({ name: 'Visual Studio Code' }), tool({ id: 'sublime', name: 'Sublime' })],
    });
    expect(actions.filter((action) => action.label === 'Open in Visual Studio Code')).toHaveLength(1);
    expect(actions.find((action) => action.id === 'tool:sublime')).toMatchObject({
      label: 'Open in Sublime',
      available: true,
      launcherId: 'sublime',
    });
  });

  it('shows registry-only or unavailable tools as disabled with their reason', () => {
    const actions = buildQuickActions({
      workingCopyPath: '/wc',
      editors: [],
      tools: [
        tool({ id: 'missing', name: 'Registered Elsewhere', available: false }),
        tool({ id: 'differ', name: 'Diff Tool', roles: ['diff'] }),
      ],
    });
    const missing = actions.find((action) => action.id === 'tool:missing');
    expect(missing).toMatchObject({
      available: false,
      reason: 'Registered but not found on this machine',
    });
    // Non-editor registry roles are not surfaced as open-in actions.
    expect(actions.find((action) => action.id === 'tool:differ')).toBeUndefined();
  });

  it('never invents a terminal: absent registry rows render disabled with a reason', () => {
    const actions = buildQuickActions({ workingCopyPath: '/wc', editors: [], tools: [] });
    expect(actions.find((action) => action.id === 'terminal')).toMatchObject({
      label: 'Open in Terminal',
      available: false,
      reason: 'No terminal tool is registered',
    });
  });

  it('degrades gracefully without a working copy: every row disabled with one reason', () => {
    const actions = buildQuickActions({
      workingCopyPath: undefined,
      editors: [editor()],
      tools: [],
    });
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.available).toBe(false);
      expect(action.reason).toBe('No working copy is open');
    }
  });
});

describe('runQuickAction', () => {
  it('routes each kind to its runner with the working copy', () => {
    const runner = {
      reveal: vi.fn(),
      openFolder: vi.fn(),
      openInEditor: vi.fn(),
    };
    const actions = buildQuickActions({
      workingCopyPath: '/wc/atlas',
      editors: [editor()],
      tools: [tool({ id: 'sublime', name: 'Sublime' })],
    });

    runQuickAction(actions.find((a) => a.id === 'reveal')!, '/wc/atlas', runner);
    expect(runner.reveal).toHaveBeenCalledWith('/wc/atlas');

    runQuickAction(actions.find((a) => a.id === 'open-folder')!, '/wc/atlas', runner);
    expect(runner.openFolder).toHaveBeenCalledWith('/wc/atlas');

    runQuickAction(actions.find((a) => a.id === 'editor:code')!, '/wc/atlas', runner);
    runQuickAction(actions.find((a) => a.id === 'tool:sublime')!, '/wc/atlas', runner);
    expect(runner.openInEditor).toHaveBeenNthCalledWith(1, 'code', '/wc/atlas');
    expect(runner.openInEditor).toHaveBeenNthCalledWith(2, 'sublime', '/wc/atlas');
  });

  it('does nothing for unavailable actions or the terminal row', () => {
    const runner = { reveal: vi.fn(), openFolder: vi.fn(), openInEditor: vi.fn() };
    const actions = buildQuickActions({ editors: [editor()], tools: [] });
    for (const action of actions) {
      runQuickAction(action, undefined, runner);
    }
    expect(runner.reveal).not.toHaveBeenCalled();
    expect(runner.openFolder).not.toHaveBeenCalled();
    expect(runner.openInEditor).not.toHaveBeenCalled();
  });
});
