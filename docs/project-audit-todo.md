# Project audit TODO

Source: independent review of the GLM 5.2 full-project audit against the current working tree.

This list uses corrected severity:

- The `IncrementalStatusWidget` loop is latent because the component is not currently mounted.
- The enhanced repository-browser working-copy integration and the simpler `FileExplorer` repository browser are separate implementations.
- Deep-link generation breaks parameter values, but only repository-URL links necessarily parse as `null`.
- The current IPC verifier reports 86 invoke channels and 4 event channels.

## P0 — stop live breakage and restore the quality gate

- [x] **AUDIT-001: Stop the LogViewer refetch loop.**
  - Keep `refreshLog` stable when cached data is updated.
  - Avoid using `cachedLog` as a callback dependency solely for fallback reads; use a ref or separate fallback path.
  - Keep request options referentially stable.
  - Add a test that opens the viewer, resolves a successful log request, and proves no second request occurs until the user refreshes or request inputs change.
  - Files: `src/renderer/src/hooks/useLogCache.ts`, `src/renderer/src/components/ui/LogViewer.tsx`.

- [x] **AUDIT-002: Enable a real TypeScript gate.**
  - Replace the vacuous root `tsc --noEmit` command with build-mode or explicit node/web project checks.
  - Decide whether unit tests belong in application tsconfigs or separate test tsconfigs.
  - Fix project references, module resolution, missing build-tool types, and the existing application errors.
  - Make CI fail on a newly introduced TypeScript error.
  - Current baseline: web 208 errors, node 111 errors, `tsc -b --noEmit` 319 errors.
  - Files: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `.github/workflows/ci.yml`.

- [x] **AUDIT-003: Fix incremental-status query-cache corruption.**
  - Never store `SvnStatusResult` or `SvnStatusEntry[]` under keys whose consumers expect `FsStatusResult`.
  - Either translate the scan result to `{ directStatus, allEntries }` or use dedicated incremental-status query keys.
  - Add cache-consumer tests covering the stale-time window after a scan completes.
  - File: `src/renderer/src/hooks/useIncrementalStatus.ts`.

- [x] **AUDIT-004: Fix generated deep links.**
  - Pass raw values to `URLSearchParams`; do not call `encodeURIComponent` first.
  - Test checkout/export repository URLs and local paths containing spaces, Unicode, `@`, `&`, and `%`.
  - Assert round trips through both `generateDeepLink` and `parseDeepLink`.
  - File: `src/main/services/protocol-handler.ts`.

## P0 — security and process stability

- [x] **AUDIT-005: Close webhook SSRF redirect and DNS-rebinding gaps.**
  - Disable automatic redirect following.
  - If redirects are supported, validate every hop and cap the redirect count.
  - Ensure the address validated is the address used for the connection, including IPv4 and IPv6 results.
  - Add tests for public-to-private redirects, DNS changes, link-local metadata addresses, mixed DNS results, and IPv4-mapped IPv6.
  - File: `src/main/ipc/webhook.ts`.

- [x] **AUDIT-006: Redesign renderer path approval.**
  - Stop implicitly approving the entire home directory if path approval is intended as a renderer-compromise boundary.
  - Approve explicit native-dialog selections, working-copy roots, and narrowly required application directories.
  - Define persistence, revocation, symlink, case-sensitivity, and moved-directory behavior.
  - Make error messages describe the actual policy.
  - File: `src/main/utils/approved-paths.ts`.

- [x] **AUDIT-007: Harden hook execution.**
  - Require hooks to come from an explicit trusted executable selection or another documented trust mechanism.
  - Verify the target is executable and reject untrusted or invalid paths.
  - Add configurable timeouts with graceful termination followed by forced termination.
  - Bound captured output and handle process-tree cleanup.
  - Preserve array-based argument passing and no-shell execution.
  - Files: `src/main/hooks/HookExecutor.ts`, hook settings UI.

- [x] **AUDIT-008: Harden custom SVN client selection and validation.**
  - Tie custom clients to an explicit trusted native file selection.
  - Validate once when the setting changes instead of executing the binary on every read.
  - Cache the validated result and invalidate it when the setting or file identity changes.
  - Check executable permissions where supported and retain the validation timeout.
  - File: `src/main/settings-manager.ts`.

- [x] **AUDIT-009: Make the local status server resilient.**
  - Add per-socket `error` handlers.
  - Keep an appropriate server-level runtime `error` handler after startup.
  - Reset or discard the singleton after a failed `start()`.
  - Add tests for `ECONNRESET`, write-after-close, failed listen, and successful retry.
  - File: `src/main/services/local-status-server.ts`.

- [x] **AUDIT-010: Give filesystem watchers explicit ownership and cleanup.**
  - Associate each watcher/subscription with its renderer or window.
  - Guard sends with `event.sender.isDestroyed()`.
  - Close subscriptions when their renderer is destroyed and close all watchers during shutdown.
  - Define behavior when multiple renderers watch the same path.
  - File: `src/main/ipc/fs.ts`.

- [x] **AUDIT-011: Guard every main-to-renderer event send.**
  - Audit progress, checkout, update, deep-status, deep-link, watcher, and hook notifications.
  - Skip or cancel delivery when the target renderer is destroyed.
  - Add close-window-during-operation tests.
  - Files: `src/main/services/svn-progress.ts`, `src/main/services/svn-checkout.ts`, `src/main/services/svn-working-copy.ts`, `src/main/ipc/fs.ts`, `src/main/index.ts`, `src/main/hooks/HookExecutor.ts`.

- [x] **AUDIT-012: Make active worker cancellation terminate reliably.**
  - Add a cancellation grace period.
  - Terminate and replace a worker that does not acknowledge cancellation.
  - Reject the active job and all joined subscribers deterministically.
  - Give read jobs finite timeouts appropriate to their operation.
  - File: `src/main/workers/WorkerPool.ts`.

## P1 — broken working-copy and repository workflows

- [x] **AUDIT-013: Repair WelcomeScreen folder drag-and-drop.**
  - Expose Electron `webUtils.getPathForFile` through a narrow preload API.
  - Resolve the dropped `File` to an absolute native path.
  - Validate `svn.info` before adding the repository or navigating.
  - Show a visible error instead of logging only to the console.
  - Files: `src/renderer/src/components/WelcomeScreen.tsx`, preload API and IPC contract.

- [x] **AUDIT-014: Do not auto-select conflicted commit entries.**
  - Keep conflicts visible but unchecked and non-committable until resolved.
  - Cover text, property, and tree conflicts.
  - Add a controller test for initial selection.
  - File: `src/renderer/src/components/commit/useCommitDialogController.ts`.

- [x] **AUDIT-015: Preserve manual CommitDialog selection.**
  - Reconcile refreshed status entries with existing checkbox choices instead of rebuilding all selection state.
  - Define behavior for new, removed, reverted, conflicted, and status-changed files.
  - File: `src/renderer/src/components/commit/useCommitDialogController.ts`.

- [x] **AUDIT-016: Make CommitDialog submission re-entry-safe and closable after success.**
  - Add a synchronous/in-flight guard inside the submit handler.
  - Clear or decouple `isSubmitting` when the operation succeeds.
  - Ensure close button, Escape, and intended success-screen actions work.
  - Handle thrown `onSubmit` errors and restore interactive state.
  - Files: `src/renderer/src/components/commit/useCommitDialogController.ts`, `src/renderer/src/components/ui/CommitDialog.tsx`.

- [x] **AUDIT-017: Restore all supported SVN context-menu actions.**
  - Forward Properties, Resolve, Add to Ignore, and Check for Modifications through `buildSvnContextMenuItems`.
  - Implement or remove the Check for Modifications placeholder.
  - Test visibility by SVN status and directory/file kind.
  - Files: `src/renderer/src/components/ui/FileRow.tsx`, `src/renderer/src/components/ui/ContextMenu.tsx`, `src/renderer/src/components/FileExplorer.tsx`.

- [x] **AUDIT-018: Make right-click establish the operation target.**
  - Select the right-clicked entry before opening its menu, using native multi-selection semantics.
  - Ensure Update, Commit, Revert, Add, and Delete cannot act on a stale selection.
  - Prefer passing the explicit entry/paths into action handlers instead of reading ambient selection state.
  - Cover list and Miller views.
  - Files: `src/renderer/src/components/ui/FileRow.tsx`, `src/renderer/src/components/files/MillerColumns.tsx`, `src/renderer/src/components/FileExplorer.tsx`.

- [x] **AUDIT-019: Provide real SVN status to Miller columns.**
  - Merge directory listings with status data rather than assigning every entry `' '`.
  - Keep status-dependent menus, badges, toolbar state, and selection behavior consistent with list view.
  - File: `src/renderer/src/components/files/MillerColumns.tsx`.

- [x] **AUDIT-020: Consolidate the two repository-browser implementations.**
  - Choose the simple `ui/RepoBrowser` or the enhanced route implementation as canonical.
  - Remove, migrate, or clearly scope the duplicate implementation.
  - Pass working-copy context explicitly when launched from a working copy.
  - Verify Add to Working Copy, WC badges, authentication, navigation history, and cache behavior.
  - Files: `src/renderer/src/components/ui/RepoBrowser.tsx`, `src/renderer/src/routes/repo-browser/-RepoBrowserContent.tsx`, `src/renderer/src/routes/repo-browser/index.tsx`, `src/renderer/src/components/FileExplorer.tsx`.

- [x] **AUDIT-021: Authenticate remote repository copies.**
  - Extend the copy IPC contract to accept credentials or resolve them securely in main.
  - Apply the same authentication and SSL-trust behavior as remote create, delete, and move.
  - Never expose passwords in logs or errors.
  - Files: repository-browser UI, preload contract, `src/main/ipc/svn.ts`, `src/main/services/svn-repository-ops.ts`.

- [x] **AUDIT-022: Preserve RepoBrowser navigation when changing revision.**
  - Separate “connect to a new repository” from “refresh current path at a revision.”
  - Pressing Enter in the revision field must not reset current path or back/forward history.
  - File: `src/renderer/src/routes/repo-browser/-RepoBrowserContent.tsx`.

- [x] **AUDIT-023: Show BranchSwitcher failures.**
  - Handle rejected promises and `{ success: false }`.
  - Keep the user on the current branch and show an actionable error.
  - Add a guard against concurrent switches.
  - File: `src/renderer/src/features/branches/BranchSwitcher.tsx`.

- [x] **AUDIT-024: Remove the MergeWizard cancellation race.**
  - Keep the merge locked until the original operation promise settles.
  - Track cancellation separately from operation completion.
  - Prevent a second merge regardless of render timing or double-clicks.
  - File: `src/renderer/src/components/ui/MergeWizard.tsx`.

- [x] **AUDIT-025: Handle SVN move/copy failures during drag-and-drop.**
  - Inspect returned `success` values for copy and move.
  - Surface the operation error and stop reporting the drop as successful.
  - Confirm whether repository copy or local working-copy copy is intended; use the matching API.
  - File: `src/renderer/src/hooks/useDragDrop.tsx`.

## P1 — SVN target and monitor correctness

- [x] **AUDIT-026: Apply peg-revision escaping consistently.**
  - Route every local-path SVN target through the shared target helpers.
  - Cover info, working-copy context, child commits, cleanup preview, locks, diagnostics, export, import, and switch.
  - Insert the option terminator where supported.
  - Add real tests with names such as `icon@2x.png`, `name@`, `@123`, spaces, Unicode, and option-like paths.
  - Files: `src/main/utils/svn-targets.ts` and affected SVN services.

- [x] **AUDIT-027: Make monitor add accurately report failure.**
  - Return failure when SVN info cannot identify a working copy.
  - Include an error suitable for UI display.
  - Assert the path-approval policy before all monitor SVN operations.
  - Use shared target escaping.
  - File: `src/main/ipc/monitor.ts`.

- [x] **AUDIT-028: Align monitor IPC return types and handlers.**
  - Make `startMonitoring` and `stopMonitoring` return the contracted operation result, or change the contract to `void`.
  - Add an IPC contract test for return shapes.
  - Files: shared IPC contract, preload API, `src/main/ipc/monitor.ts`.

- [x] **AUDIT-029: Respect cached SSL trust in diagnostics.**
  - Apply the same SSL trust and credential resolution used by normal repository reads.
  - Distinguish untrusted, previously trusted, expired, and changed certificates.
  - File: `src/main/services/svn-diagnostics.ts`.

## P2 — state, error handling, and performance

- [x] **AUDIT-030: Make webhook delivery state updates concurrency-safe.**
  - Use functional state updates or a reducer.
  - Give delivery IDs collision-resistant uniqueness.
  - Persist the final merged delivery state without stale snapshots.
  - File: `src/renderer/src/hooks/useWebhooks.ts`.

- [x] **AUDIT-031: Cache inherited issue-tracker property lookups.**
  - Do not rerun the parent walk unless working-copy root or effective lookup path changes.
  - Cache positive and negative results by working copy and path.
  - Invalidate after relevant property mutations.
  - Avoid changing lookup scope merely because the first checked commit file changes.
  - Files: `src/renderer/src/hooks/useIssueTrackerConfig.ts`, `src/renderer/src/components/commit/useCommitDialogController.ts`.

- [x] **AUDIT-032: Stabilize the latent IncrementalStatusWidget.**
  - Store `onUpdate` in a ref or pass a memoized callback so `startScan` stays stable.
  - Ensure `autoStart` starts once per path and does not resubscribe watchers on every render.
  - Add a mounted-widget regression test before using the component in production.
  - Files: `src/renderer/src/components/ui/IncrementalStatusProgress.tsx`, `src/renderer/src/hooks/useIncrementalStatus.ts`.

- [x] **AUDIT-033: Fix credential realm consistency and stale auth fields.**
  - Use the same canonical realm key for save and lookup.
  - Clear username/password state when closing, changing repositories, or changing realms.
  - Distinguish cancelled authentication from an authenticated empty directory.
  - Apply consistent retry parsing in checkout and add-repository flows.
  - Files: `CheckoutDialog.tsx`, `AddRepoModal.tsx`, `-RepoBrowserContent.tsx`, auth helpers.

- [x] **AUDIT-034: Make settings failures preserve truthful UI state.**
  - Do not replace credential lists with `[]` after remove, clear, or save IPC failures.
  - Retain the previous state and show an error.
  - Display the actual client certificate configuration.
  - Validate and clamp numeric settings before saving them.
  - File: `src/renderer/src/components/settings/SettingsPanels.tsx`.

- [x] **AUDIT-035: Repair the offline log-cache key contract.**
  - Use the same key for log writes and reads, including limit/revision/options.
  - Add migration or fallback behavior for existing cache entries if needed.
  - Add cache hit/miss and option-isolation tests.
  - File: `src/renderer/src/hooks/useOfflineCache.ts`.

- [x] **AUDIT-036: Remove side effects from state updater functions.**
  - Move delayed `scrollIntoView` work to an effect keyed by the selected match.
  - Verify behavior under React StrictMode.
  - File: `src/renderer/src/components/ui/EnhancedDiffViewer.tsx`.

## P3 — commands and polish

- [x] **AUDIT-037: Wire Command Palette “Open Settings” to real settings state.**
- [x] **AUDIT-038: Make Sidebar context menus keyboard accessible and close them after actions.**
- [x] **AUDIT-039: Make RevisionGraph “View Log” produce visible UI or remove the command.**
- [x] **AUDIT-040: Decide and document CommitDialog backdrop-click behavior; configure the focus trap accordingly.**
- [x] **AUDIT-041: Reflect actual maximize state in the Layout window control.**
- [x] **AUDIT-042: Replace unstable index keys in dynamic settings/external lists.**
- [x] **AUDIT-043: Preserve zero-byte file sizes as `0 B` in every file-size formatter.**
- [x] **AUDIT-044: Prevent LogViewer Escape from closing while relevant filter controls are active if that is the intended keyboard contract.**
- [x] **AUDIT-045: Remove or remap the ThreeWayMergeEditor shortcut that conflicts with Electron’s new-window shortcut.**
- [x] **AUDIT-046: Differentiate Factory Reset from Reset to Defaults, or remove one action.**

## Verification and cleanup

- [x] **AUDIT-047: Add effect-stability regression coverage.**
  - Count IPC calls after successful async state changes.
  - Exercise React StrictMode.
  - Cover modal open/close, cache writes, callbacks supplied as props, and automatic scans.

- [x] **AUDIT-048: Reconcile the IPC inventory documentation.**
  - Treat the verifier output as authoritative.
  - Update audit/documentation counts when channels change.
  - Current verifier result: 86 invoke channels and 4 event channels.

- [x] **AUDIT-049: Inventory and remove truly orphaned handlers and dead code.**
  - Confirm whether cache-breakdown, clear-cache-types, overlay update, stale barrels, unused progress forwarders, and unused cancellation paths are intended future API.
  - Remove them or expose and test them intentionally.

- [x] **AUDIT-050: Re-audit after P0/P1 completion.**
  - Run real TypeScript checks, lint, unit tests, IPC verification, production build, and real SVN compatibility tests.
  - Recheck all renderer-to-main trust boundaries and process/window teardown paths.
  - Record the commit SHA and clean/dirty state so findings are reproducible.

## Final verification record

- Date: 2026-07-25
- Baseline commit: `016a6ac6dde3c54c8397bd3b3f42aa98b187cc92`
- Worktree: dirty; the audit fixes are intentionally uncommitted and coexist with prior local changes.
- TypeScript: `tsc -b --noEmit` passed.
- Lint: `oxlint .` passed with warnings and zero errors.
- Unit/real integration suite: 153 files, 1,633 tests passed.
- Production build: `electron-vite build` passed.
- IPC inventory: 86 invoke channels and 4 event channels verified.
- SVN workflow verifier: 21 workflow families passed against a temporary real repository.
