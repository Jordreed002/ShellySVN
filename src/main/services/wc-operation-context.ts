/**
 * Per-working-copy proxy/credential routing (#90 completion, Track A item 11).
 *
 * Resolves the renderer-persisted working-copy overrides
 * (`shellysvn:wc-overrides:v1`) and connection profiles
 * (`shellysvn:connection-profiles:v1`) into a Partial<SvnExecutionContext>
 * for a concrete SVN invocation. The executor (`svn-executor.ts`) calls
 * `resolveWcContextForOperation` centrally, so every `runSvn`/`runSvnMuccText`
 * call — and therefore every IPC operation that funnels through them — picks
 * up per-WC routing without per-call-site wiring.
 *
 * Precedence (mirrored from `@shared/wc-connection-settings`, the single
 * source of truth shared with the settings UI):
 *   explicit per-call operationContext → WC override → override's linked
 *   profile → URL-pattern-matched profile → global settings.
 *
 * The main process only READS these stores; writes stay with the settings UI.
 * Failures degrade to "no override" — routing must never fail an operation.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { ConnectionProfile } from '@shared/types';
import {
  CONNECTION_PROFILES_STORE_KEY,
  WORKING_COPY_OVERRIDES_STORE_KEY,
  parseConnectionProfiles,
  parseWorkingCopyOverrides,
  resolveWcOperationContext,
  type ResolvedWcOperationContext,
  type WorkingCopyOverrideMap,
} from '@shared/wc-connection-settings';

import { getStore } from '../ipc/store';
import { debug } from '../utils/debug';

/** Repository URL schemes that can carry connection settings (mirrors svn-executor's gate). */
const REPOSITORY_URL_PATTERN = /^(?:https?|svn(?:\+ssh)?):\/\//i;

/**
 * The working-copy root owning the `.svn` admin area above `candidate`, or
 * undefined when no admin area exists above it (e.g. a checkout destination
 * that does not exist yet). Bounded like `resolveShelfStoreRoot`
 * (svn-portable-shelves.ts) so a pathological `..` loop cannot spin.
 */
export function resolveWorkingCopyRoot(candidate: string): string | undefined {
  const resolved = resolve(candidate);
  let current = resolved;
  for (let hops = 0; hops < 64; hops += 1) {
    if (probeSvnAdminArea(join(current, '.svn'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

// Test seam for suites that cannot mock `node:fs` wholesale (jsdom-based
// executor tests): swap the `.svn` admin-area probe.
let probeSvnAdminArea: (path: string) => boolean = existsSync;

export function setSvnAdminAreaProbeForTests(probe: (path: string) => boolean): void {
  probeSvnAdminArea = probe;
}

/**
 * URL → working-copy lookup for repository-URL operations (repo browser):
 * when the operation was launched in the context of a monitored working copy
 * whose repository URL is an ancestor of the target URL, that working copy's
 * override applies. Registered by `ipc/monitor.ts` at startup to keep the
 * dependency direction one-way (services never import the monitor).
 */
export type WorkingCopyUrlLookup = () => Array<{ path: string; url?: string }>;

let workingCopyUrlLookup: WorkingCopyUrlLookup = () => [];

export function setWorkingCopyUrlLookup(lookup: WorkingCopyUrlLookup): void {
  workingCopyUrlLookup = lookup;
}

/** Case-insensitive, trailing-slash-insensitive repository-URL ancestor test. */
function isRepoUrlAncestor(ancestor: string, url: string): boolean {
  const base = ancestor.replace(/\/+$/, '').toLowerCase();
  const target = url.toLowerCase();
  return target === base || target.startsWith(`${base}/`);
}

function findWorkingCopyPathForUrl(url: string): string | undefined {
  let best: { path: string; url: string } | undefined;
  for (const info of workingCopyUrlLookup()) {
    if (!info?.path || !info.url) continue;
    if (isRepoUrlAncestor(info.url, url) && (!best || info.url.length > best.url.length)) {
      best = { path: info.path, url: info.url };
    }
  }
  return best?.path;
}

// Parsed-store caches keyed by the RAW payload reference: SimpleStore keeps
// `data[key]` referentially stable between `set` calls, so the (bounded) parse
// only reruns when the renderer actually persisted a change. Keeps the hot
// runSvn path allocation-free in the common nothing-configured case.
let overridesCache: { raw: unknown; parsed: WorkingCopyOverrideMap } | null = null;
let profilesCache: { raw: unknown; parsed: ConnectionProfile[] } | null = null;

async function loadOverrides(): Promise<WorkingCopyOverrideMap> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(WORKING_COPY_OVERRIDES_STORE_KEY);
    if (overridesCache && overridesCache.raw === raw) return overridesCache.parsed;
    const parsed = parseWorkingCopyOverrides(raw);
    overridesCache = { raw, parsed };
    return parsed;
  } catch (error) {
    debug.warn('[SVN] Failed to load working-copy overrides; using global settings:', error);
    return {};
  }
}

async function loadProfiles(): Promise<ConnectionProfile[]> {
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(CONNECTION_PROFILES_STORE_KEY);
    if (profilesCache && profilesCache.raw === raw) return profilesCache.parsed;
    const parsed = parseConnectionProfiles(raw);
    profilesCache = { raw, parsed };
    return parsed;
  } catch (error) {
    debug.warn('[SVN] Failed to load connection profiles; using global settings:', error);
    return [];
  }
}

/** Test seam: drop the parsed-store caches, the URL lookup, and the admin-area probe. */
export function resetWcOperationContextForTests(): void {
  overridesCache = null;
  profilesCache = null;
  workingCopyUrlLookup = () => [];
  probeSvnAdminArea = existsSync;
}

const NO_CONTEXT: ResolvedWcOperationContext = { context: {}, source: 'none' };

/**
 * Effective per-operation connection context for one SVN invocation.
 *
 * @param args    the svn argv (repository URL arguments drive profile matching)
 * @param cwd     the command's working directory — any path inside a working
 *                copy resolves to that copy's root and its override
 */
export async function resolveWcContextForOperation(
  args: string[],
  cwd?: string
): Promise<ResolvedWcOperationContext> {
  const [overrides, profiles] = await Promise.all([loadOverrides(), loadProfiles()]);
  const hasOverrides = Object.keys(overrides).length > 0;
  if (!hasOverrides && profiles.length === 0) return NO_CONTEXT;

  const repoUrl = args.find((arg) => REPOSITORY_URL_PATTERN.test(arg));

  // Candidate working copies, most specific first: the local path the command
  // runs in, then any monitored working copy the target URL belongs to.
  const candidates: string[] = [];
  if (hasOverrides && cwd) {
    const root = resolveWorkingCopyRoot(cwd);
    if (root) candidates.push(root);
  }
  if (hasOverrides && repoUrl) {
    const wcPath = findWorkingCopyPathForUrl(repoUrl);
    if (wcPath) candidates.push(wcPath);
  }

  for (const candidate of candidates) {
    const resolved = resolveWcOperationContext({ overrides, profiles, workingCopyPath: candidate, repoUrl });
    if (resolved.source !== 'none') return resolved;
  }
  if (repoUrl) {
    return resolveWcOperationContext({ overrides, profiles, repoUrl });
  }
  return NO_CONTEXT;
}
