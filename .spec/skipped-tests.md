# Skipped Test Triage

Generated: 2026-05-01

Current baseline: 28 skipped tests. The CI guard in `scripts/check-skipped-tests.mjs` fails if this count increases or if skips are added outside this inventory.

## Decisions

| Area | Files | Count | Decision |
| --- | --- | ---: | --- |
| Auth cache persistence and concurrency | `src/main/__tests__/auth-cache.test.ts` | 3 | Move remaining skipped persistence and concurrency tests to Node-environment tests with real temporary files and mocked `safeStorage`; keep skipped until the test environment is split. |
| Validation filesystem checks | `src/main/utils/__tests__/validation.test.ts` | 4 | Move to Node-environment tests with temp files, directories, and size fixtures. |
| External tool execution | `src/main/ipc/__tests__/external.test.ts` | 1 | Replace broad fs mock with scoped temporary executable fixtures. |
| Real SVN service workflows | `src/main/services/__tests__/svn-working-copy.real.test.ts`, `src/main/services/__tests__/svn-release-workflows.real.test.ts` | 2 | Keep conditional skips until CI has `svn` and `svnadmin` installed consistently for real repository integration coverage. |
| Sparse checkout renderer flows | `src/renderer/__tests__/CheckoutDialog.sparse.test.tsx`, `src/renderer/__tests__/UpdateToRevisionDialog.sparse.test.tsx`, `src/renderer/__tests__/integration/sparse-checkout.test.tsx`, `src/renderer/__tests__/ChooseItemsDialog.test.tsx`, `src/renderer/__tests__/RepoBrowser.add-to-wc.test.tsx` | 8 | Rebuild around stable dialog/test helpers and mocked IPC; prioritize after sparse checkout behavior is frozen. |
| Progress UI and hooks | `src/renderer/__tests__/ProgressIndicator.test.tsx` | 2 | Unskip after replacing timer-sensitive assertions with deterministic fake timers and accessibility queries. |
| Commit history and templates | `src/renderer/src/hooks/__tests__/useCommitMessageHistory.test.ts`, `src/renderer/src/hooks/__tests__/useCommitMessageHistory.test.ts` | 2 | Re-enable after store and preload mocks match current app metadata APIs. |
| E2E file and SVN operations | `tests/e2e/file-operations.spec.ts`, `tests/e2e/svn-operations.spec.ts` | 5 | Keep conditional skips until CI has a disposable SVN repository fixture and platform-stable filesystem paths. |
| E2E conflict resolution | `tests/e2e/conflict-resolution.spec.ts` | 1 | Keep conditional skip until CI has `svn` and `svnadmin` available for the disposable conflict repository fixture. |
| E2E keyboard a11y gaps | `tests/e2e/keyboard-interactions.spec.ts` | 2 | Escape-to-dismiss and focus-trap are known accessibility gaps; keep skipped until modal keyboard handling lands. |
| E2E macOS-only integration | `tests/e2e/macos-integrations.spec.ts` | 1 | Platform-guarded (`process.platform !== 'darwin'`); runs only on macOS where the native integrations exist. |

## Follow-Up Order

1. Split Node-only main-process tests out of jsdom and unskip auth cache plus validation filesystem coverage.
2. Stabilize renderer IPC/dialog mocks and unskip sparse checkout component tests.
3. Add an e2e SVN fixture repository and CI SVN toolchain setup so the Playwright and real SVN integration skips can become real coverage.
4. Reduce `BASELINE_SKIPS` in `scripts/check-skipped-tests.mjs` after each unskip batch.
