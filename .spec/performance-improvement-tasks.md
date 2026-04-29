# Performance Improvement Tasks

Generated: 2026-04-29

These tasks turn the current performance review into executable work. The first phase fixes correctness issues that also affect performance measurements; later phases add real profiling coverage and optimize large-repository paths.

Baseline checks from the review:

- `bun run typecheck` passed.
- `bunx vitest run src/renderer/__tests__/performance/sparse-checkout.perf.test.tsx` passed.
- `bun run build` passed.
- Renderer build currently emits two large initial chunks around 1.05 MB and 1.16 MB.

---

## Phase 1 - Sparse Tree Correctness and Cache Behavior

- [x] Fix lazy tree node loaded state.
  - Files: `src/renderer/src/hooks/useLazyTreeLoader.ts`.
  - Problem: directory nodes created from `svn list --depth immediates` are marked `isLoaded: true`, so expanding a directory can return early before loading children.
  - Acceptance: expandable directory nodes are not considered loaded until their children are fetched or the node is known to have no children.
  - Verification: add or update a `useLazyTreeLoader` test that expands a directory and proves `window.api.svn.list` is called for that path.

- [x] Use one consistent TanStack Query key for tree reads, writes, invalidation, and prefetch.
  - Files: `src/renderer/src/hooks/useLazyTreeLoader.ts`.
  - Problem: root reads use `['svn:tree', rootUrl, username]`, while child load success/error updates use `['svn:tree', rootUrl]`.
  - Acceptance: loaded child data appears in the active query cache for authenticated and unauthenticated repositories.
  - Verification: focused unit test plus `bun run typecheck`.

- [x] Avoid mutating cached tree nodes in place.
  - Files: `src/renderer/src/hooks/useLazyTreeLoader.ts`.
  - Problem: `setQueryData` shallow-copies the root array but mutates the nested parent node.
  - Acceptance: child insertion returns new objects along the updated path so React Query subscribers receive stable immutable updates.
  - Verification: unit test confirms the previous cached tree object is not mutated.

---

## Phase 2 - Sparse Tree Render-Time Work

- [x] Precompute tree selection metadata instead of recursively scanning visible rows.
  - Files: `src/renderer/src/components/ui/VirtualizedList.tsx`.
  - Problem: `getTriState` calls `getAllDescendantPaths` during render for each visible row, allocating arrays and walking subtrees repeatedly.
  - Acceptance: tri-state rendering uses memoized descendant counts or indexed parent/child metadata, with no recursive descendant allocation inside each row render.
  - Verification: add a perf/unit test for a large expanded tree with nested selection and keep existing checkbox behavior tests passing.

- [x] Cache flattened tree rows and selection state together.
  - Files: `src/renderer/src/components/ui/VirtualizedList.tsx`.
  - Problem: virtualization limits DOM nodes, but flattening and selection derivation still scale with expanded tree size.
  - Acceptance: expanding/collapsing and selection changes avoid unnecessary full-tree recomputation where the affected subtree is small.
  - Verification: add benchmark coverage for 10k and 50k loaded nodes using the real flatten/selection code.

- [x] Make sparse checkout search input non-blocking.
  - Files: `src/renderer/src/components/ui/ChooseItemsDialog.tsx`.
  - Problem: filtering the full loaded tree runs synchronously on each keystroke.
  - Acceptance: search uses `useDeferredValue`, debounce, or an indexed search path so typing stays responsive on 10k+ loaded nodes.
  - Verification: update the sparse checkout perf test to cover rapid typing and real filter work.

- [x] Fix sparse checkout selection statistics.
  - Files: `src/renderer/src/components/ui/ChooseItemsDialog.tsx`.
  - Problem: selection stats walk `Array.from(nodes.values())` and then recurse children, which can duplicate nested counting.
  - Acceptance: file count is derived once from roots or an indexed map without double-counting.
  - Verification: add a unit test with nested files where selecting a parent reports the exact file count.

---

## Phase 3 - File Explorer Large Directory Responsiveness

- [x] Split file derivation, filtering, searching, and sorting into reusable helpers.
  - Files: `src/renderer/src/components/FileExplorer.tsx`, new helper under `src/renderer/src/features/files/`.
  - Problem: `FileExplorer.tsx` does large synchronous array transforms inline.
  - Acceptance: pure helpers cover file derivation, ignore filtering, search filtering, and sorting with focused tests.
  - Verification: helper tests plus `bun run typecheck`.

- [x] Reduce per-keystroke search cost in the file list.
  - Files: `src/renderer/src/components/FileExplorer.tsx`.
  - Problem: each search lowercases the query inside the filter loop and scans every path synchronously.
  - Acceptance: lowercased searchable fields are cached per entry or search is deferred so input remains responsive on large directories.
  - Verification: add a performance test for search over 10k and 50k entries.

- [x] Precompile global ignore patterns only when settings change.
  - Files: `src/renderer/src/components/FileExplorer.tsx`, `src/renderer/src/features/files/`.
  - Problem: ignore regexes are recreated inside the main filtered entries memo along with unrelated sort/search changes.
  - Acceptance: regex compilation depends only on `settings.globalIgnorePatterns`.
  - Verification: helper unit test for glob behavior and profiler evidence that sort/search does not recompile regexes.

- [x] Optimize sorting metadata for large directories.
  - Files: `src/renderer/src/components/FileExplorer.tsx`, `src/renderer/src/features/files/`.
  - Problem: sort-by-name repeatedly splits paths during comparison.
  - Acceptance: basename and normalized sortable fields are computed once per entry before sort comparisons.
  - Verification: benchmark helper compares current target sizes without regressing sort behavior.

---

## Phase 4 - Expensive Background Work

- [x] Bound folder-size requests.
  - Files: `src/renderer/src/hooks/useFolderSizes.ts`, main-process folder-size IPC implementation.
  - Problem: all visible folder paths are joined into one large query key and requested in one batch.
  - Acceptance: folder size requests are chunked, cancellable or scoped to visible rows, and query keys stay bounded.
  - Verification: test 1k directory entries without oversized query keys or long blocking requests.

- [ ] Add cancellation and progress reporting to remaining long-running SVN operations.
  - Files: `src/main/services/*`, `src/main/ipc/svn.ts`, preload SVN API.
  - Problem: long operations can tie up process and renderer state without enough feedback.
  - Acceptance: commit, merge, export/import, and deep status operations either expose progress/cancel or explicitly document why they cannot.
  - Verification: focused service tests and renderer flow tests for cancellation.

- [x] Stream or cap large SVN command output where possible.
  - Files: `src/main/services/svn-executor.ts`, SVN service callers.
  - Problem: `runSvn` accumulates full stdout/stderr strings for all operations, which can increase memory pressure for large logs/diffs/status output.
  - Acceptance: callers that can process chunks use streaming callbacks or explicit output caps.
  - Verification: unit test for capped output and a large-output service test.

---

## Phase 5 - Real Performance Instrumentation

- [ ] Add real browser/Electron performance coverage for large lists and trees.
  - Files: `tests/e2e/`, `tests/playwright.config.ts`, or a dedicated benchmark script.
  - Problem: current sparse checkout perf tests mock `@tanstack/react-virtual`, so they do not measure Chromium layout, scroll, memory, or real virtualization behavior.
  - Acceptance: automated benchmark opens the built app or dev app, renders a large list/tree fixture, scrolls it, and records render time, FPS, and DOM node count.
  - Verification: CI-friendly perf smoke test with thresholds that are loose enough to avoid flakes but strict enough to catch regressions.

- [x] Expose performance dashboard only when useful.
  - Files: `src/renderer/src/hooks/usePerformanceMonitor.ts`, `src/renderer/src/components/ui/PerformanceDashboard.tsx`, relevant settings/UI entry point.
  - Problem: monitoring every frame and memory interval has its own overhead if enabled broadly.
  - Acceptance: FPS/memory monitoring is opt-in or scoped to diagnostics/performance views, while operation timing remains lightweight.
  - Verification: unit test confirms inactive monitoring does not schedule RAF or intervals.

- [x] Add bundle analysis to the build workflow.
  - Files: `package.json`, Vite/Electron build config.
  - Problem: renderer build has large chunks, but there is no repeatable bundle report.
  - Acceptance: a script produces a bundle size report and identifies top modules in the initial renderer chunks.
  - Verification: `bun run analyze:bundle` writes `reports/bundle/renderer-bundle-report.{json,md}`.
  - Current result: the initial renderer entry is about 1.0 MiB raw / 197 KiB gzip; top app modules are settings panels, add-repository modal, and plugin manager, so those are the next dynamic-import candidates.

---

## Recommended Execution Order

1. Phase 1 first, because sparse tree correctness affects both UX and the validity of performance tests.
2. Phase 2 next, because sparse checkout is already covered by a perf suite and has clear large-tree risks.
3. Phase 5 instrumentation before deep tuning, so future changes are measured in a real renderer.
4. Phase 3 and Phase 4 as targeted improvements based on measured large-repository scenarios.
