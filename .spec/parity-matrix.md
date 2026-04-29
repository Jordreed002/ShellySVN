# ShellySVN Parity Matrix

Generated: 2026-04-29

Sources:

- `.spec/spec.md`
- `.spec/tortoisesvn-parity-roadmap.md`
- `.spec/tasks.md`
- Current implementation scan of `src/`, `packages/shared/`, and `tests/`

Status values:

- `complete` - implemented and represented by code/tests or completed tracking items
- `partial` - implementation exists but has missing platform coverage, missing workflow polish, or incomplete verification
- `missing` - no meaningful implementation found
- `needs manual verification` - code exists, but the parity claim depends on real SVN repositories, packaged builds, or OS integration
- `out of scope` - explicitly excluded by product spec or parity roadmap

---

## Replacement-Critical Matrix

| Area | Parity item | Status | Evidence | Next task |
| --- | --- | --- | --- | --- |
| File manager integration | Windows Explorer context menu commands | partial | `src/main/shell/ShellIntegration.ts`, `src/renderer/src/components/ui/ShellIntegrationDialog.tsx`, `.spec/tasks.md` still lists Windows commands unchecked | Implement and package-test native helper coverage |
| File manager integration | Windows Explorer status overlays | partial | Overlay IPC and cache exist in `ShellIntegration.ts`; native helper and packaged validation remain unchecked | Verify helper installation, registration, and status coverage |
| File manager integration | macOS Finder Sync context menus | missing | `ShellIntegration.ts` throws when Finder Sync helper is missing | Implement Finder Sync extension or document release blocker |
| File manager integration | macOS Finder badges | missing | Finder Sync helper not present; roadmap item unchecked | Implement supported badge set and fallback behavior |
| File manager integration | Diagnostics and repair actions | partial | Settings and shell dialog surface registration state; package/native helper diagnostics still incomplete | Add health details and repair guidance tied to actual helper status |
| Core workflows | Open working copy and local file browsing | partial | `FileExplorer`, monitor IPC, filesystem IPC, status APIs, virtualization components | Verify with real working copies and status edge cases |
| Core workflows | Local vs remote status checks | complete | `.spec/tasks.md` marks explicit local-vs-remote status checks complete; `svn:statusRemote` contract exists | Keep covered in status regression tests |
| Core workflows | Checkout with sparse checkout | partial | `CheckoutDialog`, `ChooseItemsDialog`, sparse checkout tests, checkout progress service | Verify auth, SSL trust, depth, cancellation, and packaged binaries |
| Core workflows | Update revision/depth/ignore externals/force/progress/cancel | complete | `.spec/tasks.md` marks update options, progress, and cancellation complete; `UpdateDialog`, `updateWithProgress`, `cancelUpdate` exist | Add real-SVN workflow verification |
| Core workflows | Revert, cleanup, resolve, add, delete, move, copy, rename | partial | IPC contracts and dialogs/actions exist; destructive explanation and parity verification remain open | Verify each route from toolbar, context menu, command palette |
| Core workflows | Working-copy upgrade detection and guided upgrade | complete | `.spec/tasks.md` marks complete; IPC contract includes `workingCopyUpgradeStatus` and `upgradeWorkingCopy` | Keep in regression suite |
| Core workflows | Sparse, externals, nested, and switched status display | partial | Sparse status exists; `.spec/tasks.md` still lists display improvements unchecked | Add visual/status coverage for all edge cases |

## Commit Workflow Matrix

| Area | Parity item | Status | Evidence | Next task |
| --- | --- | --- | --- | --- |
| Commit | File selection parity | complete | `.spec/tasks.md` marks commit file selection parity complete; `CommitDialog` and controller surface rich status state | Add broad E2E coverage if missing |
| Commit | Templates and history | complete | `.spec/tasks.md` marks packaged template/history work complete; `useCommitMessageHistory`, `useCommitTemplates`, `CommitTemplateManager` exist | Unskip or replace skipped hook tests |
| Commit | Minimum message length | complete | `.spec/tasks.md` marks complete; `commitRules.ts` has validation tests | Keep rules covered |
| Commit | Required issue ID validation | complete | `.spec/tasks.md` marks complete; `commitRules.ts`, `CommitDialog`, issue settings UI | Keep issue rules covered |
| Commit | Spellcheck | complete | `.spec/tasks.md` marks complete; `CommitDialog` sets `spellCheck={true}` | Manual UI smoke test |
| Commit | Path and keyword autocomplete | complete | `.spec/tasks.md` marks complete; `commitAutocomplete` tests and `AutoCompleteInput` integration | Keep utility coverage |
| Commit | Warnings for mixed revisions, switched paths, locks, externals | complete | `.spec/tasks.md` marks complete; commit warning utilities exist | Verify warning visibility in E2E |
| Commit | Hook output | partial | Hook executor exists; parity roadmap requires clear surfacing when configured | Verify UI handling and settings behavior |
| Commit | Commit progress and cancellation | partial | `commitWithProgress` and generic `cancelOperation` contracts exist; `.spec/tasks.md` still lists commit progress/cancel unchecked | Wire and verify UI progress/cancel path |

## Diff, Merge, Conflict, and Patch Matrix

| Area | Parity item | Status | Evidence | Next task |
| --- | --- | --- | --- | --- |
| Diff | Unified text diff | partial | `DiffViewer`, `EnhancedDiffViewer`, `VirtualizedDiffViewer`, `svn:diff` exist | Verify added/deleted/renamed/copied/property/binary cases |
| Diff | Side-by-side text diff | missing | Roadmap item unchecked; no clear side-by-side text diff mode surfaced | Implement or record defer decision |
| Diff | Image diff | partial | `ImageDiffViewer` exists with multiple modes | Verify supported formats and real before/after workflows |
| Diff | External diff tool | partial | Settings and `external:openDiffTool` exist | Add per-extension overrides and executable validation evidence |
| Merge | Merge wizard | partial | `MergeWizard`, `mergeWithProgress`, `cancelOperation` contracts exist; `.spec/tasks.md` still lists merge progress/cancel unchecked | Verify dry-run, progress, cancel, conflict summary |
| Conflict | Guided resolve | partial | `ResolveDialog`, `ConflictResolutionWizard`, `TreeConflictDialog`, `ThreeWayMergeEditor` exist | Harden save/revert behavior and real conflict tests |
| Conflict | External merge tool | partial | Settings and `external:openMergeTool` exist | Add per-extension overrides and missing-tool UX tests |
| Patch | Create/apply patch | partial | `CreatePatchDialog`, `ApplyPatchDialog`, `svn-patch.ts` exist | Add dry-run output, reject visibility, binary-safe failure coverage |
| Documents | Office/document diff strategy | missing | Explicit decision task remains open | Decide supported integration vs external-tool handoff vs non-goal |

## History, Review, and Analytics Matrix

| Area | Parity item | Status | Evidence | Next task |
| --- | --- | --- | --- | --- |
| History | Revision log filtering | complete | `.spec/tasks.md` marks complete; `LogViewer`, `logFilters.ts`, `logFilters.test.ts` exist | Verify with large real logs |
| History | Log cache for large repositories | complete | `.spec/tasks.md` marks complete; log cache hooks/services present | Verify invalidation and cache management |
| History | Issue links and issue ID column | complete | `.spec/tasks.md` marks complete; `LogViewer` issue link rendering and issue tracker utilities exist | Keep issue display tests |
| History | Branch/tag comparison | missing | `.spec/tasks.md` lists unchecked | Implement comparison workflow |
| History | Merge-tracking log view | missing | `.spec/tasks.md` lists unchecked | Implement merge-aware history mode |
| Blame | Line-level revision, author, date | partial | `BlameViewer` and `svn:blame` exist | Add log-message context and real blame verification |
| Revision graph | Branch, tag, copy, merge visualization | partial | `RevisionGraph` exists; `.spec/tasks.md` lists improvement unchecked | Improve and verify graph semantics |
| Analytics | Project statistics | missing | `.spec/tasks.md` lists unchecked | Implement or defer explicitly |

## Repository Browser, Branching, and Advanced SVN Matrix

| Area | Parity item | Status | Evidence | Next task |
| --- | --- | --- | --- | --- |
| Repository browser | Remote browsing | partial | Repo browser route/components and `svn:list` exist | Verify protocols, auth, SSL, SSH, revision selector |
| Repository browser | Prefetch/caching | missing | `.spec/tasks.md` lists bounded repository browser prefetch/caching unchecked | Add bounded cache/prefetch design |
| Repository browser | Remote create/delete/rename/move/copy | missing | No completed task evidence for remote mutation workflows | Add browser mutation actions with commit messages |
| Sparse checkout | Selective checkout and add-to-working-copy | partial | Sparse checkout tests/components exist; README advertises workflows | Verify mixed-depth and remote-only edge cases |
| Branch/tag | Create branch/tag | partial | `BranchTagDialog`, `svn:copy`, command palette/context menu integration exist | Verify validation and real SVN behavior |
| Switch/relocate | Switch and relocate | partial | `SwitchDialog`, `RelocateDialog`, IPC contracts exist | Verify nested switched paths and root relocation |
| Advanced SVN | Properties, externals, locks, shelving | partial | Dialogs and IPC contracts exist; verification remains open | Verify add/edit/delete/list workflows against real SVN |

## Issue Tracker Matrix

| Area | Parity item | Status | Evidence | Next task |
| --- | --- | --- | --- | --- |
| Issue tracker | Per-project config | complete | `.spec/tasks.md` marks complete; `useIssueTrackerConfig.ts` exists | Keep settings migration covered |
| Issue tracker | Configurable regex and URL templates | complete | `.spec/tasks.md` marks complete; `issueTracker.ts` tests | Keep parser tests |
| Issue tracker | Commit issue field or message parser | complete | `.spec/tasks.md` marks complete; commit dialog settings and parser utilities exist | Verify UI behavior |
| Issue tracker | Required issue warnings | complete | `.spec/tasks.md` marks complete; `commitRules.ts` tests | Keep validation covered |
| Issue tracker | Issue links in commit/log/blame | complete | `.spec/tasks.md` marks complete | Verify with configured tracker |
| Issue tracker | TortoiseSVN `bugtraq:` compatibility | complete | `.spec/tasks.md` marks common and inherited `bugtraq:` discovery complete; utility tests exist | Add real working-copy property fixture if missing |

## Auth, Security, Diagnostics, and Packaging Matrix

| Area | Parity item | Status | Evidence | Next task |
| --- | --- | --- | --- | --- |
| Auth | Per-realm credentials | partial | `auth-cache.ts`, auth IPC, encryption checks exist | Verify across all SVN operations |
| Auth | Persistent encryption and no silent plaintext | complete | `.spec/tasks.md` and `.spec/issues.md` mark resolved | Keep safeStorage tests |
| Auth | Credential edit/delete/clear | partial | Auth IPC supports delete/clear/list; settings UI needs verification | Verify settings workflows |
| Network | Proxy, timeout, SSL trust, client certificate | partial | Settings and SVN executor support exist; SSL consolidation marked complete | Verify every SVN operation path |
| Security | Redaction in logs/diagnostics | complete | `.spec/tasks.md` marks command redaction and diagnostic redaction complete | Add support export regression tests |
| Security | Filesystem IPC scoping | partial | `.spec/issues.md` marks sensitive operations partially resolved | Finish broader read/list permission model |
| Diagnostics | SVN binary, bundled resources, encryption, shell status | partial | Diagnostics panel/export marked complete; shell/Finder health still partial | Expand shell/Finder diagnostics and repair actions |
| Packaging | Binary verification | complete | `.spec/tasks.md` marks prepackage verification complete; scripts exist | Keep package verification in CI |
| Packaging | Packaged-app smoke tests | missing | `.spec/tasks.md` lists unchecked | Add Windows/macOS/Linux packaged smoke tests |

## Explicit Non-Goals and Deferred Items

| Item | Status | Rationale |
| --- | --- | --- |
| Git integration | out of scope | `.spec/spec.md` says ShellySVN is not a Git client |
| Server-side repository administration tools | out of scope | Product spec and parity roadmap exclude server administration |
| Exact clone of every TortoiseSVN Windows shell command | out of scope | Parity roadmap requires platform-native workflow parity, not one-for-one cloning |
| Linux parity equal to Windows/macOS | out of scope for replacement bar | Parity roadmap says Linux is not equal priority for now; `.spec/spec.md` keeps Linux as packaging-supported where available |
| Full TortoiseSVN settings compatibility | partial/deferred | Useful but not blocking in parity roadmap |
| Legacy TortoiseSVN command URL compatibility | partial/deferred | Useful but not blocking in parity roadmap |
| Built-in SubWCRev equivalent | partial/deferred | Useful but not blocking in parity roadmap |
| Group policy deployment controls | partial/deferred | Useful but not blocking in parity roadmap |

---

## Immediate Follow-Up

1. Use this matrix as the source of truth for checking off P0 baseline tasks in `.spec/PARITY_ROADMAP_TASKS.md`.
2. Promote `partial` and `missing` replacement-critical rows into `.spec/tasks.md` when implementation begins.
3. Do not mark OS integration rows complete until verified in packaged builds on the target OS.
4. Do not mark real-SVN workflow rows complete from static code inspection alone.
