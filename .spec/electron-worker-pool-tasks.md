# Electron Worker Pool Tasks

Generated: 2026-05-06

This task plan tracks the Option A implementation: move expensive SVN and filesystem work out of the Electron main process into an internal worker pool while keeping renderer IPC APIs stable.

## Goals

- Keep the renderer-facing API unchanged for the first phase.
- Keep Electron main responsive by making it a coordinator instead of the place where expensive SVN/status/diff work executes.
- Add bounded concurrency, priorities, cancellation, and progress forwarding.
- Preserve existing result shapes and current safe fallback behavior.

## Non-Goals For First Phase

- Do not replace Electron IPC with WebSocket or HTTP yet.
- Do not move mutating SVN operations until read-only worker paths are stable.
- Do not change renderer query keys or preload API signatures unless required for cancellation/progress.

## Phase 1: Worker Foundation

- [x] Add `src/main/workers/types.ts` for typed worker job names, payloads, results, progress events, and normalized errors.
- [x] Add `src/main/workers/WorkerPool.ts` with bounded concurrency.
- [x] Support job IDs, priority, timeout, cancellation, and structured result/error propagation.
- [x] Add worker lifecycle handling for crashes, unexpected exits, and graceful app shutdown.
- [x] Default global worker count to a conservative CPU-aware value, such as `Math.max(2, Math.min(os.cpus().length - 1, 4))`.
- [x] Add separate scheduling priority for interactive work versus background scans.

## Phase 2: Worker-Safe SVN Runner

- [x] Split pure process spawning from `src/main/services/svn-executor.ts` into a worker-safe runner module.
- [x] Keep Electron-bound settings/auth lookup in the main process.
- [x] Pass resolved SVN execution context to workers as serializable data.
- [x] Preserve redaction, SSL trust behavior, proxy config handling, custom SVN binary support, stdout/stderr caps, and timeout behavior.
- [x] Ensure workers do not import Electron APIs, settings manager singletons, IPC handlers, dialogs, or BrowserWindow objects.

## Phase 3: First Migration - Deep Status

- [x] Move `fs:getDeepStatus` execution from `src/main/ipc/fs.ts` into the worker pool.
- [x] Preserve current stale-scan cancellation semantics.
- [x] Preserve `MAX_BACKGROUND_STATUS_SCAN_CONCURRENCY` behavior or replace it with an equivalent worker-pool class limit.
- [x] Resolve cancelled queued/running scans to the existing empty status result where the current code expects safe fallback behavior.
- [x] Add tests for queued scan cancellation, running scan cancellation, and concurrency limits.

## Phase 4: Shallow Status And Directory Metadata

- [x] Move `fs:getStatus` shallow status execution into the worker pool.
- [x] Move the status portion of `fs:getDirectoryMetadata` into the worker pool while keeping fast parent-path and filesystem metadata work in main.
- [x] Move `svn:status` and `svn:statusRemote` to the worker pool.
- [x] Keep immediate directory listing filesystem-only and fast.
- [x] Verify file navigation remains responsive while deep scans are running.

## Phase 5: Diff And History

- [x] Move `svn:diff` to the worker pool.
- [x] Move `svn:diffStreaming` to the worker pool.
- [x] Move `svn:diffUrls` to the worker pool.
- [x] Move `svn:log` to the worker pool.
- [x] Consider moving `svn:blame` after log/diff are stable.
- [x] Prioritize selected-file diff jobs above background scans.

## Phase 6: Progress And Cancellation

- [x] Forward worker progress events through main to existing renderer event channels.
- [x] Keep `svn:operation:progress`, `svn:update:progress`, and related event payloads centralized in main.
- [x] Add cancellation support for worker-backed status/diff/log jobs where the renderer can abandon stale work.
- [x] Ensure aborted SVN child processes are killed and temporary config directories are cleaned.

## Phase 7: Optional Mutating Operations

- [x] Evaluate moving `commitWithProgress`, `updateWithProgress`, checkout, export/import, and merge after read-only worker paths are stable.
- [x] Preserve hook execution order for update/commit-style operations.
- [x] Keep mutation concurrency more restrictive than read-only concurrency to avoid working-copy lock conflicts.
- [x] Add per-working-copy serialization for mutating jobs if needed.

Evaluation result: keep mutating operations in main until the read-only worker paths have shipped and been measured in-app. `commitWithProgress` still owns start/pre/post hook ordering, commit message sanitization, and post-commit async hooks; `updateWithProgress` and checkout own dedicated cancellation maps and renderer progress channels. If these move later, route worker progress through `forwardWorkerProgressToRenderer`, keep hook execution in main around the worker job, and serialize mutating jobs per working-copy root.

Mutation serialization notes: direct main-process mutations now use a per-working-copy queue for commit, update, update-to-revision, revert, add, remove, cleanup, and move/rename paths. Progress operations stay in their existing active-operation/cancellation paths until they are explicitly migrated, so queued progress jobs do not lose cancelability.

## Tests

- [x] Add unit tests for worker pool scheduling, priorities, concurrency, cancellation, timeout, and crash recovery.
- [x] Extend `src/main/ipc/__tests__/background-status-scan.test.ts`.
- [x] Extend `src/main/ipc/__tests__/fs.test.ts`.
- [x] Extend `src/main/services/__tests__/svn-executor.test.ts` or add equivalent runner tests.
- [x] Add tests proving worker errors are redacted and normalized.
- [x] Add tests proving IPC result shapes remain unchanged.

## Verification

- [x] Run `bun run typecheck`.
- [x] Run targeted worker/status tests.
- [x] Run `bun run test:unit` if targeted tests pass.
- [x] Measure file navigation responsiveness while a deep scan is active.
- [x] Measure commit modal visibility when status is slow.
- [x] Confirm renderer still shows in-modal loading states instead of blocking modal visibility.

Measurement notes: `background-status-scan.test.ts` holds two deep scans open and verifies a navigation-triggered deep scan queues in under 50ms without waiting for active scans to finish. `useCommitDialogController.test.tsx` holds `svn.status` open and verifies the commit dialog shell renders in under 100ms with the in-modal loading state visible.

## Rollout Order

1. Build the worker pool and worker-safe SVN runner.
2. Migrate only `fs:getDeepStatus`.
3. Verify cancellation, concurrency, and UI responsiveness.
4. Migrate `fs:getStatus`, directory metadata status, and `svn:status`.
5. Migrate diff and log operations.
6. Re-measure modal opening and file navigation.
7. Decide whether mutating operations should move.
