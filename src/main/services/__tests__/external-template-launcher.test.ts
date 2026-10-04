// @vitest-environment node

/**
 * Tests for the main-side consumer of AppSettings.externalToolTemplates
 * (#87 / Track A coordination item 10): template expansion at launch time,
 * executable resolution, detached spawn, and the structured error paths.
 *
 * The expansion/validation logic itself is the shared module tested in
 * packages/shared/src/__tests__/external-tool-templates.test.ts — these
 * tests pin that the launcher uses it and handles launch failures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const settingsState = vi.hoisted(() => ({
  templates: [] as unknown[],
  failReady: false,
}));

vi.mock('../../settings-manager', () => ({
  getSettingsManager: () => ({
    ready: async () => {
      if (settingsState.failReady) throw new Error('settings unavailable');
    },
    getSettings: () => ({ externalToolTemplates: settingsState.templates }),
  }),
}));

const fsState = vi.hoisted(() => ({
  exists: true,
  isFile: true,
}));

vi.mock('fs/promises', () => ({
  realpath: async (p: string) => {
    if (!fsState.exists) throw new Error('ENOENT');
    return p;
  },
  stat: async () => {
    if (!fsState.exists) throw new Error('ENOENT');
    return {
      isFile: () => fsState.isFile,
      isDirectory: () => !fsState.isFile,
    };
  },
}));

interface SpawnCall {
  command: string;
  args: string[];
  options: Record<string, unknown>;
}

const spawnState = vi.hoisted(() => {
  const state = {
    calls: [] as SpawnCall[],
    /** 'spawn' (success) or an Error emitted as the child 'error' event. */
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

import {
  findSettingsToolTemplate,
  launchDiffToolTemplate,
  launchMergeToolTemplate,
} from '../external-template-launcher';

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
  settingsState.templates = [];
  settingsState.failReady = false;
  fsState.exists = true;
  fsState.isFile = true;
  spawnState.state.calls = [];
  spawnState.state.outcome = 'spawn';
});

describe('findSettingsToolTemplate', () => {
  it('finds a stored template by id and kind', async () => {
    settingsState.templates = [DIFF_TOOL, MERGE_TOOL];
    await expect(findSettingsToolTemplate('tool-merge-1', 'merge')).resolves.toMatchObject({
      id: 'tool-merge-1',
    });
  });

  it('ignores entries of the other kind', async () => {
    settingsState.templates = [DIFF_TOOL];
    await expect(findSettingsToolTemplate('tool-diff-1', 'merge')).resolves.toBeUndefined();
  });

  it('ignores malformed stored entries', async () => {
    settingsState.templates = [{ id: 'broken', kind: 'diff' }, DIFF_TOOL];
    await expect(findSettingsToolTemplate('broken', 'diff')).resolves.toBeUndefined();
    await expect(findSettingsToolTemplate('tool-diff-1', 'diff')).resolves.toMatchObject({
      id: 'tool-diff-1',
    });
  });

  it('returns undefined (never throws) when settings are unavailable', async () => {
    settingsState.failReady = true;
    await expect(findSettingsToolTemplate('tool-diff-1', 'diff')).resolves.toBeUndefined();
  });
});

describe('launchDiffToolTemplate', () => {
  it('expands {mine}/{theirs} (and aliases) into a detached argv spawn', async () => {
    const result = await launchDiffToolTemplate(DIFF_TOOL, {
      left: 'C:/wc/left.txt',
      right: 'C:/wc/right.txt',
    });

    expect(result).toEqual({ success: true });
    expect(spawnState.state.calls).toHaveLength(1);
    const call = spawnState.state.calls[0];
    expect(call.command).toBe('C:/tools/differ.exe');
    expect(call.args).toEqual(['--left', 'C:/wc/left.txt', '--right', 'C:/wc/right.txt']);
    expect(call.options).toMatchObject({
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    });
  });

  it('expands {left}/{right} aliases to the same values', async () => {
    const result = await launchDiffToolTemplate(
      { ...DIFF_TOOL, argumentTemplate: '{left} {right}' },
      { left: 'C:/wc/l.txt', right: 'C:/wc/r.txt' }
    );
    expect(result).toEqual({ success: true });
    expect(spawnState.state.calls[0].args).toEqual(['C:/wc/l.txt', 'C:/wc/r.txt']);
  });

  it('fails with TOOL_CONFIG_INVALID when the executable path is empty', async () => {
    const result = await launchDiffToolTemplate(
      { ...DIFF_TOOL, executablePath: '   ' },
      { left: 'C:/wc/l.txt', right: 'C:/wc/r.txt' }
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('TOOL_CONFIG_INVALID');
    expect(spawnState.state.calls).toHaveLength(0);
  });

  it('fails with TEMPLATE_INVALID when required placeholders are missing', async () => {
    const result = await launchDiffToolTemplate(
      { ...DIFF_TOOL, argumentTemplate: '{mine} only' },
      { left: 'C:/wc/l.txt', right: 'C:/wc/r.txt' }
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('TEMPLATE_INVALID');
    expect(result.error).toContain('{theirs}');
    expect(spawnState.state.calls).toHaveLength(0);
  });

  it('fails with TEMPLATE_INVALID when the template is empty', async () => {
    const result = await launchDiffToolTemplate(
      { ...DIFF_TOOL, argumentTemplate: '' },
      { left: 'C:/wc/l.txt', right: 'C:/wc/r.txt' }
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('TEMPLATE_INVALID');
  });

  it('fails with PLACEHOLDER_UNRESOLVED when a placeholder has no launch value', async () => {
    // Unknown placeholders pass template validation (warning only) but must
    // not reach the tool literally at launch time.
    const result = await launchDiffToolTemplate(
      { ...DIFF_TOOL, argumentTemplate: '{mine} {theirs} {revision}' },
      { left: 'C:/wc/l.txt', right: 'C:/wc/r.txt' }
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PLACEHOLDER_UNRESOLVED');
    expect(result.error).toContain('{revision}');
    expect(spawnState.state.calls).toHaveLength(0);
  });

  it('fails with EXECUTABLE_NOT_FOUND when the executable does not exist', async () => {
    fsState.exists = false;
    const result = await launchDiffToolTemplate(DIFF_TOOL, {
      left: 'C:/wc/l.txt',
      right: 'C:/wc/r.txt',
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('EXECUTABLE_NOT_FOUND');
    expect(result.error).toContain('C:/tools/differ.exe');
    expect(spawnState.state.calls).toHaveLength(0);
  });

  it('fails with EXECUTABLE_NOT_FOUND when the path is a directory', async () => {
    fsState.isFile = false;
    const result = await launchDiffToolTemplate(DIFF_TOOL, {
      left: 'C:/wc/l.txt',
      right: 'C:/wc/r.txt',
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('EXECUTABLE_NOT_FOUND');
  });

  it('fails with SPAWN_FAILED when the process cannot be created (ENOENT)', async () => {
    spawnState.state.outcome = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    const result = await launchDiffToolTemplate(DIFF_TOOL, {
      left: 'C:/wc/l.txt',
      right: 'C:/wc/r.txt',
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('SPAWN_FAILED');
    expect(result.error).toContain('could not be started');
  });

  it('reports the OS error for non-ENOENT spawn failures', async () => {
    spawnState.state.outcome = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const result = await launchDiffToolTemplate(DIFF_TOOL, {
      left: 'C:/wc/l.txt',
      right: 'C:/wc/r.txt',
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('SPAWN_FAILED');
    expect(result.error).toContain('permission denied');
  });
});

describe('launchMergeToolTemplate', () => {
  it('expands the merge placeholders into a detached argv spawn', async () => {
    const result = await launchMergeToolTemplate(MERGE_TOOL, {
      base: 'C:/wc/f.r1',
      mine: 'C:/wc/f.mine',
      theirs: 'C:/wc/f.r2',
      merged: 'C:/wc/f',
    });

    expect(result).toEqual({ success: true });
    const call = spawnState.state.calls[0];
    expect(call.command).toBe('C:/tools/merger.exe');
    expect(call.args).toEqual(['C:/wc/f.r1', 'C:/wc/f.mine', 'C:/wc/f.r2', '-o', 'C:/wc/f']);
    expect(call.options).toMatchObject({ detached: true, shell: false, stdio: 'ignore' });
  });

  it('fails with PLACEHOLDER_UNRESOLVED when {base} is used but unavailable', async () => {
    const noBaseTool = { ...MERGE_TOOL, argumentTemplate: '-b {base} {mine} {theirs} {merged}' };
    const result = await launchMergeToolTemplate(noBaseTool, {
      base: undefined as unknown as string,
      mine: 'C:/wc/f.mine',
      theirs: 'C:/wc/f.r2',
      merged: 'C:/wc/f',
    });
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('PLACEHOLDER_UNRESOLVED');
    expect(result.error).toContain('{base}');
    expect(spawnState.state.calls).toHaveLength(0);
  });

  it('fails with TEMPLATE_INVALID when {merged} is missing from a merge template', async () => {
    const result = await launchMergeToolTemplate(
      { ...MERGE_TOOL, argumentTemplate: '{base} {mine} {theirs}' },
      { base: 'C:/wc/f.r1', mine: 'C:/wc/f.mine', theirs: 'C:/wc/f.r2', merged: 'C:/wc/f' }
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('TEMPLATE_INVALID');
    expect(result.error).toContain('{merged}');
  });
});
