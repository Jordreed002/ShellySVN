# ShellySVN - Unlinked Functionality Tasks

> **Analysis Date:** March 10, 2026
> **Summary:** Found 40+ unlinked UI components, dialogs, and backend functions

---

## 🔴 HIGH PRIORITY - Dialogs Exist, Just Need Wiring

These dialogs are fully implemented but not connected to the context menu or toolbar:

### Task 1: Connect Branch/Tag Dialog
- **Component:** `src/renderer/src/components/ui/BranchTagDialog.tsx`
- **IPC:** `svn.copy` (implemented in `src/main/ipc/svn.ts`)
- **Action:** Wire `BranchTagDialog` to context menu `onBranchTag` callback in `FileRow.tsx`
- **Location:** `src/renderer/src/components/ui/FileRow.tsx` line ~219
- **Details:** Dialog allows creating branches and tags from working copy

### Task 2: Connect Switch Dialog
- **Component:** `src/renderer/src/components/ui/SwitchDialog.tsx`
- **IPC:** `svn.switch` (implemented)
- **Action:** Wire `SwitchDialog` to context menu `onSwitch` callback
- **Details:** Switch working copy to different branch/tag URL

### Task 3: Connect Merge Wizard
- **Component:** `src/renderer/src/components/ui/MergeWizard.tsx`
- **IPC:** `svn.merge` (implemented)
- **Action:** Wire `MergeWizard` to context menu `onMerge` callback
- **Details:** Full merge workflow with revision range selection

### Task 4: Connect Relocate Dialog
- **Component:** `src/renderer/src/components/ui/RelocateDialog.tsx`
- **IPC:** `svn.relocate` (implemented)
- **Action:** Wire `RelocateDialog` to context menu `onRelocate` callback
- **Details:** Relocate working copy to new repository URL

### Task 5: Connect Blame Viewer
- **Component:** `src/renderer/src/components/ui/BlameViewer.tsx`
- **IPC:** `svn.blame` (implemented)
- **Action:** Wire `BlameViewer` to context menu `onBlame` callback
- **Details:** Show line-by-line annotation with author/revision info

### Task 6: Connect Properties Dialog
- **Component:** `src/renderer/src/components/ui/PropertiesDialog.tsx`
- **IPC:** `svn.proplist`, `svn.propset`, `svn.propdel` (all implemented)
- **Action:** Wire `PropertiesDialog` to context menu `onProperties` callback
- **Details:** View/edit/delete SVN properties on files/directories

### Task 7: Connect Changelist Dialog
- **Component:** `src/renderer/src/components/ui/ChangelistDialog.tsx`
- **IPC:** `svn.changelist.*` (add, remove, list, create, delete - all implemented)
- **Action:** Wire `ChangelistDialog` to context menu `onChangelist` callback
- **Details:** Manage changelists for organizing commit groups

### Task 8: Connect Create Patch Dialog
- **Component:** `src/renderer/src/components/ui/CreatePatchDialog.tsx`
- **IPC:** `svn.patch.create` (implemented)
- **Action:** Wire to context menu `onCreatePatch` callback
- **Details:** Generate patch file from local changes

### Task 9: Connect Apply Patch Dialog
- **Component:** `src/renderer/src/components/ui/ApplyPatchDialog.tsx`
- **IPC:** `svn.patch.apply` (implemented)
- **Action:** Wire to context menu `onApplyPatch` callback
- **Details:** Apply patch file to working copy

### Task 10: Connect Ignore Dialog
- **Component:** `src/renderer/src/components/ui/IgnoreDialog.tsx`
- **IPC:** Uses `svn.propset` for svn:ignore
- **Action:** Wire `IgnoreDialog` to context menu `onAddToIgnore` callback
- **Details:** Add files/patterns to svn:ignore list

---

## 🟡 MEDIUM PRIORITY - Partial Implementations

### Task 11: Expose Shelve Dialog in UI
- **Component:** `src/renderer/src/components/ui/ShelveDialog.tsx` (exists)
- **IPC:** `svn.shelve.*` (list, save, apply, delete - all implemented)
- **Issue:** No menu item, toolbar button, or context menu entry opens it
- **Action:** Add to context menu for directories, add to Command Palette

### Task 12: Add Shell Integration to Settings
- **Component:** `src/renderer/src/components/ui/ShellIntegrationDialog.tsx` (exists)
- **IPC:** `shell.register`, `shell.unregister`, `shell.isRegistered` (implemented)
- **Issue:** Dialog exists but no way to access it from Settings
- **Action:** Add "Shell Integration" section to SettingsDialog

### Task 13: Add Quick Notes Panel Trigger
- **Component:** `src/renderer/src/components/ui/QuickNotesPanel.tsx` (exists)
- **Issue:** No toolbar button or menu to open the panel
- **Action:** Add toolbar button, add to View menu, add to Command Palette

### Task 14: Fix Sidebar Search
- **File:** `src/renderer/src/components/Sidebar.tsx` line 309
- **Issue:** Search input has placeholder but no onChange handler
- **Action:** Implement repository filtering functionality

### Task 15: Wire Lock/Unlock to Context Menu
- **Components:** `LockManagementDialog.tsx` exists, uses `svn.lockForce`/`svn.unlockForce`
- **Issue:** Context menu defines `onGetLock`/`onReleaseLock` but uses `onManageLocks` instead
- **Action:** Add direct Lock/Unlock options alongside Manage Locks

### Task 16: Connect Revision Graph
- **Component:** `src/renderer/src/components/ui/RevisionGraph.tsx` (exists)
- **Issue:** Not connected to context menu `onRevisionGraph`
- **Action:** Wire to context menu for versioned directories

### Task 17: Connect Repo Browser
- **Component:** `src/renderer/src/components/ui/RepoBrowser.tsx`, `RepoBrowserEnhanced.tsx` (exist)
- **Issue:** Not connected to context menu `onRepoBrowser`
- **Action:** Wire to context menu for directories

### Task 18: Connect Export Dialog
- **Component:** `src/renderer/src/components/ui/ExportDialog.tsx` (exists)
- **IPC:** `svn.export` (implemented)
- **Issue:** Only in `BatchOperationsBar`, not in file context menu
- **Action:** Add to context menu for directories

### Task 19: Connect Import Dialog
- **Component:** `src/renderer/src/components/ui/ImportDialog.tsx` (exists)
- **IPC:** `svn.import` (implemented)
- **Issue:** No entry point in UI
- **Action:** Add to File menu or toolbar

### Task 20: Connect Cleanup to Context Menu
- **IPC:** `svn.cleanup` (implemented, used in `useSvnActions`)
- **Issue:** Context menu defines `onCleanup` but not wired in FileRow
- **Action:** Add Cleanup option for directories with issues

---

## 🟢 LOWER PRIORITY - Backend/API Cleanup

### Task 21: Implement External Diff Tool
- **IPC:** `external.openDiffTool` (implemented)
- **Settings:** `diffMerge.externalDiffTool` exists in settings
- **Action:** Wire settings to actually call external diff tool instead of built-in viewer

### Task 22: Implement External Merge Tool
- **IPC:** `external.openMergeTool` (implemented)
- **Settings:** `diffMerge.externalMergeTool` exists in settings
- **Action:** Wire settings to call external merge tool for conflicts

### Task 23: Apply Proxy Settings to SVN
- **Settings:** `proxySettings` defined in `AppSettings`
- **IPC:** `SvnExecutionContext.proxySettings` exists
- **Issue:** Proxy settings not passed to SVN commands
- **Action:** Pass proxy settings from store to SVN execution context

### Task 24: Apply SSL Settings to SVN
- **Settings:** `sslVerify`, `clientCertificatePath` defined
- **Issue:** Not passed to SVN commands
- **Action:** Pass SSL settings to SVN execution context

### Task 25: Apply Connection Timeout
- **Settings:** `connectionTimeout` defined
- **Issue:** Not used in SVN operations
- **Action:** Pass timeout to SVN command execution

### Task 26: Implement System Notifications
- **Settings:** `notifications.enableSystemNotifications` defined
- **Issue:** No notification implementation
- **Action:** Add Electron notification support for commit/update completion

### Task 27: Show Auth Encryption Status
- **IPC:** `auth.isEncryptionAvailable` (implemented)
- **Issue:** Never called, status not shown to user
- **Action:** Display encryption status in Settings > Authentication

### Task 28: Implement Cache Management UI
- **IPC:** `app.clearCache`, `app.getCacheSize` (implemented)
- **Issue:** No UI to view/clear cache
- **Action:** Add to Settings > Advanced section

### Task 29: Implement File Picker Dialog
- **IPC:** `dialog.openFile`, `dialog.saveFile` (implemented)
- **Issue:** Never used (dialogs use custom file browser)
- **Action:** Consider using for patch file selection, certificate selection

### Task 30: Implement Drive Listing
- **IPC:** `fs.listDrives` (implemented for Windows)
- **Issue:** Never called
- **Action:** Use in Sidebar for drive quick access on Windows

---

## 🔵 COMMAND PALETTE EXPANSION

### Task 31: Add Missing Commands to Palette
Current Command Palette only has basic SVN operations. Add:

- [ ] Branch/Tag...
- [ ] Switch...
- [ ] Merge...
- [ ] Relocate...
- [ ] Blame
- [ ] Properties
- [ ] Create Patch
- [ ] Apply Patch
- [ ] Lock/Unlock
- [ ] Changelist
- [ ] Shelve/Unshelve
- [ ] Export
- [ ] Import
- [ ] Repo Browser
- [ ] Revision Graph

**File:** `src/renderer/src/components/ui/CommandPalette.tsx`

---

## 📊 SUMMARY

| Category | Count |
|----------|-------|
| High Priority (wire existing dialogs) | 10 |
| Medium Priority (partial implementations) | 10 |
| Lower Priority (backend cleanup) | 10 |
| Command Palette expansion | 1 |
| **Total Tasks** | **31** |

---

## QUICK START - Top 5 Tasks

If you only have time for a few, start with these for maximum impact:

1. **Task 1:** Connect BranchTagDialog - most commonly used advanced feature
2. **Task 5:** Connect BlameViewer - frequently requested feature
3. **Task 11:** Expose ShelveDialog - unique SVN 1.10+ feature
4. **Task 12:** Add Shell Integration to Settings - improves OS integration
5. **Task 31:** Expand Command Palette - improves overall discoverability

---

## FILES TO MODIFY

Primary files that need changes:

```
src/renderer/src/components/ui/FileRow.tsx        # Context menu wiring
src/renderer/src/components/FileExplorer.tsx      # Action handlers
src/renderer/src/components/ui/CommandPalette.tsx # Add commands
src/renderer/src/components/ui/SettingsDialog.tsx # Add shell integration
src/renderer/src/components/Sidebar.tsx           # Fix search
```

---

*Generated by AI analysis of ShellySVN codebase*
