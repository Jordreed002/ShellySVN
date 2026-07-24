# SVN implementation correctness TODO

Audit scope: renderer actions, preload API, IPC handlers, SVN services, worker commands, progress/cancellation paths, parsing, cache invalidation, and real-repository coverage.

The preload/IPC channel inventory currently matches: every exposed `svn:*` call has a registered main-process handler. The items below are the places where behavior is incomplete, inconsistent, misleading, or lacks enough verification to call 100% correct.

## P0 — correctness and data-safety

- [x] **SVN-001: Make progress updates use the same workflow as normal updates.**
  - `updateWithProgress` currently bypasses working-copy validation, pre/post-update hooks, and `runSerializedWorkingCopyMutation`.
  - Refactor normal and progress updates around one shared operation implementation; only output transport should differ.
  - Verify hook failures block both variants, post-hooks receive the revision, and update/commit/move operations cannot mutate the same working copy concurrently.
  - Files: `src/main/services/svn-working-copy.ts`, `src/main/ipc/svn.ts`.

- [x] **SVN-002: Serialize progress commits with all other working-copy mutations.**
  - `commit` is serialized, but `commitWithProgress` is not.
  - Put both through the same mutation queue and shared commit implementation.
  - Add a concurrency test covering commit versus update, add, delete, move, and a second commit.
  - Files: `src/main/services/svn-commit.ts`, `src/main/services/svn-mutation-queue.ts`.

- [x] **SVN-003: Correct patch result parsing.**
  - `svn patch` reports per-path action columns (`U`, `A`, `D`, `C`, `G`); it does not emit `Patched N files` in the format currently parsed.
  - Count changed and rejected paths from actual SVN output and treat `C`/reject files as a non-clean result.
  - Return separate `appliedWithConflicts` information if partial application is a supported outcome.
  - Add real tests for clean apply, dry run, offset/fuzz, conflict, and `.svnpatch.rej` creation.
  - File: `src/main/services/svn-patch.ts`.

- [x] **SVN-004: Make lock listing report repository locks, not only local lock tokens.**
  - `listLocks` uses plain `svn status --xml`, so it cannot reliably discover locks held by other users.
  - Use `svn status --show-updates --xml` or repository `svn info --depth infinity --xml`, and parse `repos-status/lock` as well as `wc-status/lock`.
  - Label local-token and remote-owner state distinctly in the UI.
  - Add a two-working-copy real test where one client owns a lock and the other lists it.
  - Files: `src/main/services/svn-locks.ts`, lock-management UI and shared types.

- [x] **SVN-005: Parse and edit `svn:externals` structurally.**
  - Removal currently uses substring matching, so removing `lib` can also remove a definition containing `lib2` or a URL containing `lib`.
  - Formatting does not safely cover quoted/escaped paths, peg revisions, operative revisions, relative URLs, old/new syntax, or spaces.
  - Preserve comments and unrelated formatting when editing one definition.
  - Add round-trip tests for every SVN-supported external syntax and sibling names with common prefixes.
  - Files: `src/main/services/svn-metadata.ts`, `src/main/svn/parsers.ts`.

- [x] **SVN-006: Validate sparse checkout selections against the checkout URL.**
  - `toSparseRelativePath` falls back to arbitrary trimmed input when a URL/path is outside the checkout base, and its base-tail heuristic is ambiguous when repository segments repeat.
  - Reject external URLs, `..` traversal, absolute filesystem paths, and repository siblings.
  - Use URL-segment-aware relative resolution and return a structured validation error before creating the working copy.
  - Cover encoded names, Windows separators, `file://`, `svn://`, and `svn+ssh://` repositories.
  - File: `src/main/services/svn-checkout.ts`.

- [x] **SVN-007: Harden all multi-target commands against option-like paths and empty selections.**
  - Add shared validation for empty arrays and invalid/control-character targets.
  - Insert SVN's `--` end-of-options marker where the subcommand supports it, so relative names beginning with `-` cannot become options.
  - Cover add, delete, revert, unversion, commit, changelist, diff/patch creation, move/copy, props, and locks.
  - Add real tests using filenames such as `--force`, `-r`, spaces, Unicode, and `@` peg-revision characters.

## P1 — incomplete or inconsistent behavior

- [x] **SVN-008: Make asynchronous history error handling work as written.**
  - `getLog`, diff variants, and blame return worker promises without awaiting them, so asynchronous rejection bypasses the surrounding `try/catch` fallback.
  - Decide whether the API should reject or return structured errors, then apply that contract consistently.
  - Add worker-rejection and cancellation tests for log, diff, URL diff, streaming diff, and blame.
  - File: `src/main/services/svn-history.ts`.

- [x] **SVN-009: Remove silent “empty result means error” behavior.**
  - Changelist list, shelf list, externals list, lock info/list, status, log, and blame can turn authentication, network, parsing, or command failures into empty successful-looking data.
  - Return structured `{ data, error, unsupportedReason }` results and show the error/partial-state distinction in the renderer.
  - Do not cache failed remote reads as valid empty data.

- [x] **SVN-010: Complete changelist management.**
  - `changelistCreate` is a no-op and its name/comment parameters are ignored.
  - Remove and delete are exposed through preload/IPC but have no renderer call sites.
  - Either remove the fictional standalone create endpoint (SVN creates a changelist when a path is assigned) or redefine it honestly in the UI.
  - Add UI actions to remove selected files and remove all files from a changelist, with status-cache invalidation.
  - Files: `src/main/services/svn-metadata.ts`, `src/main/ipc/svn.ts`, `src/preload/api/svn.ts`, `ChangelistDialog.tsx`.

- [x] **SVN-011: Use progress-capable implementations in the UI where they exist.**
  - `commitWithProgress`, `exportWithProgress`, `importWithProgress`, and `diffStreaming` are exposed but not used by production renderer call sites.
  - Wire large/long-running workflows to progress and cancellation, or remove unused variants to prevent parity drift.
  - Ensure normal and progress results, credentials, SSL trust, hooks, validation, and errors are identical.

- [x] **SVN-012: Replace global single-operation cancellation state in preload.**
  - Preload tracks only one active checkout ID, update ID, and generic operation ID; concurrent operations overwrite the prior ID.
  - Return operation handles/IDs to callers or track IDs by caller/workflow.
  - Ensure closing one dialog removes only its listener and cancellation always targets the displayed operation.
  - File: `src/preload/api/svn.ts`.

- [x] **SVN-013: Standardize status-cache invalidation after mutations.**
  - Property, changelist, external, lock/unlock, resolve, switch, shelf, patch, and some remote mutations do not consistently invalidate affected paths at the IPC boundary.
  - Define affected local paths for every mutation and invalidate centrally after success.
  - For remote mutations, invalidate repository-list query keys and any corresponding working-copy remote status.
  - File: `src/main/ipc/svn.ts` and renderer query invalidations.

- [x] **SVN-014: Make copy destination probing distinguish “missing” from “unreachable.”**
  - Branch/tag validation treats every failed `svn list DESTINATION` as proof that the destination does not exist, including authentication, SSL, timeout, and repository errors.
  - Continue only for SVN not-found errors; propagate all other failures.
  - Use the same explicit credentials/trust context for the probe and copy.
  - File: `src/main/services/svn-repository-ops.ts`.

- [x] **SVN-015: Validate remote mutation relationships and targets.**
  - Remote move/copy currently validate URL shape but not repository compatibility, parent existence, source existence/kind, or moving a directory into itself.
  - Add explicit checks with actionable errors and preserve peg revisions where required.
  - Verify encoded URL segments and repository-root edge cases.

- [x] **SVN-016: Define correct recursive behavior for folder revert and add.**
  - `svn add DIR` is recursive by default, while `svn revert DIR` is depth-empty by default. The UI does not make this asymmetry clear.
  - Add a recursive choice/confirmation for directory revert and ensure the selected depth is passed explicitly.
  - Real-test folder properties, scheduled adds/deletes, modified descendants, and mixed selections.
  - Files: `src/main/services/svn-working-copy.ts`, revert UI.

- [x] **SVN-017: Make `updateItem` and sparse update use the complete update contract.**
  - `updateItem` has different validation, credential, hook, serialization, and error mapping behavior from normal update.
  - Sparse `updateToRevision` also has its own partial implementation.
  - Consolidate target/depth argument construction and mutation behavior without losing `--parents`/`--set-depth` semantics.
  - Files: `src/main/services/svn-working-copy.ts`.

- [x] **SVN-018: Strengthen working-copy URL/path derivation in the main process.**
  - `getWorkingCopyContext` constructs descendant URLs through string slicing and concatenation.
  - Make it separator-, case-, encoding-, and segment-aware; reject paths outside the discovered root.
  - Prefer deriving the target with `svn info --show-item url` or parsed URL segments instead of renderer-provided mappings.
  - Add Windows drive/UNC, symlink, Unicode, percent-encoded, and switched-subtree tests.
  - File: `src/main/services/svn-working-copy.ts`.

- [x] **SVN-019: Handle switched subtrees and externals when mapping repository items locally.**
  - A single working-copy-root URL is insufficient for switched children and nested externals.
  - Resolve the nearest versioned ancestor and its actual URL before sparse additions or remote updates.
  - Reject cross-repository mappings unless the selected item is an explicitly recognized external.
  - Files: working-copy context service, repository browser mapping, remote update targeting.

- [x] **SVN-020: Make revision reporting locale-independent or explicitly best-effort.**
  - Checkout, update, commit, export, copy, switch, import, and progress operations parse English human-readable output.
  - Run SVN with a controlled locale where supported, query the resulting revision separately, or expose `revision: null` instead of silently returning `0` when parsing fails.
  - Test non-English output and “At revision”/no-op cases.

## P2 — product completeness, compatibility, and maintainability

- [x] **SVN-021: Treat shelving as an optional capability, not a universally available SVN action.**
  - The bundled/installed SVN may not provide experimental `shelve`/`unshelve` commands.
  - Detect capabilities once in diagnostics and hide/disable the feature before the user opens it.
  - If shelving is a required product feature, implement a portable patch-based shelf backend instead of depending on experimental CLI commands.

- [x] **SVN-022: Remove or use redundant endpoints.**
  - Dedicated `rename` is unused because rename correctly goes through `svn move`.
  - Standalone changelist create is unused/no-op.
  - Remove redundant API surface or make the renderer use one canonical action name consistently.

- [x] **SVN-023: Finish progress output parity.**
  - Sparse checkout with progress returns only bootstrap checkout output, omitting per-selection update output.
  - Progress parsers count output lines rather than unique paths and can double-count paths split/repeated across chunks.
  - Buffer partial lines between chunks and report stable per-path progress.
  - Files: `src/main/services/svn-checkout.ts`, `svn-working-copy.ts`, `svn-progress.ts`.

- [x] **SVN-024: Add input validation and structured errors to metadata operations.**
  - Validate property names, changelist names, shelf names, external definitions, revisions, and merge ranges before invoking SVN.
  - Preserve SVN error codes in structured results instead of returning only `success: false`.
  - Do not log and discard the only actionable error.

- [x] **SVN-025: Verify merge UI semantics against all supported command forms.**
  - Confirm complete merge, cherry-pick revisions, multiple ranges, reverse ranges, record-only, dry-run, ancestry, depth, and mixed-revision behavior.
  - Validate that the target is a working-copy path and the source/peg revision is constructed correctly.
  - Add real history assertions for mergeinfo and reverse merges, not just command success.

- [x] **SVN-026: Verify lock/unlock hooks and working-copy root selection.**
  - Hooks are loaded using the immediate parent directory, which may not be the configured working-copy root key.
  - Resolve the actual working-copy root before loading hooks and use the same root normalization as commit/update.
  - Verify pre/post lock semantics; only pre-hooks currently appear to run.

- [x] **SVN-027: Make local deletion behavior explicit and recoverable.**
  - Deleting unversioned/ignored items calls recursive filesystem removal immediately, unlike versioned delete which is scheduled by SVN.
  - Confirm this UX is intentional, add a destructive confirmation, and prefer trash/recycle-bin where supported.
  - Never infer “safe to delete locally” from a failed/empty status result.

- [x] **SVN-028: Define network/auth parity for every URL and working-copy command.**
  - Audit HTTP(S), SVN, SVN+SSH, and file repositories across info, list, checkout, update, commit, copy/move/delete/mkdir, switch, merge, locks, and externals.
  - Ensure cached credentials, SSL exceptions, proxy/client certificate settings, non-interactive mode, and cancellation are consistently applied.
  - Avoid initializing SSL trust storage for non-HTTPS URLs.

- [x] **SVN-029: Restore active UI regression coverage.**
  - Repository-browser add-to-working-copy, sparse checkout, checkout dialog, choose-items, update-to-revision, and several progress suites are skipped.
  - Fix the React/jsdom harness or move these workflows to Playwright.
  - Make subtree mapping and sibling-isolation tests mandatory in CI.

- [x] **SVN-030: Expand the real-SVN release gate.**
  - Keep existing real coverage for checkout, commit, update, revert, cleanup, locks, patch, branch/copy, switch, merge, sparse checkout, list, and externals.
  - Add remote mkdir/delete/move, import/export, resolve, props, changelists, blame, URL diff, relocate, upgrade compatibility, cancellation, failure/auth cases, and the P0 edge cases above.
  - Run against the minimum and maximum supported SVN client versions and Windows path semantics.

## P3 — missing SVN features and remaining wiring

- [x] **SVN-031: Add repository file retrieval with `svn cat`.**
  - Support local paths and repository URLs, peg/operative revisions, credentials, SSL trust, cancellation, text/binary detection, and saving content without a checkout.
  - Wire repository-browser and history file-preview actions to the canonical endpoint.
  - Add unit and real-repository tests for HEAD, historical revisions, binary content, encoded names, and failures.

- [x] **SVN-032: Add `svn mergeinfo` and merge eligibility views.**
  - Expose merged and eligible revisions plus inherited/explicit mergeinfo for source and target.
  - Integrate with the merge wizard and history UI, including reverse-merge and subtree mergeinfo tests.

- [x] **SVN-033: Separate working-copy copy from repository branch/tag copy.**
  - Add a local scheduled-copy workflow without a commit message and retain history-preserving remote copy for branches/tags.
  - Validate source/destination relationships and add move/copy parity tests.

- [x] **SVN-034: Add repository and revision property management.**
  - Support URL targets, `propget`, inherited properties, recursive depth, and revision properties with explicit revprop confirmation.
  - Preserve binary/multiline property values and authorization errors.

- [x] **SVN-035: Add advanced cleanup controls.**
  - Expose break locks, remove unversioned/ignored items, include externals, and pristine vacuum where the installed client supports them.
  - Preview destructive targets and use recoverable deletion where possible.

- [x] **SVN-036: Complete patch creation/application options.**
  - Add reverse, strip count, whitespace handling, target filtering, and explicit fuzz/conflict reporting.
  - Cover partial application and reject-file recovery in real tests.

- [x] **SVN-037: Expand log and history options.**
  - Add changed paths, stop-on-copy, strict node history, revision-property selection, search/filtering, and merged/eligible revision views.
  - Preserve errors and cancellation instead of displaying empty history.

- [x] **SVN-038: Add remote file content workflows.**
  - View/download repository files at a revision, compare historical content, and safely edit repository-side properties.
  - Do not imply that direct repository content editing is an SVN operation; use checkout/edit/commit or import semantics explicitly.

- [x] **SVN-039: Add native SVN authentication-cache management.**
  - Inspect and remove native cached credentials/certificates using supported `svn auth` operations while keeping the app credential store clearly separate.
  - Never expose stored secrets in renderer responses or logs.

- [x] **SVN-040: Replace successful-looking empty read failures with structured errors.**
  - Apply one `{ data, error, errorCode, cancelled, partial }` contract to status, remote status, log, blame, locks, externals, shelves, and metadata reads.
  - Ensure failed reads are not cached and every renderer distinguishes empty data from failure.

- [x] **SVN-041: Return nullable, verified revisions.**
  - Replace ambiguous revision `0` fallbacks with `null` and query authoritative revision information after successful mutations where needed.
  - Cover localized output and no-op commands.

- [x] **SVN-042: Complete switched-subtree and nested-external mapping.**
  - Resolve the nearest versioned ancestor URL/repository UUID for every remote-to-local mapping.
  - Add switched, nested external, cross-repository, missing-child, symlink, UNC, Unicode, and encoded-path tests.

- [x] **SVN-043: Add explicit revert depth controls.**
  - Offer empty/files/immediates/infinity behavior for directories, preview affected descendants, and preserve mixed-selection intent.

- [x] **SVN-044: Make unversioned deletion recoverable.**
  - Require an explicit destructive confirmation, prefer OS trash/recycle bin, and never delete based on a failed status read.

- [x] **SVN-045: Strengthen repository mutation identity checks.**
  - Validate repository UUID, source kind/existence, destination parent/existence, peg revisions, and ancestry for remote copy/move/delete/mkdir.

- [x] **SVN-046: Introduce structured SVN command errors.**
  - Preserve SVN error codes, command category, target, retryability, authentication/certificate classification, and safe stderr across IPC.
  - Remove ad-hoc `{ success: false }`, thrown-error, and empty-result inconsistencies.

- [x] **SVN-047: Complete progress and cancellation UI wiring.**
  - Give every long operation a stable handle, visible progress, targeted cancellation, cleanup-on-close, and parity with its non-progress implementation.

- [x] **SVN-048: Provide a portable shelving backend.**
  - Use patch plus metadata storage when native experimental shelving is unavailable, including unversioned files and safe restore/delete behavior.

- [x] **SVN-049: Verify all supported repository protocols.**
  - Add integration coverage for HTTP(S), svn, svn+ssh, and file URLs across reads and mutations, including proxy, certificate, SSH, cancellation, and credential behavior.
  - [x] Real `file://` read/mutation workflows run in the release gate.
  - [x] Real authenticated `svn://` read/mutation workflows and authentication failures run in the release gate.
  - [x] Real `svn+ssh://` tunnel read/mutation workflows run on supported POSIX runners; configured client, agent, key selection, and non-interactive behavior have active unit/UI coverage.
  - [x] Provision authenticated HTTP and self-signed HTTPS DAV repositories in CI and run the same read/mutation contract against both.

- [x] **SVN-050: Restore and expand UI and release-gate coverage.**
  - Unskip sparse/progress/dialog suites and add real tests for cat, mergeinfo, local copy, cleanup options, properties, relocate, cancellation, authentication failures, and supported client/OS matrices.

- [x] **SVN-051: Complete conflict and tree-conflict workflows.**
  - Detect text/property/tree conflicts, show mine/base/theirs content, support all valid accept modes, validate manual merged files, and verify resolution state before commit.

- [x] **SVN-052: Guarantee lossless externals editing.**
  - Parse all supported old/new syntax, quoting, escaping, peg and operative revisions, relative URL forms, comments, and platform-specific paths into a round-trippable model.

## P1 — cache correctness and wiring

- [x] **SVN-053: Connect the offline cache to production SVN read flows.**
  - `useOfflineAware` is currently unused by the file explorer, working-copy context, repository browser, and history screens, so most production reads never populate or consume the advertised offline cache.
  - Establish one production cache provider/service and route supported info, status, log, and repository-entry reads through it.
  - Clearly label cached results with their age and source; never present a failed read as a fresh empty result.
  - Add online-population, offline-fallback, restart-persistence, expiry, and failed-read tests.
  - Files: `src/renderer/src/hooks/useOfflineCache.ts`, application provider/layout, SVN read hooks and screens.

- [x] **SVN-054: Make offline cache state shared rather than hook-instance-local.**
  - Each `useOfflineCache` call currently owns a separate in-memory `Map`, so the indicator, manager, and consumer can report or clear different cache instances.
  - Move cache state behind a single context/store or main-process service with one initialization lifecycle.
  - Ensure simultaneous consumers observe the same inserts, expiry, statistics, and clear operations.
  - Add multi-consumer tests proving that populate, statistics, clear-path, and clear-all updates are immediately consistent.

- [x] **SVN-055: Enforce offline-cache size limits with deterministic eviction.**
  - `maxCacheSize` is configured but never enforced, and current statistics estimate every entry as 2 KiB regardless of actual serialized size.
  - Track actual or safely bounded serialized size, reject entries larger than the total budget, and evict least-recently-used entries until within the configured limit.
  - Purge expired entries during load, access, insertion, and statistics generation.
  - Add boundary tests for oversized entries, mixed cache types, LRU access, expiry, persistence, and a 50 MB default budget.

- [x] **SVN-056: Wire log-cache settings to the cache implementation.**
  - `logCachePath` and `maxLogCacheSize` are exposed in Settings but `useLogCache` stores data under an application-store key and uses neither setting.
  - Choose one supported storage backend, honor the configured location and size limit, and migrate or deliberately discard the legacy store format.
  - Validate custom paths through the approved-path boundary and fall back safely when a configured directory is unavailable.
  - Add settings-change, migration, size-enforcement, invalid-path, and restart tests.

- [x] **SVN-057: Make cache size reporting and clearing operate on the real SVN caches.**
  - Settings currently measures and clears Electron/filesystem cache directories, while active log/offline data lives in application-store keys.
  - Include log and offline cache storage in the reported breakdown, or label Electron cache separately so the UI is not misleading.
  - Clear in-memory state, persisted log/offline entries, and relevant query caches atomically enough that cleared data cannot be restored by an in-flight write.
  - Add end-to-end tests covering size before/after population, selective clearing, clear-all, active consumers, and restart.

- [x] **SVN-058: Include result-shaping arguments in log cache identities.**
  - The log cache scope separates merge/history options but omits the requested entry limit, allowing a smaller cached result to satisfy a larger offline request.
  - Build a canonical cache identity from path/URL, limit, revision range, merge-history mode, stop-on-copy, strict history, and revision-property options.
  - Define whether a larger cached page may safely satisfy a smaller request and truncate explicitly if supported.
  - Add tests for 25/50/100/200 limits, option ordering, revision-property sets, and online-to-offline transitions.

- [x] **SVN-059: Serialize persistent log-cache read/modify/write operations.**
  - Concurrent `get` → modify → `set` sequences can overwrite entries saved by another path or history view.
  - Use a main-process transactional update, mutation queue, or versioned compare-and-retry operation for the shared cache document.
  - Ensure clear-path and clear-all cannot race with a late save and repopulate deleted data.
  - Add deterministic concurrency tests for simultaneous saves, save-versus-clear, expiry cleanup, and storage failures.

- [x] **SVN-060: Prevent stale asynchronous cache loads from updating a new view.**
  - A slow `useLogCache` load can complete after the path or cache scope changes and replace the new view with the previous path's data.
  - Add generation/abort guards to loads and saves, and clear the visible state synchronously when identity changes.
  - Apply the same stale-result protection to offline-cache initialization and any asynchronous cache hydration.
  - Add delayed-storage tests covering rapid path, credentials, revision, and option changes plus component unmount.

- [x] **SVN-061: Remove secrets from repository-browser query keys.**
  - Repository-list query keys currently contain the raw username and password, exposing credentials through query inspection, diagnostics, and memory snapshots.
  - Replace credentials with a non-secret connection identity such as repository URL, username, auth realm, and an in-memory credential-generation token.
  - Ensure credential replacement invalidates the appropriate queries without hashing or persisting the password.
  - Add tests proving raw secrets never appear in query keys, serialized cache state, logs, or error diagnostics.

- [x] **SVN-062: Consolidate repository mutation invalidation and refetch behavior.**
  - Repository-browser mutations invalidate the active query and then explicitly refetch it, while the global mutation event invalidates repository queries again.
  - Define one authoritative invalidation path that covers source parent, destination parent, branch lists, info/log views, and any matching working copies.
  - Avoid redundant network requests while ensuring copy/move operations refresh both affected locations and cross-view caches.
  - Add request-count and freshness tests for mkdir, copy, move, delete, import, remote properties, and revision-property mutations.

## Definition of done for this audit

- [x] Normal and progress variants share one command builder and one validation/mutation workflow.
- [x] Every mutating action has explicit target validation, serialization where appropriate, cache invalidation, and structured errors.
- [x] Every renderer action has an active test proving the exact IPC arguments and resulting SVN command.
- [x] Every supported SVN action has at least one real-repository success test and one representative failure test.
- [x] Optional/experimental commands are capability-gated rather than failing after user interaction.
- [x] No expected error is represented as a successful empty result or revision `0` without an accompanying explanation.
