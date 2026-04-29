# Tasks

Generated: 2026-04-28

This file tracks actionable follow-up work from the project review.

Execution order is defined in `fix-plan.md`.

---

## Immediate

- [ ] Reinstall dependencies from `bun.lock` and confirm `node_modules/.bin` contains `oxlint`, `vitest`, and other declared tool binaries.
- [x] Run `bun run build` after dependency repair and record the result.
- [x] Add a `test` or `test:unit` script that runs the local Vitest dependency instead of using an unpinned `bunx vitest`.
- [x] Add a `verify` script for typecheck, lint, unit tests, and build.
- [x] Add or update CI to run `bun run typecheck`, `bun run lint`, unit tests, and `bun run build`.
- [x] Triage all skipped tests and decide which should be fixed, moved to a Node environment, or deleted.
- [x] Add a CI check that fails when skipped tests increase without an explicit allowlist update.

---

## Security

- [x] Add a command-argument redaction helper for SVN debug logs.
- [x] Update `executeSvn()` logging to use redacted args.
- [x] Add tests proving `--password` and other sensitive flags are never logged.
- [x] Prevent `AuthCache` from writing plaintext credentials when `safeStorage` is unavailable.
- [x] Prevent `SettingsManager` from writing plaintext proxy passwords when `safeStorage` is unavailable.
- [x] Reuse the same external URL scheme validation in `setWindowOpenHandler`.
- [x] Consolidate SVN SSL trust handling into one helper.
- [x] Remove default support for `other` SSL trust failures unless there is a dedicated user-confirmed path.
- [x] Replace current path validation with resolve-against-allowed-root validation.
- [x] Add validation tests for Windows absolute paths, drive-relative paths, UNC paths, parent traversal, symlinks, and non-existent targets.
- [x] Scope `fs:writeFile` to app/plugin-owned directories or explicit user-approved paths.
- [x] Scope `fs:copyFile`, `fs:watch`, and recursive folder-size operations to approved roots.
- [x] Validate custom SVN binary paths before saving and before spawning.
- [x] Add an SVN binary version check for custom clients.
- [x] Validate and confirm mutating deep-link actions before dispatch.
- [x] Move webhook secrets out of the generic store.
- [x] Redact copied error-boundary diagnostics.

---

## Build / Routing

- [x] Resolve the `react-syntax-highlighter` build failure.
- [x] Decide whether `RepoBrowserContent.tsx` belongs under `routes`.
- [x] If it is not a route, move it, prefix it with `-`, or configure `routeFileIgnorePattern`.
- [x] Re-run the production build and confirm the TanStack Router warning is gone or intentionally documented.
- [x] Bundle renderer fonts locally or remove the remote Google Fonts import.
- [x] Verify the production CSP against the built renderer assets.
- [x] Add a prepackage binary verification script for bundled SVN and `shelly-engine`.
- [x] Fail packaging if bundled binaries are missing, tiny placeholders, non-executable, or fail `--version`.

---

## Documentation

- [ ] Fix mojibake characters in README and existing `.spec` reports.
- [x] Document expected install and verification commands.
- [x] Document security expectations for credential handling, SSL trust, and filesystem IPC.

---

## Backlog

- [x] Add an app diagnostics panel for SVN binary path, SVN version, encryption availability, and packaged resource status.
- [x] Add a redacted diagnostic export for bug reports.
- [ ] Add packaged-app smoke tests per target platform.
- [ ] Add cancellation and progress reporting to more long-running SVN operations.
- [x] Replace production `confirm()` / `alert()` usage with app-owned dialogs.
- [x] Replace remaining production `prompt()` usage with an accessible renderer input dialog.
- [x] Fix commit template resolvers that rely on renderer-side Node globals.
- [x] Align auth cache reporting/clearing with the real credential cache file path.
- [x] Centralize all production SVN process spawning behind one executor service.
- [x] Replace regex-based SVN XML parsing with typed parser helpers.
- [x] Decide whether `packages/logic-engine` is production architecture or remove it from release documentation.
- [x] Move webhook delivery to a main-process service with URL validation and timeout handling.
- [x] Correct shell integration status when native helpers are missing.
- [ ] Split large modules: `svn.ts`, `SettingsDialog.tsx`, and `FileExplorer.tsx`.
  First boundary identified and started by extracting `src/main/services/svn-executor.ts`.
- [ ] Execute the refactor and codebase improvement backlog in `refactor-improvement-tasks.md`.
- [ ] Execute the performance improvement backlog in `performance-improvement-tasks.md`.

---

## TortoiseSVN Replacement Roadmap

These tasks track the important parity work needed for ShellySVN to become the preferred SVN client on Windows and macOS. Details and non-goals are in `tortoisesvn-parity-roadmap.md`.

Scope decisions are recorded in `parity-decisions.md`: Windows x64, macOS x64, and macOS arm64 are release-blocking for replacement readiness; Linux shell parity is deferred; Office/document diff defaults to external-tool handoff; Git integration and server administration are outside the parity roadmap.

### File Manager Integration

- [ ] Add Windows Explorer context menu commands for checkout, update, commit, diff, log, revert, cleanup, resolve, lock/unlock, branch/tag, switch, merge, and properties.
- [ ] Add Windows Explorer overlay icons for normal, modified, added, deleted, conflicted, locked, ignored, unversioned, external, and obstructed states.
- [ ] Add macOS Finder Sync context menu commands for the same common working-copy actions.
- [ ] Add macOS Finder badge support for the supported SVN status set.
- [x] Add shell/Finder integration diagnostics with repair guidance and registration status.
- [ ] Add packaged installer checks for Windows shell extension registration.
- [ ] Add packaged installer/package checks for macOS Finder Sync registration and permissions.
- [x] Define fallback app workflows when overlays or Finder badges are unavailable.

### Commit Workflow

- [x] Upgrade commit dialog file selection to clearly handle versioned, unversioned, missing, deleted, changelist, externals, and nested working-copy items.
- [x] Add per-project minimum commit message length rules.
- [x] Add required issue ID validation before commit.
- [x] Add commit message spellcheck.
- [x] Add commit message path and keyword autocomplete.
- [x] Add commit template and history management that works in packaged builds.
- [x] Add commit dialog warnings for mixed revisions, switched paths, locks, and externals.

### Update / Status / Working Copy

- [x] Wire Update dialog revision, depth, ignore externals, and force options to SVN.
- [x] Add update progress events and cancellation.
- [ ] Add commit progress events and cancellation.
- [ ] Add merge progress events and cancellation.
- [ ] Add export/import progress events and cancellation.
- [x] Add explicit local-vs-remote status checks.
- [x] Add working-copy upgrade detection and guided upgrade flow.
- [ ] Improve sparse checkout, externals, nested working-copy, and switched-path status display.
- [ ] Add bounded background repository browser prefetch/caching.

### Diff / Merge / Conflict Tools

- [ ] Add side-by-side text diff view with inline changes.
- [ ] Add per-extension external diff tool configuration.
- [ ] Add per-extension external merge tool configuration.
- [ ] Harden three-way conflict editor save/revert behavior.
- [ ] Improve image diff workflows for common asset formats.
- [ ] Add patch apply dry-run output and reject-file visibility.
- [x] Decide and document Office/document diff support strategy.

### History / Review / Analytics

- [x] Add revision log filtering by author, message, path, revision range, date range, and issue ID.
- [x] Add log cache for large repositories.
- [ ] Add branch/tag comparison.
- [ ] Improve revision graph branch, tag, copy, and merge visualization.
- [ ] Add merge-tracking log view.
- [ ] Improve blame view with line-level log-message context.
- [ ] Add project statistics for commits over time, authors, file churn, and branch/tag activity.

### Issue Tracker Integration

- [x] Add per-project issue tracker configuration.
- [x] Add issue ID field or message parser in commit dialog.
- [x] Add optional required issue ID warnings.
- [x] Add issue links in commit and log views.
- [x] Add issue links in blame view.
- [x] Add issue ID column in revision log.
- [x] Support configurable issue regex and URL templates.
- [x] Add initial compatibility with common TortoiseSVN `bugtraq:` project properties.
- [x] Add inherited-folder discovery for TortoiseSVN `bugtraq:` properties on nested paths.

### Release Quality

- [ ] Add packaged-app smoke tests for Windows.
- [ ] Add packaged-app smoke tests for macOS Intel.
- [ ] Add packaged-app smoke tests for macOS Apple Silicon.
- [ ] Add Linux packaged-app smoke tests where Linux release artifacts are produced.
- [ ] Add shell/Finder integration smoke tests where platform automation permits.
- [ ] Continue reducing skipped test baseline after each restored test cluster.
