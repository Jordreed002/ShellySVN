# Implemented Parity Feature Map

Generated: 2026-04-29

Purpose: Cross-reference implemented or partially implemented parity features with their renderer entry points, preload APIs, main IPC handlers, service modules, and known tests. Missing rows in a column mean the feature exists at a different layer only, or the reference was not found during this pass.

This map is evidence for the P0 roadmap task: "Map every implemented parity feature to renderer entry point, preload API, main IPC handler, service method, and tests."

---

## Core SVN Operations

| Feature | Renderer entry point | Preload API | Main IPC | Service/module | Tests |
| --- | --- | --- | --- | --- | --- |
| Local status | `FileExplorer`, `useIncrementalStatus`, `StatusBar` | `window.api.svn.status` | `svn:status` | `svn-working-copy.getStatus` | `src/main/__tests__/svn/*`, `src/main/services/__tests__/svn-working-copy.test.ts` |
| Remote status | File explorer remote/status controls | `window.api.svn.statusRemote` | `svn:statusRemote` | `svn-working-copy.getRemoteStatus` | status/parser tests, remote display tests |
| Working-copy info/context | File explorer, repo browser sparse actions | `window.api.svn.info`, `infoUrl`, `getWorkingCopyContext` | `svn:info`, `svn:infoUrl`, `svn:getWorkingCopyContext` | `svn-working-copy.getInfo`, `getInfoUrl`, `getWorkingCopyContext` | SVN parser/operation tests |
| Working-copy upgrade | Add/open repo flows and diagnostics | `workingCopyUpgradeStatus`, `upgradeWorkingCopy` | `svn:workingCopyUpgradeStatus`, `svn:upgradeWorkingCopy` | `svn-working-copy.getWorkingCopyUpgradeStatus`, `upgradeWorkingCopy` | `svn-working-copy.test.ts` |
| Checkout | `AddRepoModal`, `CheckoutDialog`, sparse checkout dialogs | `checkout`, `checkoutWithProgress`, `cancelCheckout` | `svn:checkout`, `svn:checkoutWithProgress`, `svn:cancelCheckout` | `svn-checkout.checkout`, `checkoutWithProgress`, `cancelCheckout` | `svn-checkout.test.ts`, checkout/sparse renderer tests |
| Sparse checkout item update | `ChooseItemsDialog`, repo browser, file explorer remote items | `updateToRevision`, `updateItem`, `list` | `svn:updateToRevision`, `svn:updateItem`, `svn:list` | `svn-working-copy.updateToRevision`, `updateItem`; `svn-metadata.listRepository` | sparse checkout unit/e2e tests |
| Update | `UpdateDialog`, toolbar/context actions | `update`, `updateWithProgress`, `cancelUpdate` | `svn:update`, `svn:updateWithProgress`, `svn:cancelUpdate` | `svn-working-copy.update`, `updateWithProgress`, `cancelUpdate` | `svn-working-copy.test.ts`, update dialog tests |
| Commit | `CommitDialog`, `useCommitDialogController`, `useSvnActions` | `commit`, `commitWithProgress`, `cancelOperation` | `svn:commit`, `svn:commitWithProgress`, `svn:cancelOperation` | `svn-commit.commit`, `commitWithProgress`; `svn-progress.cancelSvnOperation` | commit rules/autocomplete/warnings tests; main SVN tests |
| Revert | `CommitDialog`, `FileExplorer`, context menu | `revert` | `svn:revert` | `svn-working-copy.revert` | main SVN operation tests |
| Add | `FileExplorer`, context menu, command palette | `add` | `svn:add` | `svn-working-copy.add` | main SVN operation tests |
| Delete | `FileExplorer`, context menu, command palette | `delete` | `svn:delete` | `svn-working-copy.remove` | main SVN operation tests |
| Cleanup | `FileExplorer`, cleanup suggestions/dialogs | `cleanup` | `svn:cleanup` | `svn-working-copy.cleanup` | main SVN operation tests |
| Move/rename | `MoveRenameDialog`, file explorer, dual-pane view | `move`, `rename` | `svn:move`, `svn:rename` | `svn-working-copy.move`, `rename` | main SVN handler tests |

## Commit Workflow

| Feature | Renderer entry point | Preload/API | Main/service | Tests |
| --- | --- | --- | --- | --- |
| Commit file selection and filtering | `CommitDialog`, `useCommitDialogController` | `svn.status`, `svn.diff`, `svn.commit` | `svn-working-copy.getStatus`, `svn-history.getDiff`, `svn-commit.commit` | commit controller dependencies, renderer tests where present |
| Changelist visibility in commit | `CommitDialog` file rows and filters | `svn.status`, `svn.changelist.*` | `svn-working-copy.getStatus`, `svn-metadata.changelist*` | changelist IPC/main tests |
| Commit message templates | `CommitDialog`, `CommitTemplateManager`, `useCommitTemplates` | `store:get`, `store:set` | store IPC/settings persistence | `useCommitMessageHistory.test.ts` is currently skipped |
| Commit message history | `CommitDialog`, `useCommitMessageHistory` | `store:get`, `store:set`, `store:delete` | store IPC/settings persistence | `useCommitMessageHistory.test.ts` is currently skipped |
| Minimum length and required issue ID | `CommitDialog` rules UI, `useCommitRules` | store APIs | renderer utilities | `commitRules.test.ts` |
| Commit warnings | `CommitDialog`, `commitWarnings.ts` | status data | renderer utilities | `commitWarnings.test.ts` |
| Commit autocomplete | `AutoCompleteInput`, `commitAutocomplete.ts`, `suggestionEngine.ts` | none | renderer utilities | `commitAutocomplete.test.ts` |
| Issue links in commit message | `CommitDialog`, `issueTracker.ts` | `app.openExternal` | external URL validation path | `issueTracker.test.ts` |

## History, Review, and Diff

| Feature | Renderer entry point | Preload API | Main IPC | Service/module | Tests |
| --- | --- | --- | --- | --- | --- |
| Log/history | `LogViewer`, `CommitHistory`, history route | `svn.log` | `svn:log` | `svn-history.getLog` | `logFilters.test.ts`, SVN parser/history tests |
| Log filtering | `LogViewer`, `logFilters.ts` | none | none | renderer utility | `logFilters.test.ts` |
| Issue links in log | `LogViewer`, `issueTracker.ts` | `app.openExternal` | app/external URL handlers | renderer utility plus app IPC | `issueTracker.test.ts`, `logFilters.test.ts` |
| Diff | `DiffViewer`, `EnhancedDiffViewer`, `VirtualizedDiffViewer` | `svn.diff`, `svn.diffStreaming` | `svn:diff`, `svn:diffStreaming` | `svn-history.getDiff`, `getDiffStreaming`, `diff-parser` | `diff-parser.test.ts`, parser tests |
| Image diff | `ImageDiffViewer`, `DiffViewer` | `fs.readImageAsBase64`, `svn.diff` | `fs:readImageAsBase64`, `svn:diff` | filesystem IPC, diff service | image utility tests where present |
| Blame | `BlameViewer` | `svn.blame` | `svn:blame` | `svn-history.getBlame` | `src/main/__tests__/svn/blame.test.ts` |
| Revision graph | `RevisionGraph` | `svn.log` | `svn:log` | `svn-history.getLog` | renderer graph tests not identified |
| Patch create | `CreatePatchDialog` | `svn.patch.create`, `dialog.saveFile` | `svn:patch:create` | `svn-patch.createPatch` | service/main tests not identified |
| Patch apply | `ApplyPatchDialog` | `svn.patch.apply`, `dialog.openFile` | `svn:patch:apply` | `svn-patch.applyPatch` | service/main tests not identified |

## Branching, Merging, Conflicts, and Repository Ops

| Feature | Renderer entry point | Preload API | Main IPC | Service/module | Tests |
| --- | --- | --- | --- | --- | --- |
| Branch/tag | `BranchTagDialog`, command palette, context menu | `svn.copy` | `svn:copy` | `svn-repository-ops.copyRepositoryItem` | SVN handler tests |
| Switch | `SwitchDialog`, command palette, context menu | `svn.switch` | `svn:switch` | `svn-repository-ops.switchWorkingCopy` | SVN handler tests |
| Merge | `MergeWizard`, command palette, context menu | `svn.merge`, `svn.mergeWithProgress`, `cancelOperation` | `svn:merge`, `svn:mergeWithProgress`, `svn:cancelOperation` | `svn-repository-ops.mergeRepositoryRange`, `mergeRepositoryRangeWithProgress`, `svn-progress` | `svn-progress.test.ts`, handler tests |
| Relocate | `RelocateDialog`, command palette, context menu | `svn.relocate` | `svn:relocate` | `svn-repository-ops.relocateWorkingCopy` | handler tests |
| Resolve | `ResolveDialog`, `ConflictResolutionWizard`, `TreeConflictDialog` | `svn.resolve`, `external.openMergeTool` | `svn:resolve`, `external:openMergeTool` | `svn-repository-ops.resolveConflict`, external IPC | handler/external tests |
| Three-way merge editor | `ThreeWayMergeEditor` | `fs.readFile`, `fs.writeFile` | filesystem IPC | filesystem IPC | renderer tests not identified |
| Repository browser | repo-browser route, `RepoBrowser`, `RepoBrowserEnhanced` | `svn.list`, `svn.infoUrl`, `svn.updateToRevision` | `svn:list`, `svn:infoUrl`, `svn:updateToRevision` | `svn-metadata.listRepository`, `svn-working-copy.updateToRevision` | repo browser/sparse tests |
| Export | `ExportDialog`, command palette/context menu | `svn.export`, `svn.exportWithProgress` | `svn:export`, `svn:exportWithProgress` | `svn-repository-ops.exportRepository`, `exportRepositoryWithProgress` | handler tests |
| Import | `ImportDialog`, command palette/context menu | `svn.import`, `svn.importWithProgress` | `svn:import`, `svn:importWithProgress` | `svn-repository-ops.importRepository`, `importRepositoryWithProgress` | handler tests |

## Advanced SVN

| Feature | Renderer entry point | Preload API | Main IPC | Service/module | Tests |
| --- | --- | --- | --- | --- | --- |
| Properties | `PropertiesDialog`, context menu | `proplist`, `propset`, `propdel` | `svn:proplist`, `svn:propset`, `svn:propdel` | `svn-metadata.proplist`, `propset`, `propdel` | metadata/parser tests |
| Externals | `ExternalsManager` | `externals.list`, `externals.add`, `externals.remove` | `svn:externals:list`, `svn:externals:add`, `svn:externals:remove` | `svn-metadata.externals*` | metadata tests not fully identified |
| Changelists | `ChangelistDialog`, commit dialog | `changelist.*` | `svn:changelist:*` | `svn-metadata.changelist*` | metadata/handler tests |
| Locks | `LockManagementDialog`, context menu | `lock`, `unlock`, `lockInfo`, `lockForce`, `unlockForce`, `lockList` | `svn:lock`, `svn:unlock`, `svn:lockInfo`, `svn:lockForce`, `svn:unlockForce`, `svn:lockList` | `svn-locks.*` | lock tests not fully identified |
| Shelving | `ShelveDialog` | `shelve.list`, `shelve.save`, `shelve.apply`, `shelve.delete` | `svn:shelve:*` | `svn-metadata.shelve*` | metadata tests not fully identified |

## Settings, Auth, Diagnostics, and Integration

| Feature | Renderer entry point | Preload/API | Main IPC | Service/module | Tests |
| --- | --- | --- | --- | --- | --- |
| Settings persistence | `SettingsDialog`, `SettingsPanels`, `useSettings` | `store:get`, `store:set`, `store:delete` | store IPC | `settings-manager` | store/settings tests |
| Diff/merge tool settings | `DiffMergeSettingsTab`, `DiffViewer`, `ResolveDialog` | `external.openDiffTool`, `external.openMergeTool` | `external:openDiffTool`, `external:openMergeTool` | external IPC, settings manager | `external.test.ts` |
| Auth cache | auth settings and repository prompts | `auth:get`, `auth:set`, `auth:delete`, `auth:list`, `auth:clear`, `auth:isEncryptionAvailable` | `auth:*` | `auth-cache` | `auth-cache.test.ts`, auth IPC tests |
| SSL trust prompts | `CheckoutPrompts`, checkout/update flows | checkout/update option payloads | SVN operation IPC | `svn-checkout`, SVN executor SSL helpers | checkout/security tests |
| Proxy/timeout/client cert settings | settings panels | settings store plus SVN APIs | SVN handlers | `settings-manager`, `svn-executor` | settings/executor tests |
| Repository diagnostics | `RepoDiagnostics`, settings/support surfaces | `svn.diagnostics` | `svn:diagnostics` | `svn-diagnostics.getDiagnostics` | diagnostics tests where present |
| Redacted diagnostics | `ErrorBoundary`, diagnostic export surfaces | app/store APIs | app/diagnostics IPC | redaction utilities | redaction tests |
| Shell integration UI | `ShellIntegrationDialog`, `IntegrationSettingsTab` | `shell.register`, `shell.unregister`, `shell.isRegistered`, overlay APIs | `shell:*` | `ShellIntegrationManager` | shell-specific tests not identified |
| Notifications | operation hooks/settings | `notification.show` | `notification:show` | `NotificationService` | notification tests where present |
| Deep links | `useDeepLinks` | deep-link event bridge | protocol handler | `protocol-handler` | protocol handler tests |

## Test Gaps Exposed by This Map

- Commit template and history hook tests exist but are skipped; parity should not rely on them as full verification.
- Shell/Finder integration has implementation surfaces but lacks native packaged verification.
- Patch workflows lack clear reject/dry-run verification coverage.
- Revision graph and three-way merge editor need direct renderer behavior tests.
- Real-SVN integration is still required for working-copy, conflict, branch/tag, merge, externals, locks, and repository browser parity.
