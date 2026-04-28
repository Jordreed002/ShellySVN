# Refactor and Codebase Improvement Tasks

Generated: 2026-04-28

These tasks turn the codebase structure review into executable work. The order matters: contract and service boundaries should be stabilized before large renderer components are split.

---

## Phase 1 - Shared Contracts and Workspace Boundaries

- [x] Move `src/shared` into `packages/shared` or remove `src/shared/package.json`.
  - Why: `@shellysvn/shared` currently looks like a package but is not included by the root workspace.
  - Acceptance: root `package.json` includes the shared package, imports resolve through one package path, and `bun run typecheck` passes.

- [x] Replace duplicated logic-engine SVN types with imports from the shared package.
  - Files: `packages/logic-engine/src/svn/types.ts`, `src/shared/types.ts`.
  - Acceptance: `packages/logic-engine/src/svn/types.ts` is deleted or reduced to package-local extensions only.

- [x] Define a typed IPC channel contract in shared code.
  - Suggested file: `packages/shared/src/ipc-contract.ts`.
  - Acceptance: channel names, argument tuples, and return types are defined once and consumed by main, preload, and renderer type declarations.

- [x] Split the preload bridge by domain.
  - Files: `src/preload/index.ts`, new `src/preload/api/*.ts`.
  - Acceptance: `index.ts` only composes bridge modules and exposes `window.api`; behavior remains unchanged.
  - Completed: preload domains now live under `src/preload/api`, with `index.ts` composing the bridge.

---

## Phase 2 - Main Process SVN Service Split

- [x] Extract SVN XML/diff parsers out of `src/main/ipc/svn.ts`.
  - Suggested files: `src/main/svn/parsers/status.ts`, `info.ts`, `log.ts`, `diff.ts`, `list.ts`, `blame.ts`.
  - Acceptance: parser tests import parser modules directly, not IPC modules.
  - Completed: parser implementations live in `src/main/svn/parsers.ts` and IPC imports them.

- [x] Extract checkout and checkout progress handling.
  - Suggested file: `src/main/services/svn-checkout.ts`.
  - Acceptance: `svn:checkout`, `svn:checkoutWithProgress`, and `svn:cancelCheckout` handlers delegate to this service.

- [x] Extract working-copy operations.
  - Suggested file: `src/main/services/svn-working-copy.ts`.
  - Scope: status, info, update, update item, update to revision, cleanup, revert, add, delete, move, rename.
  - Acceptance: command assembly and error mapping live in the service, while IPC only maps request/response.

- [x] Extract history and review operations.
  - Suggested file: `src/main/services/svn-history.ts`.
  - Scope: log, diff, streaming diff, blame, revision helpers.
  - Acceptance: history-related tests do not need to register IPC handlers.

- [x] Extract repository metadata operations.
  - Suggested file: `src/main/services/svn-metadata.ts`.
  - Scope: properties, externals, changelists, shelves, locks, diagnostics.
  - Acceptance: `src/main/ipc/svn.ts` becomes a thin registration layer under roughly 300 lines.
  - Completed: metadata, locks, diagnostics, patches, commit, and repository mutation operations now delegate to services. `src/main/ipc/svn.ts` is reduced to 441 lines; remaining work is further compaction of handler registration if the 300-line target remains strict.

---

## Phase 3 - Renderer Feature Boundaries

- [x] Split `FileExplorer.tsx` into a view component plus controller hooks.
  - Suggested files: `useFileExplorerQueries.ts`, `useFileExplorerSelection.ts`, `useFileExplorerCommands.ts`, `FileExplorerDialogs.tsx`.
  - Acceptance: `FileExplorer.tsx` primarily renders layout and wires hook outputs to child components.
  - Completed: auth prompt rendering, credential controller logic, selection state, and keyboard navigation now live in focused files hooks/components; file status helpers were already moved to `features/files`.

- [x] Move file status derivation and cache invalidation helpers out of `FileExplorer.tsx`.
  - Suggested file: `src/renderer/src/features/files/fileStatus.ts`.
  - Acceptance: helper functions have focused unit tests and are reusable by dialogs or route components.

- [x] Split `SettingsDialog.tsx` into tab panels.
  - Suggested files: `SettingsGeneralPanel.tsx`, `SettingsSvnPanel.tsx`, `SettingsDiffMergePanel.tsx`, `SettingsAuthPanel.tsx`, `SettingsAdvancedPanel.tsx`.
  - Acceptance: the parent owns tab selection and save/cancel flow only.
  - Completed: settings tab content now lives in `components/settings/SettingsPanels.tsx`; the parent dialog owns tab selection, shell integration modal state, and save/cancel flow.

- [x] Split large SVN dialogs by controller and view where they exceed roughly 500 lines.
  - Initial targets: `AddRepoModal.tsx`, `CheckoutDialog.tsx`, `CommitDialog.tsx`, `EnhancedDiffViewer.tsx`, `ConflictResolutionWizard.tsx`.
  - Acceptance: data loading and mutation logic move into hooks; presentational components receive typed props.
  - Completed: `CheckoutDialog` delegates authentication and SSL prompt views to typed presentational components, and `CommitDialog` now delegates status loading, selection, validation, templates/history, issue links, diff loading, and submit flow to `components/commit/useCommitDialogController.ts`.

---

## Phase 4 - Quality Gates and Test Coverage

- [x] Convert lint warnings that indicate bugs or accessibility failures into fixed code.
  - Initial targets: label/control association, invalid ARIA props, render-time side effects, no-shadow in critical modules.
  - Acceptance: `bun run lint` reports no accessibility warnings in production UI components.
  - Completed: production renderer JSX accessibility warnings are cleared; remaining lint output is non-accessibility backlog such as hook dependency, no-shadow, and style warnings.

- [x] Fix `RepoBrowserEnhanced` mount initialization.
  - File: `src/renderer/src/components/ui/RepoBrowserEnhanced.tsx`.
  - Acceptance: replace render-time `useState(() => initialize())` with `useEffect`; add or update a focused test.

- [x] Expand coverage include patterns for renderer feature logic.
  - File: `vitest.config.ts`.
  - Acceptance: extracted hooks/helpers from Phase 3 are included in coverage thresholds.

- [x] Raise coverage thresholds after module extraction.
  - Acceptance: new thresholds reflect current passing coverage and cannot regress without deliberate updates.
  - Completed: global thresholds now enforce lines 50, functions 40, branches 55, and statements 50 against the current passing baseline.

- [x] Add architecture boundary checks.
  - Suggested checks: renderer must not import main/preload modules; main must not import renderer modules; logic-engine must not duplicate shared types.
  - Acceptance: CI fails on forbidden imports or duplicated contract files.

---

## Phase 5 - Documentation and Cleanup

- [x] Align README architecture with the real runtime path.
  - Acceptance: docs clearly distinguish Electron main-process SVN execution from the standalone Bun logic engine CLI.

- [x] Fix mojibake characters in README and `.spec` reports.
  - Acceptance: box drawing/checkmark characters render correctly, or are replaced with ASCII.

- [x] Document the intended module ownership rules.
  - Suggested file: `.spec/architecture-boundaries.md`.
  - Acceptance: contributors can tell where IPC contracts, SVN command logic, renderer feature logic, and shared types belong.

- [x] Add a short migration note for each completed phase.
  - Acceptance: future work can tell which behavior moved and which public APIs stayed stable.
