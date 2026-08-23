// @vitest-environment node

/*
 * Unit coverage for the interrupted-mutation recovery layer (beta backlog
 * item #31): partial-mutation detection composed from file evidence (fake
 * `.svn` artifacts on temp directories) and mocked `svn status`/`svn info`
 * CLI evidence, recovery-plan correctness, and the explicit plan executor
 * (approval, ordering, failure short-circuit, idempotency).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  runSvnText: vi.fn(async () => ''),
  runSerializedWorkingCopyMutation: vi.fn(async (_key: string, task: () => Promise<unknown>) =>
    task()
  ),
}));

vi.mock('../svn-executor', () => ({
  runSvnText: mockState.runSvnText,
}));

vi.mock('../svn-mutation-queue', () => ({
  runSerializedWorkingCopyMutation: mockState.runSerializedWorkingCopyMutation,
}));

import {
  buildInterruptedMutationRecoveryPlan,
  detectPartialWorkingCopyMutation,
  executeInterruptedMutationRecoveryPlan,
  type PartialMutationDetection,
} from '../svn-working-copy-health';
import { clearApprovedPathsForTests, approvePathForIpc } from '../../utils/approved-paths';

function statusXml(root: string, entries: Array<{ path: string; item: string }>): string {
  const target = join(root, '.'); // svn echoes the requested target path
  const entryXml = entries
    .map(
      (entry) =>
        `<entry path="${entry.path}"><wc-status item="${entry.item}" props="none" revision="4"/></entry>`
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<status><target path="${target}">${entryXml}</target></status>`
  );
}

function detectionFor(
  workingCopyPath: string,
  evidence: PartialMutationDetection['evidence'],
  notes: string[] = []
): PartialMutationDetection {
  return {
    workingCopyPath,
    detectedAt: '2026-01-01T00:00:00.000Z',
    hasEvidence: evidence.length > 0,
    evidence,
    notes,
  };
}

async function createWorkingCopyFixture(lockKind: 'file' | 'none' = 'none'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'shelly-wc-health-'));
  await mkdir(join(root, '.svn'), { recursive: true });
  if (lockKind === 'file') {
    await writeFile(join(root, '.svn', 'lock'), '', { mode: 0o600 });
  }
  return root;
}

const journalRecord = {
  workingCopyPath: '/tmp/wc',
  interruptedAt: '2026-01-02T03:04:05.000Z',
  reason: 'shutdown',
};

describe('detectPartialWorkingCopyMutation (item #31)', () => {
  let root: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockReset();
    mockState.runSvnText.mockResolvedValue('');
    mockState.runSerializedWorkingCopyMutation.mockReset();
    mockState.runSerializedWorkingCopyMutation.mockImplementation(
      async (_key: string, task: () => Promise<unknown>) => task()
    );
  });

  afterEach(async () => {
    clearApprovedPathsForTests();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('reports a healthy working copy with no evidence and no notes', async () => {
    root = await createWorkingCopyFixture('none');
    mockState.runSvnText.mockResolvedValue(statusXml(root, []));

    const detection = await detectPartialWorkingCopyMutation(root);

    expect(detection).toMatchObject({ workingCopyPath: root, hasEvidence: false });
    expect(detection.evidence).toEqual([]);
    expect(detection.notes).toEqual([]);
    expect(mockState.runSvnText).toHaveBeenCalledWith(
      ['status', '--xml', '--no-ignore', '--', root],
      expect.objectContaining({ cwd: root })
    );
  });

  it('detects a leftover .svn/lock administrative file', async () => {
    root = await createWorkingCopyFixture('file');
    mockState.runSvnText.mockResolvedValue(statusXml(root, []));

    const detection = await detectPartialWorkingCopyMutation(root);

    expect(detection.hasEvidence).toBe(true);
    expect(detection.evidence).toHaveLength(1);
    expect(detection.evidence[0]).toMatchObject({ kind: 'stale-admin-lock' });
    expect(detection.evidence[0].paths[0]).toBe(join(root, '.svn', 'lock'));
  });

  it('collects missing and incomplete status markers as update-interruption evidence', async () => {
    root = await createWorkingCopyFixture('none');
    mockState.runSvnText.mockImplementation(async (args: string[]) =>
      args[0] === 'status'
        ? statusXml(root, [
            { path: 'src/never-arrived.ts', item: 'missing' },
            { path: 'subdir', item: 'incomplete' },
          ])
        : ''
    );

    const detection = await detectPartialWorkingCopyMutation(root);

    const kinds = detection.evidence.map((item) => item.kind).toSorted();
    expect(kinds).toEqual(['incomplete-tree', 'missing-versioned-paths']);
    const missing = detection.evidence.find((item) => item.kind === 'missing-versioned-paths');
    expect(missing?.paths).toEqual([join(root, 'src', 'never-arrived.ts')]);
    const incomplete = detection.evidence.find((item) => item.kind === 'incomplete-tree');
    expect(incomplete?.paths).toEqual([join(root, 'subdir')]);
  });

  it('caps the number of listed evidence paths', async () => {
    root = await createWorkingCopyFixture('none');
    mockState.runSvnText.mockImplementation(async (args: string[]) =>
      args[0] === 'status'
        ? statusXml(
            root,
            Array.from({ length: 15 }, (_, index) => ({
              path: `file-${index}.txt`,
              item: 'missing',
            }))
          )
        : ''
    );

    const detection = await detectPartialWorkingCopyMutation(root);

    const missing = detection.evidence.find((item) => item.kind === 'missing-versioned-paths');
    expect(missing?.paths).toHaveLength(10);
    expect(missing?.detail).toContain('15');
  });

  it('ignores status paths that escape the working-copy root (untrusted CLI output)', async () => {
    root = await createWorkingCopyFixture('none');
    mockState.runSvnText.mockImplementation(async (args: string[]) =>
      args[0] === 'status'
        ? statusXml(root, [
            { path: '../../outside.txt', item: 'missing' },
            { path: 'inside.txt', item: 'missing' },
          ])
        : ''
    );

    const detection = await detectPartialWorkingCopyMutation(root);

    const missing = detection.evidence.find((item) => item.kind === 'missing-versioned-paths');
    expect(missing?.paths).toEqual([join(root, 'inside.txt')]);
  });

  it('maps CLI "working copy locked" and "incomplete" failures onto evidence kinds', async () => {
    root = await createWorkingCopyFixture('none');
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status') {
        throw new Error("svn: E155004: Working copy '/tmp/wc' locked; try running 'svn cleanup'");
      }
      return '';
    });

    const locked = await detectPartialWorkingCopyMutation(root);
    expect(locked.evidence.map((item) => item.kind)).toEqual(['stale-admin-lock']);

    mockState.runSvnText.mockReset();
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args[0] === 'info') {
        throw new Error('svn: E155015: The working copy is incomplete');
      }
      return statusXml(root, []);
    });

    const incomplete = await detectPartialWorkingCopyMutation(root);
    expect(incomplete.evidence.map((item) => item.kind)).toEqual(['incomplete-tree']);
  });

  it('records unrelated probe failures as notes without claiming evidence', async () => {
    root = await createWorkingCopyFixture('none');
    mockState.runSvnText.mockRejectedValue(new Error('svn: E175002: connection refused'));

    const detection = await detectPartialWorkingCopyMutation(root);

    expect(detection.hasEvidence).toBe(false);
    expect(detection.notes).toHaveLength(2);
    expect(detection.notes[0]).toContain('svn status probe failed');
    expect(detection.notes[1]).toContain('svn info probe failed');
  });

  it('treats missing CLI output (undefined) as unavailable rather than crashing', async () => {
    root = await createWorkingCopyFixture('file');
    mockState.runSvnText.mockResolvedValue(undefined as unknown as string);

    const detection = await detectPartialWorkingCopyMutation(root);

    expect(detection.hasEvidence).toBe(true);
    expect(detection.evidence[0].kind).toBe('stale-admin-lock');
  });
});

describe('buildInterruptedMutationRecoveryPlan (item #31)', () => {
  it('proposes nothing for a healthy working copy without a journal record', () => {
    const plan = buildInterruptedMutationRecoveryPlan('/tmp/wc', detectionFor('/tmp/wc', []), null);

    expect(plan.steps).toEqual([]);
    expect(plan.source).toBe('detection');
    expect(plan.rationale).toContain('no current-state evidence');
  });

  it('proposes cleanup plus verification for a lock-only finding', () => {
    const detection = detectionFor('/tmp/wc', [
      { kind: 'stale-admin-lock', detail: 'leftover lock', paths: ['/tmp/wc/.svn/lock'] },
    ]);
    const plan = buildInterruptedMutationRecoveryPlan('/tmp/wc', detection, null);

    expect(plan.steps.map((step) => step.kind)).toEqual(['svn-cleanup', 'verify-status']);
    expect(plan.source).toBe('detection');
  });

  it('adds the retry-update step when missing/incomplete evidence implies an interrupted update', () => {
    const detection = detectionFor('/tmp/wc', [
      { kind: 'missing-versioned-paths', detail: '2 paths missing', paths: [] },
    ]);
    const plan = buildInterruptedMutationRecoveryPlan('/tmp/wc', detection, null);

    expect(plan.steps.map((step) => step.kind)).toEqual([
      'svn-cleanup',
      'retry-update',
      'verify-status',
    ]);
  });

  it('honors an explicit interrupted-operation hint for commits', () => {
    const detection = detectionFor('/tmp/wc', [
      { kind: 'stale-admin-lock', detail: 'leftover lock', paths: [] },
    ]);
    const plan = buildInterruptedMutationRecoveryPlan('/tmp/wc', detection, null, {
      interruptedOperation: 'commit',
    });

    expect(plan.steps.map((step) => step.kind)).toEqual([
      'svn-cleanup',
      'retry-commit',
      'verify-status',
    ]);
    expect(plan.steps[1].command).toEqual(['status']);
  });

  it('composes the Phase 1 journal record with current-state detection', () => {
    const detection = detectionFor('/tmp/wc', [
      { kind: 'incomplete-tree', detail: 'incomplete subtree', paths: [] },
    ]);
    const plan = buildInterruptedMutationRecoveryPlan('/tmp/wc', detection, journalRecord);

    expect(plan.source).toBe('journal+detection');
    expect(plan.rationale).toContain(journalRecord.interruptedAt);
    expect(plan.rationale).toContain(journalRecord.reason);
    expect(plan.steps.map((step) => step.kind)).toEqual([
      'svn-cleanup',
      'retry-update',
      'verify-status',
    ]);
    expect(plan.evidence).toBe(detection.evidence);
  });

  it('still proposes cleanup for a journal record whose working copy looks healthy now', () => {
    const plan = buildInterruptedMutationRecoveryPlan('/tmp/wc', detectionFor('/tmp/wc', []), {
      ...journalRecord,
      workingCopyPath: '/tmp/wc',
    });

    expect(plan.source).toBe('journal');
    expect(plan.steps.map((step) => step.kind)).toEqual(['svn-cleanup', 'verify-status']);
  });
});

describe('executeInterruptedMutationRecoveryPlan (item #31)', () => {
  let root: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.runSvnText.mockReset();
    mockState.runSvnText.mockResolvedValue('');
    mockState.runSerializedWorkingCopyMutation.mockReset();
    mockState.runSerializedWorkingCopyMutation.mockImplementation(
      async (_key: string, task: () => Promise<unknown>) => task()
    );
  });

  afterEach(async () => {
    clearApprovedPathsForTests();
    if (root) await rm(root, { recursive: true, force: true });
  });

  function planFor(rootPath: string) {
    const detection = detectionFor(rootPath, [
      { kind: 'missing-versioned-paths', detail: 'missing', paths: [] },
    ]);
    const plan = buildInterruptedMutationRecoveryPlan(rootPath, detection, {
      ...journalRecord,
      workingCopyPath: rootPath,
    });
    expect(plan.steps.map((step) => step.kind)).toEqual([
      'svn-cleanup',
      'retry-update',
      'verify-status',
    ]);
    return plan;
  }

  it('runs the proposed steps serialized, in order, against the approved working copy', async () => {
    root = await createWorkingCopyFixture('file');
    approvePathForIpc(root, 'directory');
    const plan = planFor(root);
    // assertPathApprovedForIpc canonicalizes (macOS /var -> /private/var).
    const canonicalRoot = realpathSync(root);

    const result = await executeInterruptedMutationRecoveryPlan(root, plan);

    expect(result.allSucceeded).toBe(true);
    expect(result.workingCopyPath).toBe(canonicalRoot);
    expect(mockState.runSerializedWorkingCopyMutation).toHaveBeenCalledTimes(1);
    expect(mockState.runSerializedWorkingCopyMutation).toHaveBeenCalledWith(
      canonicalRoot,
      expect.any(Function)
    );
    expect(mockState.runSvnText.mock.calls.map((call) => call[0])).toEqual([
      ['cleanup', '--', canonicalRoot],
      ['update', '--', canonicalRoot],
      ['status', '--', canonicalRoot],
    ]);
    expect(result.steps.map((step) => step.kind)).toEqual([
      'svn-cleanup',
      'retry-update',
      'verify-status',
    ]);
    expect(result.steps.every((step) => step.success && !step.skipped)).toBe(true);
  });

  it('is idempotent: re-running a completed plan succeeds again', async () => {
    root = await createWorkingCopyFixture('none');
    approvePathForIpc(root, 'directory');
    const plan = planFor(root);

    const first = await executeInterruptedMutationRecoveryPlan(root, plan);
    const second = await executeInterruptedMutationRecoveryPlan(root, plan);

    expect(first.allSucceeded).toBe(true);
    expect(second.allSucceeded).toBe(true);
    expect(mockState.runSvnText).toHaveBeenCalledTimes(6);
  });

  it('skips the remaining steps when one fails', async () => {
    root = await createWorkingCopyFixture('file');
    approvePathForIpc(root, 'directory');
    const plan = planFor(root);
    mockState.runSvnText.mockImplementation(async (args: string[]) => {
      if (args[0] === 'cleanup') {
        throw new Error('svn: E155004: working copy locked');
      }
      return '';
    });

    const result = await executeInterruptedMutationRecoveryPlan(root, plan);

    expect(result.allSucceeded).toBe(false);
    expect(result.steps[0]).toMatchObject({ kind: 'svn-cleanup', success: false, skipped: false });
    expect(result.steps[0].error).toContain('E155004');
    expect(result.steps.slice(1)).toEqual([
      expect.objectContaining({ kind: 'retry-update', success: false, skipped: true }),
      expect.objectContaining({ kind: 'verify-status', success: false, skipped: true }),
    ]);
  });

  it('executes nothing for an empty (healthy) plan', async () => {
    root = await createWorkingCopyFixture('none');
    approvePathForIpc(root, 'directory');
    const plan = buildInterruptedMutationRecoveryPlan(root, detectionFor(root, []), null);

    const result = await executeInterruptedMutationRecoveryPlan(root, plan);

    expect(result.steps).toEqual([]);
    expect(result.allSucceeded).toBe(true);
    expect(mockState.runSvnText).not.toHaveBeenCalled();
  });

  it('requires an IPC-approved working copy and truncates step output', async () => {
    root = await createWorkingCopyFixture('none');
    approvePathForIpc(root, 'directory');
    mockState.runSvnText.mockResolvedValue('x'.repeat(10_000));
    const plan = buildInterruptedMutationRecoveryPlan(
      root,
      detectionFor(root, [
        { kind: 'stale-admin-lock', detail: 'leftover lock', paths: [join(root, '.svn', 'lock')] },
      ]),
      null
    );
    expect(plan.steps.map((step) => step.kind)).toEqual(['svn-cleanup', 'verify-status']);

    const result = await executeInterruptedMutationRecoveryPlan(root, plan);
    expect(result.steps[0].output.length).toBe(4_000);

    await expect(
      executeInterruptedMutationRecoveryPlan('/definitely/not/approved', {
        ...plan,
        workingCopyPath: '/definitely/not/approved',
      })
    ).rejects.toThrow(/only allowed inside a folder selected/i);
  });
});
