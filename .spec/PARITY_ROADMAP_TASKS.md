# ShellySVN TortoiseSVN Parity Task List

> Created: 2026-04-29
> Tightened against: `.spec/spec.md` and `.spec/tortoisesvn-parity-roadmap.md`
> Goal: Make ShellySVN a credible TortoiseSVN replacement on Windows and a first-class SVN client on macOS, without cloning Windows-only behavior where a platform-native workflow is better.

---

## Status Key

- `[ ]` Not started
- `[~]` Partial or needs verification
- `[x]` Implemented and verified

---

## P0 - Baseline, Scope, and Release Bar

- [x] Build a feature parity matrix covering ShellySVN, TortoiseSVN-style workflows, SVN CLI capability, and explicit non-goals.
- [x] Mark each parity item as `complete`, `partial`, `missing`, `out of scope`, or `needs manual verification`.
- [x] Map every implemented parity feature to renderer entry point, preload API, main IPC handler, service method, and tests.
- [x] Identify README claims that are not implemented, not reachable, or not covered by verification.
- [x] Document platform-specific decisions where ShellySVN intentionally differs from TortoiseSVN.
- [x] Define which platforms are release-blocking for the next release: Windows, macOS, and/or Linux.
- [x] Decide whether Linux parity is best-effort until Windows/macOS workflows stabilize.
- [x] Keep `.spec/spec.md`, `.spec/tortoisesvn-parity-roadmap.md`, `.spec/tasks.md`, and README roadmap entries synchronized as parity decisions change.

## P0 - File Manager Integration

- [ ] Implement or verify Windows Explorer context menu commands for common working-copy actions.
- [ ] Implement or verify Windows Explorer overlays for normal, modified, added, conflicted, locked, ignored, unversioned, missing, and external items.
- [ ] Implement or verify macOS Finder Sync context menu commands for common working-copy actions.
- [ ] Implement or verify macOS Finder badges for the status set Finder supports.
- [x] Add platform-appropriate fallback behavior when overlays, badges, or context menus are unavailable.
- [x] Add shell/Finder integration health diagnostics with repair actions.
- [ ] Add installer/package checks that validate Windows shell helper registration.
- [ ] Add installer/package checks that validate macOS Finder Sync registration and required permissions.
- [ ] Verify file-manager actions can hand off complex workflows to the standalone app with the correct selected paths.
- [ ] Add packaged-build smoke tests for shell/Finder integration on release targets.

## P0 - Core Working Copy Workflows

- [x] Verify open-working-copy flow detects root, repository URL, revision, and status summary.
- [x] Verify status rendering for versioned, modified, unversioned, ignored, missing, deleted, conflicted, locked, external, switched, nested, obstructed, replaced, and remote-only items.
- [x] Add explicit "check repository" remote-status action and distinguish local status from repository status.
- [ ] Add bounded-concurrency background status refresh with cancellation.
- [x] Verify checkout supports URL, destination path, revision, depth, credentials, SSL trust, progress, and cancellation.
- [x] Verify update supports revision, depth, ignore externals, force, progress, and cancellation.
- [ ] Verify revert, cleanup, resolve, add, delete, move, copy, and rename from toolbar, context menu, and command palette.
- [x] Ensure revert, cleanup, delete, resolve, relocate, and other risky actions explain consequences before running when confirmations are enabled.
- [ ] Add drag/drop or app-native move/copy workflows for reorganizing versioned files.
- [x] Add working-copy upgrade detection, guided upgrade flow, and tests.
- [x] Ensure failed SVN commands return success, failure, canceled, or partial states without crashing the app.

## P0 - Commit Workflow Parity

- [x] Verify commit dialog selection parity for versioned, unversioned, missing, deleted, changelist, external, and nested working-copy items.
- [x] Support grouping and filtering changed files by status, changelist, and path.
- [x] Verify selective file inclusion and exclusion, including multi-select behavior.
- [x] Add commit message templates create, edit, apply, and delete coverage.
- [x] Add commit message history persistence, keyboard selection, and clearing behavior.
- [x] Add commit message minimum length validation.
- [x] Strip unsafe null bytes from commit messages before invoking SVN.
- [x] Add required issue ID validation and warning behavior.
- [x] Add commit message spellcheck decision and implementation task if in scope.
- [x] Add path, filename, and keyword autocomplete in the commit message editor.
- [x] Run configured hooks in the expected order and surface hook output when enabled.
- [x] Ensure commit credentials and command-line secrets are never logged or exposed in renderer logs.
- [x] Add commit success reporting with committed revision and post-commit status refresh.

## P0 - Conflict Resolution

- [ ] Verify text conflict detection from status, update, merge, and commit-blocking flows.
- [ ] Verify tree conflict detection and display.
- [ ] Verify lock conflict detection and recovery paths.
- [x] Add guided resolve coverage for `base`, `mine-full`, `theirs-full`, `mine-conflict`, and `theirs-conflict`.
- [x] Prevent marking unresolved conflicts as resolved unless the user explicitly confirms.
- [ ] Verify three-way merge editor loads base, mine, theirs, and merged files correctly.
- [ ] Add safe save, revert, and unsaved-change behavior for the merge editor.
- [ ] Verify external merge tool launch with configured executable paths and missing-tool errors.
- [x] Ensure resolved files refresh status immediately after resolution.
- [ ] Add conflict-resolution E2E coverage from file explorer, update/merge results, and conflict dialogs.

## P1 - Diff, Merge, Patch, and File Review

- [x] Verify unified diff rendering for added, deleted, modified, renamed, copied, property-only, and binary files.
- [x] Add reliable side-by-side text diff mode or record a product decision to defer it.
- [x] Verify large diffs do not block the renderer.
- [x] Verify syntax highlighting does not break very large files or unknown languages.
- [x] Verify image diff behavior for common asset formats and document supported formats.
- [x] Add external diff and merge tool configuration with per-extension overrides.
- [x] Validate external executable paths before saving settings and before spawning tools.
- [x] Verify patch creation for selected files and whole working copies.
- [x] Verify patch apply dry-run output, reject-file visibility, and binary-safe failure messaging.
- [x] Decide the Office/document diff strategy: supported integration, external-tool handoff, or explicit non-goal.

## P1 - History, Blame, Revision Graph, and Review

- [x] Verify revision log filtering by author, message, path, revision range, date range, and issue ID.
- [x] Add changed-path filtering, pagination, and search coverage in log/history views.
- [x] Add issue ID column and issue links in revision log and commit views.
- [x] Verify log cache behavior for large repositories, including invalidation and manual cache management.
- [x] Add branch/tag comparison workflow.
- [x] Add merge-tracking log view.
- [x] Verify blame view shows line-level revision, author, date, and log-message context.
- [x] Verify revision graph clearly shows branches, tags, copies, and merges.
- [x] Add revision graph export coverage.
- [x] Add project statistics for commits over time, authors, file churn, and branch/tag activity, or defer explicitly.

## P1 - Branching, Tagging, Switching, Merging, and Relocation

- [x] Verify branch/tag creation from source URL and working-copy path.
- [x] Add branch/tag wizard validation for invalid URLs, existing targets, missing messages, and unsafe paths.
- [x] Verify switch flow for whole working copies and nested switched paths.
- [x] Verify relocate flow for repository root URL changes.
- [x] Verify merge wizard supports revision ranges, dry-run preview, merge output, progress, cancellation, and conflict summary.
- [x] Decide whether reintegrate-style guidance is needed for supported SVN versions.
- [x] Add post-merge status refresh and clear conflict reporting.
- [x] Ensure branch, tag, switch, merge, and relocate are reachable from app navigation and relevant context menus.

## P1 - Repository Browser and Sparse Checkout

- [x] Verify remote browsing for `http`, `https`, `svn`, and `svn+ssh` URLs where SVN supports them.
- [x] Verify repository browser auth with anonymous access, username/password, cached credentials, SSL trust, and SSH-backed repositories.
- [x] Add repository browser revision selector.
- [x] Add repository browser prefetch/caching for faster navigation.
- [x] Add remote create folder support with commit message.
- [x] Add remote delete support with confirmation and commit message.
- [x] Add remote rename/move support with confirmation and commit message.
- [x] Add remote copy support for branch/tag-style repository operations.
- [x] Verify lazy loading, search, auth prompts, and error recovery in E2E tests.
- [x] Verify sparse checkout selection, deselection, subtree behavior, and remote-only display.
- [x] Verify "add to working copy" for files, folders, and mixed-depth parents.
- [x] Verify individual remote-only item update into the working copy.

## P1 - Properties, Externals, Locks, Shelving, and Advanced SVN

- [x] Verify properties viewer supports add, edit, delete, and refresh.
- [x] Add common property helpers for `svn:ignore`, `svn:externals`, `svn:keywords`, `svn:eol-style`, and `svn:mime-type`.
- [x] Verify externals manager can list, add, edit, remove, and update externals.
- [x] Ensure commit and status flows handle externals clearly.
- [x] Verify lock, unlock, force lock, force unlock, and lock list workflows.
- [x] Add lock owner and stale-lock handling in file explorer and dialogs.
- [x] Verify shelve, unshelve/apply, list, and delete workflows with the minimum supported SVN version.
- [x] Decide the minimum acceptable SVN version for sparse checkout, shelving, and other advanced features.
- [x] Add repository diagnostics for unsupported or mismatched SVN versions.

## P1 - Issue Tracker Integration

- [x] Add per-project issue tracker configuration.
- [x] Support configurable issue regex and URL templates.
- [x] Support commit dialog issue ID field or message parsing.
- [x] Add required issue ID warnings before commit.
- [x] Add issue links in log, commit, and history views.
- [x] Add issue ID column in revision log.
- [x] Evaluate compatibility with common SVN project properties where practical.
- [x] Add tests for issue parsing, URL generation, validation, and display.

## P1 - Authentication, Network, SSL, and Security

- [ ] Verify per-realm SVN credentials across all SVN operations.
- [x] Add session-only credential behavior where persistent storage is not desired.
- [x] Add credential edit, delete, and clear flows from settings.
- [x] Ensure persistent plaintext credential storage never occurs silently.
- [x] Verify encryption availability is shown clearly on Windows, macOS, and Linux.
- [ ] Verify proxy settings apply to checkout, update, commit, repo browser, log, externals, and sparse checkout.
- [x] Verify connection timeout applies consistently to SVN command paths.
- [ ] Centralize SSL trust handling with explicit temporary and permanent trust decisions.
- [ ] Avoid broad SSL bypass unless each failure class is separately confirmed.
- [x] Verify client certificate configuration and failure messaging.
- [x] Decide whether `svn+ssh` key management is in scope or relies on user SSH agent/config.
- [x] Ensure logs, diagnostics, errors, snapshots, and support exports redact credentials, tokens, proxy passwords, and secret-bearing URLs.

## P1 - Settings, Diagnostics, and Supportability

- [x] Validate custom SVN binary paths before saving and before use.
- [x] Add diagnostics for SVN path, SVN version, bundled binaries, encryption availability, shell/Finder integration, and working-copy health.
- [x] Add redacted diagnostic export for support.
- [x] Add cache management coverage for log cache and app cache.
- [x] Verify all settings panels persist and survive missing or migrated fields.
- [x] Add migration tests for existing settings stores across app versions.
- [x] Decide whether persistent credentials are disabled when encryption is unavailable or allowed only through explicit opt-in.
- [x] Replace browser-native `prompt()` and `confirm()` flows with accessible app dialogs where any remain.

## P2 - UX, Navigation, and Accessibility

- [x] Verify command palette includes every reachable user command and respects disabled states.
- [ ] Add context menu parity matrix for file explorer, repository browser, history, diff, project monitor, and shell/Finder surfaces.
- [x] Add keyboard shortcut coverage for file explorer, commit, update, diff, log, conflict, and dialog actions.
- [x] Verify bookmarks, recent repositories, recent paths, and startup actions.
- [x] Add onboarding coverage for first-run, skipped tutorial, resumed tutorial, and completed tutorial states.
- [ ] Add empty, loading, error, and offline states for primary routes.
- [ ] Ensure core workflows are keyboard accessible.
- [x] Verify modal dialogs trap focus and restore focus on close.
- [x] Make status and progress changes screen-reader friendly.
- [ ] Verify contrast and ARIA labeling for primary workflows.
- [x] Decide whether multi-language UI is in scope before 1.0.

## P2 - Performance and Large Repository Readiness

- [x] Define target repository sizes for parity testing: file count, folder depth, log length, diff size, and binary size.
- [ ] Add large working-copy status benchmarks.
- [ ] Add large repository browser lazy-loading benchmarks.
- [ ] Add large log history pagination and filtering benchmarks.
- [ ] Verify virtualized lists remain stable during selection, filtering, context menus, and refresh.
- [ ] Ensure folder-size scans and status scans do not block rendering.
- [ ] Verify background scanning does not block active SVN operations.
- [x] Add regression budgets for renderer bundle size, app shell startup time, and common route load time.
- [x] Verify normal operation does not depend on remote assets.

## P2 - CLI, Logic Engine, and Architecture Decisions

- [x] Decide whether SVN execution is centralized in the Electron main process, the logic-engine binary, or a clearly split model.
- [x] Define which desktop operations should also exist in `shellysvn-cli` or `shelly-engine`.
- [x] Add CLI parity tasks for status, info, log, diff, checkout, update, commit, revert, cleanup, export, and diagnostics.
- [x] Add structured JSON output contracts for CLI commands.
- [x] Add CLI authentication and config handling decisions.
- [ ] Add cross-platform compiled binary smoke tests.
- [ ] Ensure app and CLI share parsing logic instead of duplicating SVN output handling.
- [x] Keep Electron main, preload, renderer, and shared contracts clearly separated.
- [x] Add IPC validation tests for security-sensitive paths, including Windows path cases.

## P2 - Packaging, CI, and Release Hardening

- [x] Make `bun run verify` the standard local parity gate.
- [x] Ensure required local verification includes typecheck, lint, unit tests, build, and targeted E2E tests for touched workflows.
- [x] Add clean-install CI verification from lockfile.
- [ ] Add packaged-app smoke tests for Windows x64, macOS x64, macOS arm64, and Linux x64 where release-supported.
- [x] Verify bundled SVN and shelly-engine binaries are present and executable in each package.
- [x] Document macOS signing and notarization requirements before public distribution.
- [ ] Add crash recovery tests for interrupted SVN operations.
- [x] Resolve or quarantine known unit test infrastructure failures from prior audits.
- [x] Enforce skipped-test rules: new skips require a linked issue or task, and skipped count should trend down.
- [x] Ensure README setup instructions are accurate and free of encoding corruption before release.

## Deferred or Explicitly Out of Scope

- [x] Keep Git integration out of the parity roadmap unless the product spec changes.
- [x] Decide whether a plugin/extension system is required before 1.0.
- [x] Decide whether Linux shell integration is best-effort or a future first-class target.
- [x] Decide whether full TortoiseMerge-style editing is in scope or whether external merge tools remain preferred.
- [x] Keep server-side repository administration tools out of scope unless explicitly added to the product spec.
- [x] Decide whether group policy deployment controls are needed for enterprise parity.
- [x] Decide whether built-in SubWCRev equivalent is useful before 1.0.
- [x] Decide whether legacy TortoiseSVN command URL compatibility is useful before 1.0.
- [x] Decide whether full TortoiseSVN settings compatibility is useful before 1.0.

---

## Suggested Execution Order

1. Complete the parity baseline matrix and resolve open scope questions from `.spec/spec.md`.
2. Stabilize P0 file-manager integration, core working-copy flows, commit, and conflict resolution.
3. Fill P1 replacement-critical gaps: diff/merge, history/review, repo browser, advanced SVN, issue tracking, auth, and diagnostics.
4. Add packaged Windows and macOS verification before claiming TortoiseSVN replacement readiness.
5. Use P2 items to raise polish, performance, CLI coverage, and release confidence after replacement-critical workflows are reliable.
