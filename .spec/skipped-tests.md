# Skipped Test Triage

Updated: 2026-08-08

The current exact inventory is **9 direct `.skip` references**, **10 `skipIf` modifiers**, and
**1 `runIf` modifier**. `scripts/check-skipped-tests.mjs` scans `src`, `packages`, and `tests` and
fails if any per-file count is added, removed, or changed without an accompanying inventory update.

Direct `.skip` references include runtime-conditional Playwright calls and two toolchain-gated
Vitest suite aliases. The term “direct” describes the syntax, not whether the test always skips at
runtime. Conditional modifiers are tracked separately so adding `skipIf` or `runIf` cannot bypass
the guard.

## Direct `.skip` Inventory

| File                                                             | Count | Condition and decision                                                                                                                                                |
| ---------------------------------------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/services/__tests__/svn-release-workflows.real.test.ts` |     1 | `describeIfSvn` selects `describe.skip` when the SVN toolchain is absent. Keep until every supported test environment provides `svn` and `svnadmin`.                  |
| `src/main/services/__tests__/svn-working-copy.real.test.ts`      |     1 | `describeIfSvn` selects `describe.skip` when the SVN toolchain is absent. Keep for the same toolchain portability requirement.                                        |
| `tests/e2e/conflict-resolution.spec.ts`                          |     1 | Runtime skip when `svn` or `svnadmin` is unavailable. Keep while local E2E remains runnable without that optional toolchain.                                          |
| `tests/e2e/file-operations.spec.ts`                              |     3 | Runtime skips when environment setup does not produce the required SVN working-copy state. Replace with explicit fixture capabilities as the E2E harness is hardened. |
| `tests/e2e/macos-integrations.spec.ts`                           |     1 | Platform guard; the test runs only on macOS.                                                                                                                          |
| `tests/e2e/svn-operations.spec.ts`                               |     2 | Runtime skips when the disposable SVN repository setup is unavailable. Keep until the fixture is mandatory for this suite.                                            |
| **Total**                                                        | **9** |                                                                                                                                                                       |

## Conditional Modifier Inventory

| File                                                               | Form     |  Count | Condition and decision                                         |
| ------------------------------------------------------------------ | -------- | -----: | -------------------------------------------------------------- |
| `src/integration/__tests__/svn-restore-excluded.real.test.ts`      | `runIf`  |      1 | Runs only when an SVN toolchain is available.                  |
| `src/main/ipc/__tests__/fs.test.ts`                                | `skipIf` |      1 | Windows-only drive-navigation behavior.                        |
| `src/main/services/__tests__/code-editors.macos.test.ts`           | `skipIf` |      1 | macOS-only application discovery behavior.                     |
| `src/main/services/__tests__/code-editors.test.ts`                 | `skipIf` |      2 | POSIX executable and login-shell behavior; skipped on Windows. |
| `src/main/services/__tests__/external-tool-registry.macos.test.ts` | `skipIf` |      1 | macOS-only `.app` bundle behavior.                             |
| `src/main/services/__tests__/svn-release-workflows.real.test.ts`   | `skipIf` |      2 | Requires `svnserve` and a non-Windows execution path.          |
| `src/main/services/__tests__/svn-working-copy.real.test.ts`        | `skipIf` |      1 | POSIX-specific symlink scenario; skipped on Windows.           |
| `src/main/utils/__tests__/approved-paths.test.ts`                  | `skipIf` |      1 | POSIX path/permission behavior; skipped on Windows.            |
| `src/main/utils/__tests__/process-tree.test.ts`                    | `skipIf` |      1 | POSIX process-tree termination; skipped on Windows.            |
| **Total**                                                          |          | **11** | **10 `skipIf`, 1 `runIf`**                                     |

## Governance

1. Prefer fixing or capability-gating the test over adding a skip.
2. Every direct `.skip`, `skipIf`, or `runIf` must appear in both the executable inventory and the
   tables above, with a concrete runtime condition and removal criterion.
3. Adding a skip requires an explicit test-triage decision in the same change.
4. Removing a skip requires deleting its inventory entry in the same change; the guard deliberately
   fails on stale allowlist entries.
5. Platform-specific tests may remain conditional when running them elsewhere would not exercise
   meaningful product behavior. Toolchain conditionals should be removed when that toolchain becomes
   a guaranteed suite prerequisite.

## Follow-up Order

1. Make the disposable SVN repository fixture mandatory for SVN-focused Playwright projects, then
   remove their runtime `test.skip` calls.
2. Decide whether real-SVN Vitest suites belong in the default test command or a required dedicated
   job; remove the `describe.skip` aliases once their chosen environment guarantees the toolchain.
3. Keep platform-only `skipIf` guards, but ensure CI includes the matching Windows and macOS jobs so
   those tests execute somewhere.
