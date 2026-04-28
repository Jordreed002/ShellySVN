# Large Module Split Plan

Updated: 2026-04-28

## Goal

Reduce the risk of changes in the largest files by extracting stable services and UI subcomponents without changing product behavior.

## `src/main/ipc/svn.ts`

Completed first extraction:

- `src/main/services/svn-executor.ts` now owns SVN process spawning.

Next boundaries:

- `src/main/services/svn-checkout.ts`: checkout, sparse checkout, checkout progress, cancel checkout.
- `src/main/services/svn-working-copy.ts`: status, info, update, cleanup, revert, add, delete, move.
- `src/main/services/svn-history.ts`: log, blame, diff, mergeinfo, revision helpers.
- `src/main/services/svn-properties.ts`: properties, externals, changelists, shelves.
- `src/main/ipc/svn.ts`: retain only IPC registration and request/response mapping.

## `src/renderer/src/components/FileExplorer.tsx`

Next boundaries:

- `FileExplorerToolbarActions.tsx`: toolbar command state and action dispatch.
- `FileExplorerSelection.ts`: selection derivation, multi-select helpers, context-menu target derivation.
- `FileExplorerStatus.ts`: status refresh, deep scan, and watcher coordination.
- `FileExplorerDialogs.tsx`: modal orchestration and lazy component loading.

## `src/renderer/src/components/ui/SettingsDialog.tsx`

Next boundaries:

- `SettingsSvnPanel.tsx`: SVN binary, working-copy format, SSL, proxy, certificate settings.
- `SettingsAuthPanel.tsx`: auth cache and encryption status.
- `SettingsIntegrationPanel.tsx`: shell integration, deep links, notifications.
- `SettingsAdvancedPanel.tsx`: diagnostics and developer toggles.

## Acceptance criteria

- Each extracted module has a focused public surface.
- Existing IPC channel names and renderer props remain stable during extraction.
- Typecheck, lint, skipped-test baseline, and focused tests pass after every extraction commit.
