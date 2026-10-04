// @vitest-environment node

/**
 * End-to-end tests for the external:openDiffTool / external:openMergeTool
 * handlers' settings-template path (#87 / Track A coordination item 10):
 * a tool id that matches an AppSettings.externalToolTemplates entry is
 * expanded and launched by the main-side consumer instead of the alias /
 * registry resolution.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const settingsState = vi.hoisted(() => ({
  templates: [] as unknown[],
}));

const mockState = vi.hoisted(() => ({
  ipcMainHandle: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  ipcMain: { handle: mockState.ipcMainHandle },
  shell: { openPath: vi.fn().mockResolvedValue(''), showItemInFolder: vi.fn() },
}));

vi.mock('../../settings-manager', () => ({
  getSettingsManager: () => ({
    ready: async () => undefined,
    getSettings: () => ({ externalToolTemplates: settingsState.templates }),
  }),
}));

const fsState = vi.hoisted(() => ({
  /** Paths whose stat/realpath fail (everything else "exists" as a file). */
  missing: new Set<string>(),
}));

vi.mock('fs/promises', () => ({
  realpath: async (p: string) => {
    if (fsState.missing.has(p)) throw new Error('ENOENT');
    return p;
  },
  stat: async (p: string) => {
    if (fsState.missing.has(p)) throw new Error('ENOENT');
    return {
      isFile: () => true,
      isDirectory: () => false,
    };
  },
  mkdtemp: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}));

interface SpawnCall {
  command: string;
  args: string[];
  options: Record<string, unknown>;
}

const spawnState = vi.hoisted(() => {
  const state = {
    calls: [] as SpawnCall[],
    outcome: 'spawn' as 'spawn' | Error,
  };
  const spawnFn = (command: string, args: string[], options: Record<string, unknown>) => {
    state.calls.push({ command, args, options });
    const listeners = new Map<string, (arg?: unknown) => void>();
    const child = {
      once: (event: string, cb: (arg?: unknown) => void) => {
        listeners.set(event, cb);
        return child;
      },
      unref: vi.fn(),
      emit: (event: string, arg?: unknown) => {
        listeners.get(event)?.(arg);
      },
    };
    const outcome = state.outcome;
    queueMicrotask(() => {
      if (outcome === 'spawn') child.emit('spawn');
      else child.emit('error', outcome);
    });
    return child;
  };
  return { state, spawnFn };
});

vi.mock('child_process', () => ({
  default: { spawn: spawnState.spawnFn },
  spawn: spawnState.spawnFn,
}));

vi.mock('../../services/external-tool-registry', () => ({
  getExternalToolRegistry: () => ({
    list: async () => [],
    register: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    resolve: async () => {
      throw new Error('Tool is not registered for this action');
    },
  }),
}));

vi.mock('../../services/svn-content', () => ({ catRepositoryFile: vi.fn() }));
vi.mock('../../services/code-editors', () => ({
  listCodeEditors: vi.fn(),
  openInCodeEditor: vi.fn(),
}));

import { registerExternalHandlers } from '../external';
import { approvePathForIpc, clearApprovedPathsForTests } from '../../utils/approved-paths';

const handlers: Map<string, (...args: unknown[]) => unknown> = new Map();

const APPROVED_ROOT = join(tmpdir(), 'shellysvn-ext-template-tools');
const LEFT = join(APPROVED_ROOT, 'left.txt');
const RIGHT = join(APPROVED_ROOT, 'right.txt');
const MERGED = join(APPROVED_ROOT, 'merged.txt');

const DIFF_TOOL = {
  id: 'tool-diff-1',
  name: 'My Differ',
  executablePath: 'C:/tools/differ.exe',
  kind: 'diff' as const,
  argumentTemplate: '--left {mine} --right {theirs}',
  createdAt: 0,
};

const MERGE_TOOL = {
  id: 'tool-merge-1',
  name: 'My Merger',
  executablePath: 'C:/tools/merger.exe',
  kind: 'merge' as const,
  argumentTemplate: '{base} {mine} {theirs} -o {merged}',
  createdAt: 0,
};

beforeEach(() => {
  handlers.clear();
  settingsState.templates = [];
  fsState.missing.clear();
  spawnState.state.calls = [];
  spawnState.state.outcome = 'spawn';
  clearApprovedPathsForTests();
  approvePathForIpc(APPROVED_ROOT);

  mockState.ipcMainHandle.mockClear();
  mockState.ipcMainHandle.mockImplementation(
    (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }
  );

  registerExternalHandlers();
});

describe('external:openDiffTool — settings template tools', () => {
  it('launches a stored diff template by id with expanded arguments', async () => {
    settingsState.templates = [DIFF_TOOL];
    const handler = handlers.get('external:openDiffTool');
    const result = (await handler!({}, 'tool-diff-1', LEFT, RIGHT)) as {
      success: boolean;
      error?: string;
    };

    expect(result).toEqual({ success: true });
    expect(spawnState.state.calls).toHaveLength(1);
    const call = spawnState.state.calls[0];
    expect(call.command).toBe('C:/tools/differ.exe');
    expect(call.args).toEqual(['--left', LEFT, '--right', RIGHT]);
    // SECURITY: argv array, never a shell.
    expect(call.options).toMatchObject({ shell: false, detached: true, stdio: 'ignore' });
  });

  it('surfaces a structured error when the configured executable is missing', async () => {
    settingsState.templates = [{ ...DIFF_TOOL, executablePath: 'C:/tools/gone.exe' }];
    fsState.missing.add('C:/tools/gone.exe');
    const handler = handlers.get('external:openDiffTool');
    const result = (await handler!({}, 'tool-diff-1', LEFT, RIGHT)) as {
      success: boolean;
      errorCode?: string;
    };

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('EXECUTABLE_NOT_FOUND');
    expect(spawnState.state.calls).toHaveLength(0);
  });

  it('surfaces a structured error when the spawn fails', async () => {
    settingsState.templates = [DIFF_TOOL];
    spawnState.state.outcome = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    const handler = handlers.get('external:openDiffTool');
    const result = (await handler!({}, 'tool-diff-1', LEFT, RIGHT)) as {
      success: boolean;
      errorCode?: string;
    };

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('SPAWN_FAILED');
  });

  it('falls back to registry resolution (and its error) for unknown ids', async () => {
    const handler = handlers.get('external:openDiffTool');
    const result = (await handler!({}, 'not-a-template', LEFT, RIGHT)) as {
      success: boolean;
      error?: string;
    };

    expect(result.success).toBe(false);
    expect(result.error).toContain('not registered');
    expect(spawnState.state.calls).toHaveLength(0);
  });

  it('does not use a merge-kind template for a diff launch', async () => {
    settingsState.templates = [MERGE_TOOL];
    const handler = handlers.get('external:openDiffTool');
    const result = (await handler!({}, 'tool-merge-1', LEFT, RIGHT)) as {
      success: boolean;
      error?: string;
    };

    expect(result.success).toBe(false);
    expect(result.error).toContain('not registered');
    expect(spawnState.state.calls).toHaveLength(0);
  });
});

describe('external:openMergeTool — settings template tools', () => {
  it('launches a stored merge template by id with expanded arguments', async () => {
    settingsState.templates = [MERGE_TOOL];
    const handler = handlers.get('external:openMergeTool');
    const result = (await handler!({}, 'tool-merge-1', LEFT, RIGHT, MERGED, MERGED)) as {
      success: boolean;
    };

    expect(result).toEqual({ success: true });
    const call = spawnState.state.calls[0];
    expect(call.command).toBe('C:/tools/merger.exe');
    expect(call.args).toEqual([LEFT, RIGHT, MERGED, '-o', MERGED]);
  });

  it('surfaces invalid templates without spawning', async () => {
    settingsState.templates = [{ ...MERGE_TOOL, argumentTemplate: '{mine} {theirs}' }];
    const handler = handlers.get('external:openMergeTool');
    const result = (await handler!({}, 'tool-merge-1', LEFT, RIGHT, MERGED, MERGED)) as {
      success: boolean;
      errorCode?: string;
      error?: string;
    };

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('TEMPLATE_INVALID');
    expect(result.error).toContain('{merged}');
    expect(spawnState.state.calls).toHaveLength(0);
  });
});
