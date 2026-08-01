# Windows test loop — runbook

This document is the runbook for the recurring **Windows-focused test loop** that
runs on the `test/expand-coverage-and-strategy` branch. A second agent works on
**macOS-focused tests** on the same branch, so the loop coordinates via
pull-at-start / commit-push-at-end and keeps its tests in disjoint files
(`*.windows.test.ts`, or platform-scoped `describe`s inside shared files).

> If you are a fresh invocation continuing this loop: read this file first, then
> follow the **Per-iteration workflow** below. Progress is tracked by
> `git log --grep="test(win)" --oneline` (conflict-free, survives context resets).

## Current state

The Windows unit suite is **green for all actual code**: a full `bunx vitest run`
on Windows shows `2210 passed`, with the only remaining failures in two
out-of-scope buckets (see [Known out-of-scope failures](#known-out-of-scope-failures)).
Work has therefore moved from *fix-red* to *expand Windows-branch coverage*.

## Per-iteration workflow

1. `git pull --rebase origin test/expand-coverage-and-strategy` — absorb the
   macOS agent's commits. **Never `--force` push.**
2. Pick the next backlog item (see Prioritized backlog). Confirm it isn't already
   done: `git log --grep="test(win): <area>"`.
3. Implement ONE focused area — prefer a new `*.windows.test.ts` file or a
   platform-scoped `describe`. Avoid editing files the macOS agent may touch
   (`*.macos.test.ts`); add an adjacent file instead.
4. Verify: `bunx vitest run <new-file>` (targeted, fast). Run the full suite
   (`bunx vitest run`) only periodically to check for regressions.
5. If green: `git add <files>`; `git commit -m "test(win): <area>"`.
6. `git push origin test/expand-coverage-and-strategy`. On non-fast-forward,
   `git pull --rebase` once more and retry. Still failing → skip the push this
   iteration.
7. Regenerate the tracker when test counts change: `node scripts/generate-test-tracker.mjs`.

## Conflict-safety rules (shared branch with the macOS agent)

- Always `pull --rebase` first; **never** `--force` push; **never** push a
  conflicted or non-green state.
- If a rebase conflicts: `git rebase --abort`, restore a clean tree, and **skip**
  committing/pushing this iteration. Pick a non-overlapping area next loop.
- Keep Windows tests in `*.windows.test.ts` files or new describes, disjoint from
  the macOS agent's `*.macos.test.ts` files, so textual conflicts stay rare.
- Commit prefix is `test(win):` for tests and `fix(win):` for source bug fixes.

## Recurring Windows patterns applied

Most Windows branches fall into a small number of patterns. Reuse these shapes:

- **Skip `accessSync(X_OK)` / world-writable check on win32** — Windows has no
  execute permission bit, so executability is not checked. Force
  `process.platform = 'win32'`, assert the check is not called; force a POSIX
  value to assert it is. (Seen in `code-editors`, `external-tool-registry`,
  `HookExecutor`, `settings-manager`.)
- **Reject `.cmd`/`.bat`/script launchers** — they are a shell-injection /
  arbitrary-command surface. Assert rejection by basename and by extension.
  (`code-editors`, `external-tool-registry`, `settings-manager`.)
- **`.exe` binary resolution** — bundled/helper binaries get a `.exe` suffix on
  win32 and no suffix elsewhere. Assert the resolved name per platform.
  (`packages/logic-engine/.../paths`, `svn-diagnostics`, `ShellIntegration`.)
- **Case-insensitive + separator-agnostic path keys** — caches/lookups keyed by
  path must collapse `\` → `/` and lowercase on win32 (Windows filesystems are
  case-insensitive). Assert `C:\Repo` ≡ `c:/repo`. (`status-service`,
  `svn-cache-service`.)
- **No negative-PID process groups on win32** — termination uses `proc.kill()`
  or `taskkill.exe /T`, never `process.kill(-pid)`. (`process-tree`,
  `HookExecutor`.)
- **Named pipes instead of unix sockets** — `\\.\pipe\...` derived from a hash of
  the user-data path on win32. (`local-status-server`.)
- **`@vitest-environment node` for `vi.mock('node:fs')`** — the jsdom default
  externalizes Node builtins (`__vite-browser-external`) and breaks
  `vi.importActual`; main-process tests mocking `node:fs` need the node env.

## Source bug fixes (production code)

Three genuine Windows bugs were fixed during this loop (commits `fix(win):`):

1. **`svn-portable-shelves.ts`** — `collapseNestedFiles` compared against
   `path.sep`, so nested entries were not collapsed when paths used the forward
   slashes SVN reports. Now compares on a canonical separator (also fixes
   cross-platform portable shelves created on one OS and inspected on another).
2. **`svn-runner.ts` stdin password** — `--password-from-stdin` values were
   terminated with `node:os` `EOL` (`\r\n` on Windows); SVN read until newline
   and included the trailing `\r` in the password, silently breaking auth. Now
   always terminates with `\n`.
3. **`svn-runner.ts` `.cmd`/`.bat` svn wrappers** — `spawn(..., { shell: false })`
   throws `EINVAL` on a `.cmd`/`.bat` launcher (Node CVE-2024-27980). Batch
   launchers are now routed through `cmd.exe /d /s /c` with
   `windowsVerbatimArguments`, keeping `shell: false` so svn args are never
   shell-interpreted.

## Prioritized backlog

- [x] **W1** — `process-tree`: Windows `taskkill.exe` termination (graceful→`/F`,
  no-op early exits, caller grace window).
- [x] **W2** — `code-editors`: `PATHEXT`-based launcher discovery (`code.cmd`),
  bare-launcher preference, custom `PATHEXT`, login-shell skipped on win32;
  `skipIf(win32)` guards on POSIX-only suites.
- [x] **W3** — `svn-portable-shelves`: separator-agnostic collapsing (**source fix**).
- [x] **W4** — `svn-working-copy`: cross-platform URL-mapping tests (ancestor walk,
  nested external).
- [x] **W5** — `auth-cache` / `ssl-trust-cache` / `validation`: `@vitest-environment
  node` + `join()` path expectations.
- [x] **W6** — `svn-runner` / `svn-executor`: LF stdin password (**source fix**) +
  `svnmucc` sibling-path expectation.
- [x] **W7** — `svn-runner` / `svn-worker`: `.cmd`/`.bat` → `cmd.exe` routing to
  avoid `spawn EINVAL` (**source fix**).
- [x] **W8** — `ipc/fs`: `resolve()`-canonicalized path expectation.
- [x] **W9** — `external-tool-registry.validate.test.ts`: shell/script rejection,
  directory rejection, win32 X_OK + world-writable skip.
- [x] **W10** — `ShellIntegration`: win32 helper `.exe`, `needsAdmin`, overlay/badge
  gating, missing-helper repair guidance, register refusal.
- [x] **W11** — `local-status-server`: win32 named-pipe path derivation (hash,
  determinism, distinctness, no raw-path leak).
- [x] **W12** — `HookExecutor.test.ts`: win32 X_OK skip + `proc.kill()` termination
  (no negative-PID signal); argv + exit-code contract.
- [x] **W13** — `protocol-handler.windows.test.ts`: `second-instance` URL dispatch,
  argv launch path, lock-lost quit.
- [x] **W14** — `status-service`: win32 path-key normalization (case + separator)
  for cache lookup and invalidation.
- [x] **W15** — `svn-cache-service`: win32 `clearPath` normalization (case +
  separator, descendant + sibling-prefix safety).
- [x] **W16** — `svn-diagnostics`: win32 `.exe` binary-name resolution.
- [x] **W17** — `settings-manager`: win32 custom-SVN-client rules (`svn.exe`
  default, X_OK skip, `.cmd` rejection at write time).
- [x] **W18** — `chmod 0o600` skip on win32. `auth-cache` and `ipc/store`
  load-time chmod both covered. For `ipc/store`, added a `resetStoreForTests`
  seam (singleton store loads lazily on first handler call), switched the test
  to `@vitest-environment node`, and fixed a latent mock-specifier mismatch
  (store.ts imports bare `'fs/promises'`; the test had mocked `'node:fs/promises'`,
  so the mocks never applied and existing tests passed by real-fs ENOENT).
- [x] **W19** — Sweep for any remaining `process.platform` branches not yet pinned.
  Found and covered `ipc/fs.ts` `getParentPath`: win32 drive-root navigation,
  including the drive-relative → `DRIVES://` branch (exported the pure helper,
  following the existing `getBackgroundStatusScanStateForTests` precedent; the
  file-wide `os.platform` mock is flipped to `win32` per-describe).
- [x] **W20** — `ipc/fs.ts` `listDrives`: win32 `wmic logicaldisk` enumeration —
  parses caption/volumename rows into named drive entries, `Local Disk` fallback,
  empty list on spawn failure. Fixed a latent `child_process` mock wiring bug
  (`default: {}` left `import { spawn }` undefined under CJS interop).
- [x] **W21** — `index.ts` `getPackagedBinaryPaths`: win32 `.exe` suffix on the
  bundled shelly-engine/svn launchers, extension-less on POSIX. Exported the
  pure helper (mirrors `getBackgroundStatusScanStateForTests`); `index.ts`
  lifecycle (`window-all-closed`) was already covered by the macOS agent's
  platform-boundary tests.

## Known out-of-scope failures

These fail on Windows **and macOS** and are not Windows-logic bugs:

- `updater.test.ts`, `update-service.test.ts` — missing `electron-updater` dependency.
- `svnReachability.test.tsx`, `keyboardAccessibility.workflows.test.tsx`,
  `LocalFacts.test.tsx` — missing `framer-motion` dependency.
- `svn-restore-excluded.real.test.ts`, `svn-release-workflows.real.test.ts` — need a
  live `svnserve` daemon; documented as a known weakness in `README.md`.
  Diagnosis (Windows + TortoiseSVN): `svnserve` starts and serves fine, but
  password auth fails with `E170001: Authentication error from server: Password
  incorrect` — the daemon rejects the `reader/secret` credential the test writes
  to `conf/passwd`. Not a connectivity issue, not a CRLF issue (config files now
  use LF). Likely a TortoiseSVN svnserve password-db quirk needing interactive
  diagnosis. The same tests pass on POSIX where `EOL === '\n'` natively.

## Done condition

The Windows unit suite is green for all actual code (achieved). The loop
continues to expand Windows-branch coverage from the backlog until W18–W19 are
either done or deliberately deferred, then stops (`CronDelete`). The recurring
job's 7-day auto-expiry is the backstop.
