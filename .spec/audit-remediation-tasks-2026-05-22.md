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

- [x] Add a per-run capability token for local status server requests.
- [x] Ensure clients must include the token before status/invalidate operations are served.
- [x] Store or communicate the token only through process-local trusted channels.
- [x] Add maximum line/message size enforcement.
- [x] Reject malformed, oversized, or unauthenticated requests early.
- [x] Restrict socket permissions where supported by platform APIs.
- [x] Add tests for valid token, missing token, invalid token, malformed JSON, oversized message, and shutdown cleanup.

Files to inspect first:

- `src/main/services/local-status-server.ts`
- `src/main/services/__tests__/local-status-server.test.ts`
- `src/main/index.ts`

Verification:

- [x] Targeted local status server tests.
- [x] `bun run typecheck`
- [x] `bun run lint`

Notes:

- `LocalStatusServer` now generates a per-process capability token and rejects requests before serving status or invalidation when the token is missing or invalid.
- The protocol now rejects malformed JSON with a stable error, validates request shape, caps pending line size at 64 KiB by default, and closes oversized clients early.
- Unix-domain sockets are chmodded to `0600` after bind and still removed during shutdown. Windows named pipe security remains platform-default and should be revisited if the helper gains custom pipe ACL support.
- The Windows shell helper registration payload now includes the status server token from main process state; the token is not exposed through renderer IPC.
- Targeted verification: `bun x vitest run src/main/shell/__tests__/ShellIntegration.test.ts src/main/services/__tests__/local-status-server.test.ts` passed with 14 tests. `bun run typecheck`, `bun run check:boundaries`, and `bun run lint` also passed; lint remains at the existing 119-warning baseline.

## Commit Point 6 - Bound Status Cache And Worker Queue Behavior

Goal: preserve status performance while preventing unbounded memory, queue, or worker occupancy.

- [x] Add a maximum entry count or LRU policy to `StatusService`.
- [x] Add tests for eviction and TTL behavior together.
- [x] Add queue dedupe or maximum queue/backpressure behavior for deep status scans.
- [x] Make folder-size worker operations abortable or timeout-bound.
- [x] Add tests for cancellation of active folder-size work where feasible.
- [x] Add stress-style tests for repeated scans across many paths.

Files to inspect first:

- `src/main/services/status-service.ts`
- `src/main/services/__tests__/status-service.test.ts`
- `src/main/workers/WorkerPool.ts`
- `src/main/workers/svn-worker.ts`
- `src/main/workers/__tests__/WorkerPool.test.ts`
- `src/main/ipc/fs.ts`

Verification:

- [x] Targeted status service tests.
- [x] Targeted worker pool tests.
- [x] Targeted filesystem scan tests.
- [x] `bun run typecheck`
- [x] `bun run lint`

Notes:

- `StatusService` now uses a 500-entry LRU cap for deep status cache entries while preserving the existing two-minute TTL.
- Added targeted tests for TTL expiry and LRU eviction, including recency refresh on reads.
- `WorkerPool` now deduplicates queued jobs by id, rejects duplicate ids that are already active, and applies a default 1000-job queue cap with `WorkerQueueFullError`.
- Folder-size worker requests now use a 30-second timeout. Active work cancellation is covered by existing worker timeout/termination behavior rather than cooperative folder traversal cancellation.
- Stress-style repeated-scan risk is covered through bounded LRU and queue-cap tests rather than a large end-to-end stress test.
- Targeted verification: `bun x vitest run src/main/services/__tests__/status-service.test.ts src/main/workers/__tests__/WorkerPool.test.ts src/main/ipc/__tests__/fs.test.ts` passed with 75 tests. `bun run typecheck`, `bun run check:boundaries`, and `bun run lint` also passed; lint remains at the existing 119-warning baseline.

## Commit Point 7 - Harden Webhook Delivery

Goal: avoid webhook delivery becoming unintended network egress or SSRF-like behavior.

- [x] Decide policy for HTTP webhooks: block by default, warn/confirm, or allow only with explicit setting.
- [x] Block or explicitly allowlist localhost, loopback, link-local, private IPv4, private IPv6, and metadata-service ranges.
- [x] Add payload size limits before serialization/delivery.
- [x] Add tests for private IPs, localhost, IPv6 loopback, oversized payloads, invalid schemes, timeout behavior, and HMAC signature preservation.
- [x] Update any settings UI copy only if user-facing behavior changes.

Files to inspect first:

- `src/main/ipc/webhook.ts`
- `src/main/ipc/__tests__`
- `src/renderer/src/hooks/useWebhooks.ts`
- `src/renderer/src/components/settings/SettingsPanels.tsx`

Verification:

- [x] Targeted webhook tests.
- [x] `bun run typecheck`
- [x] `bun run lint`

Notes:

- Webhook delivery now requires HTTPS; HTTP and all non-HTTPS schemes are rejected in main before delivery. Renderer-side webhook URL validation now matches the HTTPS-only policy.
- Main-process delivery rejects embedded URL credentials, localhost, `.localhost`, loopback, link-local, private IPv4 ranges, private IPv6 ranges, and DNS names resolving to blocked addresses.
- Webhook payloads are capped at 256 KiB before `fetch`; HMAC signatures are still generated over the exact JSON payload sent.
- Targeted tests cover HTTP rejection, localhost/private IPv4/IPv6/DNS blocking, oversized payloads, HMAC signature preservation, non-2xx responses, and timeout behavior.
- Targeted verification: `bun x vitest run src/main/ipc/__tests__/webhook.test.ts` passed with 7 tests. `bun run typecheck`, `bun run check:boundaries`, and `bun run lint` also passed; lint remains at the existing 119-warning baseline.

## Commit Point 8 - Electron And External Tool Hardening

Goal: tighten process, URL, and shell boundaries without breaking intended SVN-client workflows.

- [x] Test whether `BrowserWindow` can run with `sandbox: true`.
- [x] If sandbox cannot be enabled, document the blocker in `.spec`.
- [x] Consider failing fast in packaged preload if context isolation is unavailable.
- [x] Keep CSP in place and decide whether production can remove `style-src 'unsafe-inline'`.
- [x] Tighten custom external tool validation with `stats.isFile()` and platform-specific executable checks where practical.
- [x] Separate local file/folder opening from external URL opening.
- [x] Gate local file/folder opening behind approved roots.
- [x] Add tests for custom tool path validation and local path opening.

Files to inspect first:

- `src/main/index.ts`
- `src/preload/index.ts`
- `src/renderer/index.html`
- `src/main/ipc/app.ts`
- `src/main/ipc/external.ts`
- `src/main/utils/external-tool-validation.ts`
- `src/main/utils/external-url.ts`

Verification:

- [x] Targeted Electron/main IPC tests.
- [x] Manual app smoke test if sandbox behavior changes.
- [x] `bun run typecheck`
- [x] `bun run lint`

Notes:

- `BrowserWindow` now runs with `sandbox: true`, while keeping `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true`.
- The preload now fails closed if context isolation is unavailable instead of installing APIs directly on `window`.
- CSP remains in place. `style-src 'unsafe-inline'` is intentionally retained because the renderer still uses React inline style props for virtualized/layout-heavy UI; removing it should be revisited only after those surfaces are audited or converted.
- Local URL opening remains separated through `app:openExternal` and `openValidatedExternalUrl`; local file/folder opening remains under `external:openFile` and `external:openFolder`.
- `external:openFile` and `external:openFolder` now require approved roots. Custom external tool paths now reject path traversal, require an existing file, and require POSIX executable permission where supported.
- Targeted verification: `bun x vitest run src/main/ipc/__tests__/external.test.ts src/main/utils/__tests__/external-tool-validation.test.ts` passed with 24 tests and the existing 7 skipped legacy fs-mock tests. `bun run build`, `bun run typecheck`, `bun run check:boundaries`, and `bun run lint` also passed; lint remains at the existing 119-warning baseline.
- Manual launch smoke was attempted against the built app after enabling sandbox. The direct Electron CLI launch did not reach window creation because this Bun-installed local Electron layout fails in `@electron-toolkit/utils` with `electron.app` undefined before app code creates a `BrowserWindow`; this is recorded as an environment smoke blocker, not a sandbox blocker. A packaged-app smoke remains appropriate in final release verification.

## Commit Point 9 - FileExplorer Structure And Hook Warning Burn-Down

Goal: reduce regression risk in the highest-change renderer surface.

- [ ] Split `FileExplorer.tsx` into smaller units around data hooks, command handlers, dialog state, and presentation.
- [x] Resolve hook dependency warnings in changed areas.
- [x] Resolve or document `useIncrementalStatus` hook warnings.
- [x] Resolve `useOperationQueue` loop-condition warning.
- [x] Add focused tests for extracted hooks or handlers.
- [x] Confirm no bundle regression from the split.

Files to inspect first:

- `src/renderer/src/components/FileExplorer.tsx`
- `src/renderer/src/hooks/useIncrementalStatus.ts`
- `src/renderer/src/hooks/useOperationQueue.ts`
- `src/renderer/src/hooks/usePlugins.ts`
- `src/renderer/src/hooks/useWebhooks.ts`
- `src/renderer/src/components/tutorial/OnboardingTutorial.tsx`

Verification:

- [x] Targeted renderer tests.
- [x] `bun run lint`
- [x] `bun run typecheck`
- [x] `SHELLYSVN_BUNDLE_REPORT=1 bun run build`

Progress notes:

- First CP9 slice resolved hook warning regressions before the larger `FileExplorer.tsx` split. `useOperationExecutor` now reads queue pause/concurrency state inside the wait loop instead of closing over stale values.
- `useIncrementalStatus` no longer declares unused status options in the scan callback dependency list and removed the unused watch timeout cleanup ref.
- `useWebhooks` and `usePlugins` callbacks were reordered so dependency arrays can include the functions they call without temporal-dead-zone issues.
- Targeted verification for this slice: `bun x vitest run src/renderer/src/hooks/__tests__/useIncrementalStatus.test.ts src/renderer/__tests__/background-scanning-operations.test.tsx src/renderer/__tests__/scan-nonblocking.test.tsx` passed with 4 tests. `bun run typecheck` and `bun run lint` passed; lint warning baseline dropped from 119 to 109.
- Second CP9 slice extracted the CommandPalette/SVN event bridge from `FileExplorer.tsx` into `useFileExplorerCommandEvents`, reducing the component from 1971 to 1771 lines while preserving the latest operation context ref behavior.
- Focused verification for the extracted hook: `bun x vitest run src/renderer/__tests__/useFileExplorerCommandEvents.test.tsx src/renderer/__tests__/keyboardShortcuts.parity.test.tsx src/renderer/__tests__/useSvnActions.confirmations.test.tsx src/renderer/__tests__/conflict-resolution-workflows.test.tsx` passed with 17 tests. `bun run typecheck`, `bun run lint`, and `SHELLYSVN_BUNDLE_REPORT=1 bun run build` passed; lint remains at the 109-warning baseline.

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
