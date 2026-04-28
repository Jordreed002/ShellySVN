# Skipped Test Triage

Generated: 2026-04-28

Current baseline: 27 skipped tests. The CI guard in `scripts/check-skipped-tests.mjs` fails if this count increases.

## Decisions

| Area | Files | Count | Decision |
| --- | --- | ---: | --- |
| Auth cache persistence and concurrency | `src/main/__tests__/auth-cache.test.ts` | 4 | Move to Node-environment tests with real temporary files and mocked `safeStorage`; keep skipped until the test environment is split. |
| Validation filesystem checks | `src/main/utils/__tests__/validation.test.ts` | 4 | Move to Node-environment tests with temp files, directories, and size fixtures. |
| External tool execution | `src/main/ipc/__tests__/external.test.ts` | 1 | Replace broad fs mock with scoped temporary executable fixtures. |
| Sparse checkout renderer flows | `src/renderer/__tests__/CheckoutDialog.sparse.test.tsx`, `src/renderer/__tests__/UpdateToRevisionDialog.sparse.test.tsx`, `src/renderer/__tests__/integration/sparse-checkout.test.tsx`, `src/renderer/__tests__/ChooseItemsDialog.test.tsx`, `src/renderer/__tests__/RepoBrowser.add-to-wc.test.tsx` | 8 | Rebuild around stable dialog/test helpers and mocked IPC; prioritize after sparse checkout behavior is frozen. |
| Progress UI and hooks | `src/renderer/__tests__/ProgressIndicator.test.tsx` | 2 | Unskip after replacing timer-sensitive assertions with deterministic fake timers and accessibility queries. |
| Lazy tree loader hook | `src/renderer/__tests__/useLazyTreeLoader.test.tsx` | 1 | Rework as hook-only tests with controlled async tree data. |
| Commit history and templates | `src/renderer/src/hooks/__tests__/useCommitMessageHistory.test.ts`, `src/renderer/src/hooks/__tests__/useCommitMessageHistory.test.ts` | 2 | Re-enable after store and preload mocks match current app metadata APIs. |
| E2E file and SVN operations | `tests/e2e/file-operations.spec.ts`, `tests/e2e/svn-operations.spec.ts` | 5 | Keep conditional skips until CI has a disposable SVN repository fixture and platform-stable filesystem paths. |

## Follow-Up Order

1. Split Node-only main-process tests out of jsdom and unskip auth cache plus validation filesystem coverage.
2. Stabilize renderer IPC/dialog mocks and unskip sparse checkout component tests.
3. Add an e2e SVN fixture repository so the Playwright skips can become real coverage.
4. Reduce `BASELINE_SKIPS` in `scripts/check-skipped-tests.mjs` after each unskip batch.
