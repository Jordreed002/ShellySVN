# Audit Remediation Task List - 2026-05-22

Source audit: `project-deep-dive-audit-2026-05-22.md`

This checklist is the execution plan for the performance, standards, and security findings from the deep dive audit. Work should be completed in small, reviewable batches. Tick items off as they are completed and commit after each commit point.

## Working Rules

- Keep existing user/unrelated changes intact.
- Prefer narrow changes with tests for every security or boundary fix.
- After each commit point, run the listed verification commands and record any intentional exceptions in this file.
- Do not mark an item complete until code, tests, and relevant documentation updates are done.
- If a task exposes a larger design issue, add a follow-up item here rather than expanding the active patch indefinitely.

## Commit Point 0 - Baseline And Planning

- [x] Confirm current dirty worktree and separate audit/planning files from active optimization code.
- [x] Decide whether to commit the existing status optimization changes before remediation begins.
- [x] Record the current failing `bun run check:boundaries` output in the commit or PR notes.
- [x] Commit this task list and the deep dive audit together, or explicitly keep them staged for the first remediation commit.

Verification:

- [x] `git status --short`
- [x] `bun run check:boundaries` expected to fail until Commit Point 1 is complete.

Notes:

- Baseline documentation was committed in `5479357`.
- Existing optimization patch verification before remediation: `bun run typecheck`, `bun run lint`, `bun run build`, and targeted status/worker/filesystem Vitest suite passed.
- Current boundary failure is limited to renderer tests importing main/preload modules:
  `lock-conflict-recovery.test.tsx`, `performance/log-history.perf.test.ts`,
  `performance/working-copy-status.perf.test.ts`, `text-conflict-detection.test.ts`,
  and `tree-conflict-detection.test.tsx`.

## Commit Point 1 - Restore Architecture Boundary Gate

Goal: make `bun run check:boundaries` pass without weakening production boundaries.

- [x] Fix renderer test imports that currently reach into main/preload modules.
- [x] Move shared test fixtures into allowed test utility locations if needed.
- [x] Replace direct main/preload test imports with renderer-side API mocks.
- [x] Keep `scripts/check-boundaries.mjs` strict for production code.
- [x] Add a short note here if a deliberate test-only exception is introduced.

Files to inspect first:

- `src/renderer/__tests__/lock-conflict-recovery.test.tsx`
- `src/renderer/__tests__/performance/log-history.perf.test.ts`
- `src/renderer/__tests__/performance/working-copy-status.perf.test.ts`
- `src/renderer/__tests__/text-conflict-detection.test.ts`
- `src/renderer/__tests__/tree-conflict-detection.test.tsx`
- `scripts/check-boundaries.mjs`

Verification:

- [x] `bun run check:boundaries`
- [x] Targeted tests for changed renderer tests.
- [x] `bun run typecheck`

Notes:

- No checker exception was introduced. SVN status/log XML parsers used by renderer tests now live in `packages/shared/src/svn-parsers.ts`, and `src/main/svn/parsers.ts` re-exports them for existing main callers.
- Targeted parser/boundary tests passed for the five previously violating renderer tests plus main SVN parser tests.
- `bun run lint` also passed with the existing warning baseline.

## Commit Point 2 - Remove Credential Leakage From Renderer Query Keys

Goal: ensure credentials never appear in React Query keys, devtools, logs, snapshots, or diagnostics.

- [x] Replace query keys that include `storedCreds` with non-secret key material.
- [x] Pass credentials only inside query functions.
- [x] Use a stable non-secret auth version/key if cache invalidation must depend on credential changes.
- [x] Add or update tests proving query keys do not contain username/password values.
- [x] Search for any other credential-bearing objects in renderer cache keys.

Files to inspect first:

- `src/renderer/src/components/FileExplorer.tsx`
- `src/renderer/src/hooks`
- `src/renderer/src/features`

Verification:

- [x] `rg -n "queryKey:.*storedCreds|password.*queryKey|username.*queryKey" src/renderer`
- [x] Targeted renderer tests.
- [x] `bun run typecheck`
- [x] `bun run lint`

Notes:

- SVN list query keys now use only URL plus `stored`/`anonymous` auth presence via `createSvnListQueryKey`.
- Credential values are still passed to SVN list calls only inside query functions.
- Added `authQueryKeys.test.ts` to prove usernames/passwords are not serialized into query keys.

## Commit Point 3 - Fix Auth Realm Matching

Goal: prevent credentials for one repository realm from matching sibling URL prefixes.

- [x] Replace raw `url.startsWith(realm)` matching with parsed URL origin and path-boundary matching.
- [x] Prefer the longest valid matching realm when multiple realms apply.
- [x] Preserve expected behavior for repository roots and nested paths.
- [x] Add tests for sibling prefixes such as `/repo` versus `/repo2`.
- [x] Add tests for trailing slash, encoded path, query/hash, origin mismatch, and case behavior.

Files to inspect first:

- `src/main/auth-cache.ts`
- `src/main/__tests__/auth-cache.test.ts`
- `src/main/services/svn-executor.ts`
- `src/main/services/svn-working-copy.ts`

Verification:

- [x] Targeted auth-cache tests.
- [x] Targeted SVN executor/working-copy credential tests if affected.
- [x] `bun run typecheck`

Notes:

- `AuthCache.findForUrl` now keeps exact lookup behavior, then uses parsed URL origin plus path-boundary ancestor matching for fallback realm lookup.
- Added tests for sibling path prefixes, trailing slash equivalence, query/hash ignoring, origin mismatch, path case sensitivity, and encoded path boundaries.
- Targeted SVN executor, working-copy, and diagnostics tests passed; `bun run lint` also passed with the existing warning baseline.

## Commit Point 4 - Scope Filesystem IPC Reads To Approved Roots

Goal: make read/probe/status filesystem IPC follow the same approved-root policy as write/watch/folder-size operations.

- [x] Audit every `fs:*` IPC handler and classify it as dialog approval, approved-root required, app-internal path only, or public-safe.
- [x] Add approved-root checks to directory listing, metadata, status, deep status, version checks, parent lookup, and existence checks unless a specific exception is documented.
- [x] Ensure path approval works correctly for selected roots, descendants, drive roots, UNC paths, and case-insensitive Windows paths.
- [x] Update renderer flows to approve paths before calling newly gated handlers.
- [x] Add tests proving unapproved arbitrary paths are rejected.
- [x] Add tests proving approved roots and descendants still work.

Files to inspect first:

- `src/main/ipc/fs.ts`
- `src/main/ipc/__tests__/fs.test.ts`
- `src/main/utils/approved-paths.ts`
- `src/preload/api/native.ts`
- `src/renderer/src/components/FileExplorer.tsx`

Verification:

- [x] Targeted filesystem IPC tests.
- [x] Targeted FileExplorer tests if renderer flow changes.
- [x] `bun run typecheck`
- [x] `bun run lint`

Notes:

- `fs:listDirectory`, `fs:getDirectoryMetadata`, `fs:getParent`, `fs:getStatus`, `fs:getDeepStatus`, `fs:isVersioned`, `fs:cancelScan`, and `fs:exists` now require an approved path, except the public-safe `DRIVES://` sentinel and drive listing.
- Dialog-selected paths remain the primary approval source. `app:getPath` now approves only the concrete platform paths returned by main for app-provided quick access entries.
- Parent lookup now returns a parent only when that parent is still inside an approved root, so selecting a repository does not expose traversal above it.
- The sidebar no longer auto-prunes recent repositories with `fs:exists`, because an unapproved persisted path and a missing path intentionally both fail the gated existence check.
- Persisted recent/bookmark entries from a previous process are not implicitly re-approved from renderer-controlled settings; users must open/select paths through an approved flow in the current process. A persistent main-owned approval store is a possible follow-up if cross-restart path grants are required.
- Targeted verification: `bun x vitest run src/main/ipc/__tests__/fs.test.ts src/main/ipc/__tests__/app.test.ts` passed with 99 tests.
- `bun run typecheck` and `bun run check:boundaries` passed.
- `bun run lint` passed with the existing 119-warning baseline.

## Commit Point 5 - Harden Local Status Server

Goal: keep local status sharing performant while preventing unauthenticated local process access.

- [ ] Add a per-run capability token for local status server requests.
- [ ] Ensure clients must include the token before status/invalidate operations are served.
- [ ] Store or communicate the token only through process-local trusted channels.
- [ ] Add maximum line/message size enforcement.
- [ ] Reject malformed, oversized, or unauthenticated requests early.
- [ ] Restrict socket permissions where supported by platform APIs.
- [ ] Add tests for valid token, missing token, invalid token, malformed JSON, oversized message, and shutdown cleanup.

Files to inspect first:

- `src/main/services/local-status-server.ts`
- `src/main/services/__tests__/local-status-server.test.ts`
- `src/main/index.ts`

Verification:

- [ ] Targeted local status server tests.
- [ ] `bun run typecheck`
- [ ] `bun run lint`

## Commit Point 6 - Bound Status Cache And Worker Queue Behavior

Goal: preserve status performance while preventing unbounded memory, queue, or worker occupancy.

- [ ] Add a maximum entry count or LRU policy to `StatusService`.
- [ ] Add tests for eviction and TTL behavior together.
- [ ] Add queue dedupe or maximum queue/backpressure behavior for deep status scans.
- [ ] Make folder-size worker operations abortable or timeout-bound.
- [ ] Add tests for cancellation of active folder-size work where feasible.
- [ ] Add stress-style tests for repeated scans across many paths.

Files to inspect first:

- `src/main/services/status-service.ts`
- `src/main/services/__tests__/status-service.test.ts`
- `src/main/workers/WorkerPool.ts`
- `src/main/workers/svn-worker.ts`
- `src/main/workers/__tests__/WorkerPool.test.ts`
- `src/main/ipc/fs.ts`

Verification:

- [ ] Targeted status service tests.
- [ ] Targeted worker pool tests.
- [ ] Targeted filesystem scan tests.
- [ ] `bun run typecheck`
- [ ] `bun run lint`

## Commit Point 7 - Harden Webhook Delivery

Goal: avoid webhook delivery becoming unintended network egress or SSRF-like behavior.

- [ ] Decide policy for HTTP webhooks: block by default, warn/confirm, or allow only with explicit setting.
- [ ] Block or explicitly allowlist localhost, loopback, link-local, private IPv4, private IPv6, and metadata-service ranges.
- [ ] Add payload size limits before serialization/delivery.
- [ ] Add tests for private IPs, localhost, IPv6 loopback, oversized payloads, invalid schemes, timeout behavior, and HMAC signature preservation.
- [ ] Update any settings UI copy only if user-facing behavior changes.

Files to inspect first:

- `src/main/ipc/webhook.ts`
- `src/main/ipc/__tests__`
- `src/renderer/src/hooks/useWebhooks.ts`
- `src/renderer/src/components/settings/SettingsPanels.tsx`

Verification:

- [ ] Targeted webhook tests.
- [ ] `bun run typecheck`
- [ ] `bun run lint`

## Commit Point 8 - Electron And External Tool Hardening

Goal: tighten process, URL, and shell boundaries without breaking intended SVN-client workflows.

- [ ] Test whether `BrowserWindow` can run with `sandbox: true`.
- [ ] If sandbox cannot be enabled, document the blocker in `.spec`.
- [ ] Consider failing fast in packaged preload if context isolation is unavailable.
- [ ] Keep CSP in place and decide whether production can remove `style-src 'unsafe-inline'`.
- [ ] Tighten custom external tool validation with `stats.isFile()` and platform-specific executable checks where practical.
- [ ] Separate local file/folder opening from external URL opening.
- [ ] Gate local file/folder opening behind approved roots.
- [ ] Add tests for custom tool path validation and local path opening.

Files to inspect first:

- `src/main/index.ts`
- `src/preload/index.ts`
- `src/renderer/index.html`
- `src/main/ipc/app.ts`
- `src/main/ipc/external.ts`
- `src/main/utils/external-tool-validation.ts`
- `src/main/utils/external-url.ts`

Verification:

- [ ] Targeted Electron/main IPC tests.
- [ ] Manual app smoke test if sandbox behavior changes.
- [ ] `bun run typecheck`
- [ ] `bun run lint`

## Commit Point 9 - FileExplorer Structure And Hook Warning Burn-Down

Goal: reduce regression risk in the highest-change renderer surface.

- [ ] Split `FileExplorer.tsx` into smaller units around data hooks, command handlers, dialog state, and presentation.
- [ ] Resolve hook dependency warnings in changed areas.
- [ ] Resolve or document `useIncrementalStatus` hook warnings.
- [ ] Resolve `useOperationQueue` loop-condition warning.
- [ ] Add focused tests for extracted hooks or handlers.
- [ ] Confirm no bundle regression from the split.

Files to inspect first:

- `src/renderer/src/components/FileExplorer.tsx`
- `src/renderer/src/hooks/useIncrementalStatus.ts`
- `src/renderer/src/hooks/useOperationQueue.ts`
- `src/renderer/src/hooks/usePlugins.ts`
- `src/renderer/src/hooks/useWebhooks.ts`
- `src/renderer/src/components/tutorial/OnboardingTutorial.tsx`

Verification:

- [ ] Targeted renderer tests.
- [ ] `bun run lint`
- [ ] `bun run typecheck`
- [ ] `SHELLYSVN_BUNDLE_REPORT=1 bun run build`

## Commit Point 10 - Automated Performance Gates

Goal: make the documented performance budgets enforceable rather than advisory.

- [ ] Add a script that reads the renderer bundle report JSON and fails when the initial raw/gzip budget is exceeded.
- [ ] Wire the bundle-budget check into `verify` or a dedicated release verification script.
- [ ] Add documentation for how to regenerate and inspect bundle reports.
- [ ] Decide which large-repository performance tests should run in normal CI versus release-only CI.
- [ ] Record any intentionally release-only performance gates in `.spec/performance-budgets.md`.

Files to inspect first:

- `scripts/analyze-bundle.mjs`
- `electron.vite.config.ts`
- `package.json`
- `.spec/performance-budgets.md`
- `tests/e2e/performance.spec.ts`
- `src/renderer/__tests__/performance`

Verification:

- [ ] Bundle budget script passes with current bundle.
- [ ] Script fails against an artificially lowered threshold.
- [ ] `bun run verify` or updated release verification command.

## Commit Point 11 - Final Verification And Release-State Update

Goal: finish with a coherent, auditable project state.

- [ ] Run full verification.
- [ ] Run bundle analysis.
- [ ] Run real SVN workflow verification if the environment supports it.
- [ ] Update `.spec/project-deep-dive-audit-2026-05-22.md` with a completion note or link to this checklist if useful.
- [ ] Update `.spec/production-release-blockers.md` only for gates genuinely closed.
- [ ] Ensure all completed items in this file are checked.
- [ ] Commit final documentation updates.

Verification:

- [ ] `bun run verify`
- [ ] `SHELLYSVN_BUNDLE_REPORT=1 bun run build`
- [ ] `bun run verify:svn-workflows` where supported.
- [ ] `git status --short`

## Deferred Or Conditional Items

- [ ] Investigate avoiding SVN command-line password exposure through SVN auth cache/config or safer credential handoff.
- [ ] Add per-window or per-`webContents` approved-path scoping if multi-window support becomes production-relevant.
- [ ] Add restrictive file-mode handling for persisted secret files on Linux packaging targets.
- [ ] Add render-count or interaction-budget tests for large FileExplorer workflows.
- [ ] Tighten production CSP further if styling pipeline permits removing inline styles.
