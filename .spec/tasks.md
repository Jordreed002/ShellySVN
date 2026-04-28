# Tasks

Generated: 2026-04-28

This file tracks actionable follow-up work from the project review.

Execution order is defined in `fix-plan.md`.

---

## Immediate

- [ ] Reinstall dependencies from `bun.lock` and confirm `node_modules/.bin` contains `oxlint`, `vitest`, and other declared tool binaries.
- [ ] Run `bun run build` after dependency repair and record the result.
- [ ] Add a `test` or `test:unit` script that runs the local Vitest dependency instead of using an unpinned `bunx vitest`.
- [ ] Add a `verify` script for typecheck, lint, unit tests, and build.
- [ ] Add or update CI to run `bun run typecheck`, `bun run lint`, unit tests, and `bun run build`.
- [ ] Triage all skipped tests and decide which should be fixed, moved to a Node environment, or deleted.
- [ ] Add a CI check that fails when skipped tests increase without an explicit allowlist update.

---

## Security

- [ ] Add a command-argument redaction helper for SVN debug logs.
- [ ] Update `executeSvn()` logging to use redacted args.
- [ ] Add tests proving `--password` and other sensitive flags are never logged.
- [ ] Prevent `AuthCache` from writing plaintext credentials when `safeStorage` is unavailable.
- [ ] Prevent `SettingsManager` from writing plaintext proxy passwords when `safeStorage` is unavailable.
- [ ] Reuse the same external URL scheme validation in `setWindowOpenHandler`.
- [ ] Consolidate SVN SSL trust handling into one helper.
- [ ] Remove default support for `other` SSL trust failures unless there is a dedicated user-confirmed path.
- [ ] Replace current path validation with resolve-against-allowed-root validation.
- [ ] Add validation tests for Windows absolute paths, drive-relative paths, UNC paths, parent traversal, symlinks, and non-existent targets.
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

- [ ] Add an app diagnostics panel for SVN binary path, SVN version, encryption availability, and packaged resource status.
- [ ] Add a redacted diagnostic export for bug reports.
- [ ] Add packaged-app smoke tests per target platform.
- [ ] Add cancellation and progress reporting to more long-running SVN operations.
- [ ] Replace production `prompt()` / `confirm()` usage with accessible app dialogs.
- [x] Fix commit template resolvers that rely on renderer-side Node globals.
- [x] Align auth cache reporting/clearing with the real credential cache file path.
- [ ] Centralize all SVN process spawning behind one executor service.
- [ ] Replace regex-based SVN XML parsing with typed parser helpers.
- [ ] Decide whether `packages/logic-engine` is production architecture or remove it from release documentation.
- [x] Move webhook delivery to a main-process service with URL validation and timeout handling.
- [x] Correct shell integration status when native helpers are missing.
- [ ] Split large modules: `svn.ts`, `SettingsDialog.tsx`, and `FileExplorer.tsx`.
