# macOS test loop — runbook

This document is the runbook for the recurring **macOS-focused test loop** that
runs on the `test/expand-coverage-and-strategy` branch. A second agent works on
**Windows-focused tests** on the same branch, so the loop coordinates via
pull-at-start / commit-push-at-end and keeps its tests in disjoint
`*.macos.test.ts` files.

> If you are a fresh invocation continuing this loop: read this file first, then
> follow the **Per-iteration workflow** below. Progress is tracked by
> `git log --grep="test(macos)" --oneline` (conflict-free, survives context resets).

## Per-iteration workflow

1. `git pull --rebase origin test/expand-coverage-and-strategy` — absorb the
   Windows agent's commits. **Never `--force` push.**
2. Pick the next backlog item (see Prioritized backlog). Confirm it isn't already
   done: `git log --grep="test(macos): <area>"`.
3. Implement ONE focused area in an isolated `*.macos.test.ts` file (or a
   platform-scoped `describe`). Do **not** edit existing shared test files the
   Windows agent may touch — add an adjacent file instead.
4. Verify: `bunx vitest run <new-file>` (targeted, fast) and `bun run typecheck`.
   Run the full suite (`bunx vitest run`) only periodically, not every loop.
5. If green: `git add <files>`; `git commit -m "test(macos): <area>"`.
6. `git push origin test/expand-coverage-and-strategy`. On non-fast-forward,
   `git pull --rebase` once more and retry (max 2). Still failing → skip the push
   this iteration.
7. Tick the item off in the backlog below and include that edit in the same commit.

## Conflict-safety rules (shared branch with the Windows agent)

- Always `pull --rebase` first; **never** `--force` push; **never** push a
  conflicted or non-green state.
- If a rebase conflicts: `git rebase --abort`, restore a clean tree, and **skip**
  committing/pushing this iteration. Try a different, non-overlapping area next loop.
- Keep macOS tests in new `*.macos.test.ts` files, disjoint from the Windows
  agent's `*.windows.test.ts` files, so textual conflicts stay rare.
- If a targeted test won't go green within the time budget, abandon that item for
  this loop (clean tree) and retry or pick another next loop.
- Commit prefix is `test(macos):` (mirrors the established `test(windows):`).

## Prioritized backlog

One item ≈ one iteration. Reuse `src/__test-utils__/electron-api-mock.ts`
(extend to accept `platform: 'darwin'`; defaults to `'linux'`),
`src/__test-utils__/test-helpers.ts`, and `src/main/__tests__/mocks/MockSvnExecutor.ts`.
Prefer deterministic, platform-stubbed tests (via `Object.defineProperty(process,
'platform', …)` or `vi.hoisted` electron mocks) so they pass on every OS; add a
few real-darwin checks guarded by `test.skip(process.platform !== 'darwin')`
where actual macOS behavior matters.

- [x] **P0** — enabler: confirm `electron-api-mock.ts` platform handling (covered case-by-case per test instead of a shared flag).
- [x] **P1** — `protocol-handler.macos.test.ts`: darwin `setAsDefaultProtocolClient('shellysvn')`, `open-url` listener prevents default + dispatches, no single-instance-lock contest; win32 boundary contrast.
- [x] **P2** — `code-editors.macos.test.ts`: macOS well-known dirs `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin` and JetBrains Toolbox `~/Library/.../Toolbox/scripts` (`code-editors.ts:94-110`). Uses `setEditorSearchDirectoriesForTests(null)` + mocked `access` to capture probed paths.
- [x] **P3** — `external-tool-registry.macos.test.ts`: `.app` bundle detection + `/usr/bin/open -a` resolution (`external-tool-registry.ts:82-85,195-200`). Coexists with the Windows agent's `external-tool-registry.validate.test.ts` as a separate file.
- [x] **P4** — `ShellIntegration.macos.test.ts`: Finder Sync helper path `ShellySVNFinderSync`, `platform:'macos'`, badge/overlay gating, `needsAdmin:false`, missing-helper repair guidance + badge limitation, register refusal, overlay caching without helper spawn (`ShellIntegration.ts:171-196,238-261,430-446`).
- [x] **P5** — `secure-json.macos.test.ts`: POSIX `chmod 0o600/0o700` applied on darwin on sync+async paths + `hardenPrivateFile`, and skipped on win32 (platform boundary). Uses forced platform + mocked fs/fs-promises so it is deterministic on every host (`secure-json.ts`).
- [ ] **P6** — `local-status-server.macos.test.ts`: Unix-domain-socket path + POSIX `chmod` vs Windows named pipe (`local-status-server.ts:32-38,118,132,164`).
- [ ] **P7** — `pathResolution.macos.test.ts`: macOS case-preserving paths vs Windows lowercasing, separator `/` (`svn-cache-service.ts:50`).
- [ ] **P8** — `lifecycle.macos.test.ts`: `window-all-closed` no-quit on darwin, `activate` dock-window recreation, hidden titleBar chrome (`index.ts:97-99,218-220,225-229`). Hardest; may need a small extraction.
- [ ] **P9** — `tests/e2e/macos-integrations.spec.ts` (`test.skip(process.platform !== 'darwin')`): smoke-test app launch, dock/activate, native open-dialog, Finder-status IPC.

## Done condition

When P1–P9 are committed and a final full `bunx vitest run` + `bun run typecheck`
are green, stop the loop (`CronDelete` / `ScheduleWakeup stop`) and summarize.
The recurring job's 7-day auto-expiry is the backstop.
