import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron';
import type { InterruptedMutationRecord, StaleWorkingCopyLockInfo } from '@shared/types';
import { existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { getSettingsManager } from '../settings-manager';
import { debug } from '../utils/debug';
import { sendToRenderer } from '../utils/safe-renderer-send';
import { processDeepLink } from './protocol-handler';
import {
  beginSvnNetworkSuspend,
  endSvnNetworkSuspend,
  getSuspendedSvnNetworkUrls,
  isSvnNetworkSuspended,
} from './svn-executor';
import {
  clearInterruptedWorkingCopyMutations,
  getMutationInterruptionJournalPath,
  markActiveWorkingCopyMutationsInterrupted,
  readInterruptedWorkingCopyMutations,
} from './svn-mutation-queue';
import {
  buildInterruptedMutationRecoveryPlan,
  detectPartialWorkingCopyMutation,
  detectStaleWorkingCopyLock,
  executeInterruptedMutationRecoveryPlan,
  removeStaleWorkingCopyLock,
  type InterruptedMutationRecoveryPlan,
} from './svn-working-copy-health';

/**
 * App lifecycle service (beta backlog items #22–#25).
 *
 * Keeps src/main/index.ts thin by owning:
 * - the single-instance lock and second-instance handoff,
 * - startup signals for stale `.svn/lock` files and mutations interrupted by
 *   the previous session's shutdown,
 * - the suspend/resume connectivity gate around repository-bound SVN traffic,
 * - the IPC surface for the renderer to consume those signals.
 */

/** How many recently opened working copies to inspect for stale locks. */
const MAX_STALE_LOCK_SCAN_PATHS = 25;
/** Parent-directory hops when resolving a nested path to its WC root. */
const MAX_WORKING_COPY_ROOT_HOPS = 24;

export const RESUME_PROBE_TIMEOUT_MS = 5_000;
export const RESUME_PROBE_MAX_TOTAL_MS = 5 * 60 * 1000;
const RESUME_PROBE_INITIAL_BACKOFF_MS = 1_000;
const RESUME_PROBE_MAX_BACKOFF_MS = 30_000;

let powerMonitorHandlersRegistered = false;
let resumeProbePromise: Promise<void> | null = null;
let startupChecksStarted = false;
let lifecycleIpcRegistered = false;
let detectedStaleLocks: StaleWorkingCopyLockInfo[] = [];
let interruptedMutations: InterruptedMutationRecord[] = [];
let interruptedMutationRecoveryPlans: InterruptedMutationRecoveryPlan[] = [];

// ---------------------------------------------------------------------------
// Item #22 — single-instance lock with second-instance handoff
// ---------------------------------------------------------------------------

export interface SingleInstanceOptions {
  getMainWindow: () => BrowserWindow | null;
}

function focusMainWindow(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return;
  try {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  } catch (error) {
    debug.warn('[lifecycle] Failed to focus the main window:', error);
  }
}

export function extractDeepLinkArgv(argv: string[]): string[] {
  return argv.filter((arg) => typeof arg === 'string' && arg.startsWith('shellysvn://'));
}

function handleSecondInstance(argv: string[], options: SingleInstanceOptions): void {
  focusMainWindow(options.getMainWindow());
  // On Windows/Linux the protocol handler's own second-instance listener
  // already relays shellysvn:// argv entries; forwarding here as well would
  // deliver every deep link twice. macOS gets no such listener, so this is
  // the only argv relay on that platform.
  if (process.platform === 'darwin') {
    for (const url of extractDeepLinkArgv(argv)) {
      try {
        processDeepLink(url);
      } catch (error) {
        debug.warn('[lifecycle] Failed to forward deep link from second instance:', error);
      }
    }
  }
}

/**
 * Acquire the OS-level single-instance lock. Must run at the very top of app
 * startup, before any window exists, so a second launch hands off to the
 * primary instance instead of racing working-copy mutations. Returns false
 * when another instance already holds the lock (the caller should quit
 * quietly); true otherwise.
 */
export function ensureSingleInstanceLock(options: SingleInstanceOptions): boolean {
  if (typeof app.requestSingleInstanceLock !== 'function') {
    // Unavailable in stripped-down test harnesses: behave as the sole instance.
    return true;
  }

  let gotLock: boolean;
  try {
    gotLock = app.requestSingleInstanceLock();
  } catch (error) {
    debug.warn('[lifecycle] Single-instance lock could not be evaluated:', error);
    return true;
  }

  if (!gotLock) return false;

  app.on('second-instance', (_event, argv) => {
    handleSecondInstance(argv ?? [], options);
  });
  return true;
}

// ---------------------------------------------------------------------------
// Item #25 — suspend/resume connectivity gate
// ---------------------------------------------------------------------------

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

function pickProbeOrigin(urls: string[]): URL | null {
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed;
    } catch {
      // Non-URL entries are expected.
    }
  }
  return null;
}

/**
 * Cheap reachability probe against the origin of a repository URL touched by
 * suspended traffic. Any HTTP response — even an auth failure or 404 — proves
 * TCP+TLS connectivity is back; only a transport error means "still asleep".
 * Repositories without an HTTP(S) origin (svn://, svn+ssh://) have no cheap
 * probe, so they are treated as reachable and left to SVN's own timeouts.
 */
export async function probeSvnConnectivity(urls: string[]): Promise<boolean> {
  const origin = pickProbeOrigin(urls);
  if (!origin) return true;
  try {
    const response = await fetch(origin.origin, {
      method: 'HEAD',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(RESUME_PROBE_TIMEOUT_MS),
    });
    debug.log(
      `[lifecycle] Post-resume connectivity probe ${origin.origin} -> HTTP ${response.status}`
    );
    return true;
  } catch (error) {
    debug.warn('[lifecycle] Post-resume connectivity probe failed:', error);
    return false;
  }
}

export async function handleSystemSuspend(): Promise<void> {
  const aborted = beginSvnNetworkSuspend();
  debug.log(
    `[lifecycle] System suspending: aborted ${aborted} in-flight network SVN operation(s); gate closed.`
  );
}

export interface ResumeProbeOptions {
  probe?: (urls: string[]) => Promise<boolean>;
  maxTotalMs?: number;
  backoffMs?: number;
}

/**
 * Re-verify connectivity after the system resumes before releasing queued
 * repository-bound operations. Probes retry with capped backoff; a bounded
 * total budget (default 5 minutes) guarantees the gate eventually opens so
 * operations can surface their own network errors instead of queueing forever.
 */
export async function handleSystemResume(options: ResumeProbeOptions = {}): Promise<void> {
  const probe = options.probe ?? probeSvnConnectivity;
  const maxTotalMs = options.maxTotalMs ?? RESUME_PROBE_MAX_TOTAL_MS;
  let backoffMs = options.backoffMs ?? RESUME_PROBE_INITIAL_BACKOFF_MS;

  const startedAt = Date.now();
  for (;;) {
    if (!isSvnNetworkSuspended()) return; // gate already released elsewhere
    const urls = getSuspendedSvnNetworkUrls();
    if (await probe(urls)) break;
    if (Date.now() - startedAt >= maxTotalMs) {
      debug.warn(
        '[lifecycle] Connectivity unverified after resume; releasing the network gate so operations surface their own errors.'
      );
      break;
    }
    await delay(backoffMs);
    backoffMs = Math.min(backoffMs * 2, RESUME_PROBE_MAX_BACKOFF_MS);
  }
  endSvnNetworkSuspend();
  debug.log('[lifecycle] System resumed: network gate open.');
}

export function registerPowerMonitorHandlers(): void {
  if (powerMonitorHandlersRegistered) return;
  // powerMonitor only exists once the app is ready and is absent from
  // minimal Electron test harnesses.
  if (typeof powerMonitor?.on !== 'function') {
    debug.warn('[lifecycle] powerMonitor unavailable; sleep/resume handling disabled.');
    return;
  }
  powerMonitorHandlersRegistered = true;
  powerMonitor.on('suspend', () => {
    void handleSystemSuspend();
  });
  powerMonitor.on('resume', () => {
    resumeProbePromise ??= handleSystemResume().finally(() => {
      resumeProbePromise = null;
    });
  });
}

// ---------------------------------------------------------------------------
// Item #23 — stale .svn/lock detection at startup
// ---------------------------------------------------------------------------

function looksLikeRepositoryUrl(candidate: string): boolean {
  return /^(?:https?|svn(?:\+ssh)?):\/\//i.test(candidate);
}

/** Resolve a path inside a working copy to the root owning the `.svn` admin area. */
function resolveWorkingCopyRoot(candidate: string): string | null {
  let current = candidate;
  for (let hops = 0; hops < MAX_WORKING_COPY_ROOT_HOPS; hops += 1) {
    if (existsSync(join(current, '.svn'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

export async function scanForStaleWorkingCopyLocks(): Promise<StaleWorkingCopyLockInfo[]> {
  const settingsManager = getSettingsManager();
  await settingsManager.ready();
  const recentRepositories = settingsManager.getSettings().recentRepositories ?? [];

  const findings: StaleWorkingCopyLockInfo[] = [];
  for (const candidate of recentRepositories.slice(0, MAX_STALE_LOCK_SCAN_PATHS)) {
    if (typeof candidate !== 'string' || !candidate || looksLikeRepositoryUrl(candidate)) continue;
    const root = resolveWorkingCopyRoot(candidate);
    if (!root) continue;
    try {
      const stale = await detectStaleWorkingCopyLock(root);
      if (stale) findings.push(stale);
    } catch {
      // A transient FS error must never block startup.
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Item #24 — interrupted-mutation recovery signal
// ---------------------------------------------------------------------------

function getJournalPath(): string {
  return getMutationInterruptionJournalPath(app.getPath('userData'));
}

/**
 * Persist the in-flight mutations as interrupted. Called from the quit path
 * right before those operations are cancelled, so the next launch can offer
 * recovery for exactly those working copies.
 */
export function persistInterruptedWorkingCopyMutations(reason = 'shutdown'): number {
  try {
    return markActiveWorkingCopyMutationsInterrupted(getJournalPath(), reason);
  } catch (error) {
    debug.warn('[lifecycle] Failed to persist interrupted mutations:', error);
    return 0;
  }
}

export function getInterruptedWorkingCopyMutations(): InterruptedMutationRecord[] {
  return interruptedMutations;
}

export function getInterruptedMutationRecoveryPlans(): InterruptedMutationRecoveryPlan[] {
  return interruptedMutationRecoveryPlans;
}

export function getDetectedStaleWorkingCopyLocks(): StaleWorkingCopyLockInfo[] {
  return detectedStaleLocks;
}

// ---------------------------------------------------------------------------
// Renderer signal plumbing + IPC surface
// ---------------------------------------------------------------------------

function broadcastToRenderers(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    sendToRenderer(window.webContents, channel, payload);
  }
}

/**
 * Compose the Phase 1 interruption journal with current-state detection
 * (backlog item #31): the journal claims a mutation was interrupted on a
 * working copy; detection confirms the working copy still shows the damage
 * (leftover lock, missing/incomplete trees). Only corroborated records get a
 * recovery proposal — a journal entry alone keeps the existing
 * interrupted-mutations signal, and detection failures never block startup.
 * Proposals are broadcast as data; nothing is executed without the renderer
 * explicitly invoking the recovery executor.
 */
async function buildStartupInterruptedMutationRecoveryPlans(): Promise<
  InterruptedMutationRecoveryPlan[]
> {
  const plans: InterruptedMutationRecoveryPlan[] = [];
  for (const record of interruptedMutations) {
    try {
      const detection = await detectPartialWorkingCopyMutation(record.workingCopyPath);
      if (!detection.hasEvidence) continue;
      plans.push(buildInterruptedMutationRecoveryPlan(record.workingCopyPath, detection, record));
    } catch (error) {
      debug.warn(
        `[lifecycle] Interrupted-mutation recovery scan failed for ${record.workingCopyPath}:`,
        error
      );
    }
  }
  return plans;
}

/**
 * Run the post-window startup checks (idempotent): surface mutations
 * interrupted by the previous session and stale `.svn/lock` leftovers from
 * recently opened working copies. Signals are both pushed as events and kept
 * behind getters, so a renderer that finishes loading after the scan can pull
 * them.
 */
export async function initializeAppLifecycle(): Promise<void> {
  if (startupChecksStarted) return;
  startupChecksStarted = true;

  try {
    interruptedMutations = readInterruptedWorkingCopyMutations(getJournalPath());
  } catch {
    interruptedMutations = [];
  }
  if (interruptedMutations.length > 0) {
    debug.warn(
      `[lifecycle] ${interruptedMutations.length} working-copy mutation(s) were interrupted by the previous session.`
    );
    broadcastToRenderers('lifecycle:interruptedWorkingCopyMutations', interruptedMutations);
  }

  try {
    interruptedMutationRecoveryPlans = await buildStartupInterruptedMutationRecoveryPlans();
  } catch (error) {
    debug.warn('[lifecycle] Interrupted-mutation recovery planning failed:', error);
    interruptedMutationRecoveryPlans = [];
  }
  for (const plan of interruptedMutationRecoveryPlans) {
    broadcastToRenderers('lifecycle:interruptedMutationRecoveryPlan', plan);
  }

  try {
    detectedStaleLocks = await scanForStaleWorkingCopyLocks();
  } catch (error) {
    debug.warn('[lifecycle] Stale working-copy lock scan failed:', error);
    detectedStaleLocks = [];
  }
  for (const staleLock of detectedStaleLocks) {
    broadcastToRenderers('lifecycle:staleWorkingCopyLock', staleLock);
  }
}

/**
 * Register the lifecycle IPC surface. Must run after the secure IPC boundary
 * is installed so every handler inherits its sender validation.
 */
export function registerAppLifecycleIpcHandlers(): void {
  if (lifecycleIpcRegistered) return;
  lifecycleIpcRegistered = true;

  ipcMain.handle('lifecycle:getStaleWorkingCopyLocks', () => getDetectedStaleWorkingCopyLocks());

  // Explicitly invoked, validated cleanup — never automatic (backlog item #23).
  ipcMain.handle(
    'lifecycle:removeStaleWorkingCopyLock',
    async (_event, workingCopyPath: unknown): Promise<{ success: boolean; error?: string }> => {
      if (typeof workingCopyPath !== 'string' || workingCopyPath.trim().length === 0) {
        return { success: false, error: 'A working-copy path is required.' };
      }
      try {
        const result = await removeStaleWorkingCopyLock(workingCopyPath);
        if (result.success) {
          detectedStaleLocks = detectedStaleLocks.filter(
            (entry) => entry.workingCopyPath !== workingCopyPath
          );
        }
        return result;
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle('lifecycle:getInterruptedWorkingCopyMutations', () =>
    getInterruptedWorkingCopyMutations()
  );

  ipcMain.handle('lifecycle:getInterruptedMutationRecoveryPlans', () =>
    getInterruptedMutationRecoveryPlans()
  );

  // Explicitly invoked recovery execution — proposals are data only until the
  // renderer asks for them to run (backlog item #31).
  ipcMain.handle(
    'lifecycle:executeInterruptedMutationRecoveryPlan',
    async (
      _event,
      workingCopyPath: unknown
    ): Promise<{
      success: boolean;
      error?: string;
      workingCopyPath?: string;
      steps?: Awaited<ReturnType<typeof executeInterruptedMutationRecoveryPlan>>['steps'];
    }> => {
      if (typeof workingCopyPath !== 'string' || workingCopyPath.trim().length === 0) {
        return { success: false, error: 'A working-copy path is required.' };
      }
      const requested = normalize(workingCopyPath.trim());
      const plan = interruptedMutationRecoveryPlans.find(
        (candidate) => normalize(candidate.workingCopyPath) === requested
      );
      if (!plan) {
        return {
          success: false,
          error: 'No interrupted-mutation recovery plan found for that working copy.',
        };
      }
      try {
        const result = await executeInterruptedMutationRecoveryPlan(workingCopyPath, plan);
        return { success: result.allSucceeded, ...result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle('lifecycle:clearInterruptedWorkingCopyMutations', () => {
    try {
      clearInterruptedWorkingCopyMutations(getJournalPath());
      interruptedMutations = [];
      interruptedMutationRecoveryPlans = [];
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

/** Test seam: reset module-level state between unit tests. */
export function resetAppLifecycleForTests(): void {
  powerMonitorHandlersRegistered = false;
  resumeProbePromise = null;
  startupChecksStarted = false;
  lifecycleIpcRegistered = false;
  detectedStaleLocks = [];
  interruptedMutations = [];
  interruptedMutationRecoveryPlans = [];
}
