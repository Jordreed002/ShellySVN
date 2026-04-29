# README Feature Claim Parity Audit

Generated: 2026-04-29

Purpose: Identify README feature claims that are implemented, partially implemented, missing, not reachable, or not covered by verification. This audit should be updated before public release and whenever README feature claims change.

Status values:

- `covered` - implemented and represented in the parity map or completed tracking tasks
- `partial` - implementation exists, but verification, platform coverage, or workflow completeness is still missing
- `overclaimed` - README wording implies stronger shipped behavior than current evidence supports
- `stale` - README conflicts with current spec decisions or package metadata
- `needs verification` - likely implemented, but requires real SVN, packaged app, or OS-level validation

---

## Summary

The README broadly matches the implemented app surface, but several claims should not be treated as release-ready until verification catches up. The biggest gaps are native shell/Finder parity, packaged binary confidence across platforms, large-repository performance claims, conflict/merge polish, and logic-engine architecture wording.

---

## Product Position Claims

| README claim | Status | Notes | Follow-up |
| --- | --- | --- | --- |
| "A modern, standalone Subversion client for macOS and Windows" | partial | App is Electron-based and cross-platform, but first-class macOS Finder integration is missing and Windows shell integration still needs packaged verification. | Avoid "best choice" or full replacement language until OS integration is verified. |
| "Inspired by TortoiseSVN, rebuilt for today" | covered | Matches `.spec/tortoisesvn-parity-roadmap.md`; not a clone. | Keep as positioning. |
| "Bundling everything you need with zero external dependencies" | partial | Packaging scripts verify bundled binaries, but platform binaries may not be present in a local checkout and packaged smoke tests are still open. | Qualify for release artifacts or keep gated behind binary verification. |
| "Native experience on both macOS and Windows" | overclaimed | Native-feeling Electron UI exists, but native file-manager integration is incomplete, especially macOS Finder Sync. | Reword or keep as target until Finder/Explorer integration passes packaged tests. |

## Core SVN Operations Claims

| README claim | Status | Notes | Follow-up |
| --- | --- | --- | --- |
| Browse files with real-time SVN status indicators | partial | File explorer and status APIs exist; edge cases still need real working-copy verification. | Verify all status states from parity matrix. |
| File explorer with filtering, sorting, and search | needs verification | File explorer surface exists; this audit did not verify every control. | Add UI/e2e coverage reference before marking covered. |
| Thumbnail previews for images | partial | Thumbnail IPC and components exist. | Verify supported formats and limits. |
| Commit, Update, Revert, Add, Delete | partial | APIs and UI exist; update is stronger than commit due to progress/cancel completion. | Verify toolbar/context/command-palette reachability and real SVN behavior. |
| Checkout including sparse checkout | partial | Checkout and sparse workflows exist with tests; real SVN/auth/SSL/package verification still needed. | Keep as feature, mark release gate in parity tasks. |
| Export and Import | partial | APIs/dialogs/progress services exist. | Verify progress/cancel UI and real SVN results. |
| Lock and Unlock files | partial | Lock APIs/dialogs exist. | Verify stale-lock/owner workflows. |
| Cleanup working copy | partial | API/dialog/action exists. | Verify destructive explanation and common cleanup scenarios. |

## History, Diff, Branching, and Advanced Claims

| README claim | Status | Notes | Follow-up |
| --- | --- | --- | --- |
| Commit history viewer with filtering | covered | Log filtering is marked complete in `.spec/tasks.md` and represented in `LogViewer`/`logFilters`. | Verify large real logs before release. |
| Unified diff viewer with syntax highlighting | partial | Diff components exist, but renamed/copied/property/binary cases and large diff behavior need verification. | Add diff matrix tests. |
| Blame/annotate view | partial | `BlameViewer` and `svn:blame` exist. | Add log-message context and real blame verification. |
| Revision graph visualization | partial | `RevisionGraph` exists, but branch/tag/copy/merge semantics need improvement. | Keep roadmap item open. |
| Branch/Tag creation wizard | partial | Dialog and `svn:copy` path exist. | Verify validation and real SVN behavior. |
| Merge wizard with revision range selection | partial | Wizard exists; progress/cancel/conflict summary remain open. | Do not claim full merge parity yet. |
| Switch between branches | partial | Dialog and IPC exist. | Verify nested switched paths. |
| Relocate working copies | partial | Dialog and IPC exist. | Verify repository-root relocation flows. |
| Changelists support | partial | Changelist APIs and commit visibility exist. | Verify create/delete/list with real SVN. |
| Shelve/Unshelve | partial | APIs/dialog exist. | Verify minimum SVN version and behavior. |
| Properties editor | partial | Dialog and APIs exist. | Verify property helpers and common properties. |
| Externals manager | partial | Dialog and APIs exist. | Verify edit/update and status behavior. |
| Patch creation and application | partial | Dialogs/services exist. | Add dry-run/reject visibility coverage. |
| Conflict resolution wizard | partial | Wizard/dialogs exist. | Harden conflict editor save/revert and real conflict tests. |
| Hook scripts configuration | partial | Hook executor/UI references exist. | Verify hook order, output, and security expectations. |

## Sparse Checkout Claims

| README claim | Status | Notes | Follow-up |
| --- | --- | --- | --- |
| Selective checkout of specific files and folders | partial | Implemented surface and tests exist. | Verify against real repositories and mixed-depth states. |
| Lazy-loading tree browser with search | partial | Components/tests exist. | Verify large repository performance. |
| Add remote items to existing working copy | partial | Repo browser and update-to-revision paths exist. | Verify files, folders, and mixed-depth parents. |
| Visual toggle for showing remote vs local items | partial | Remote-only status exists. | Verify UI state and status refresh behavior. |
| Update individual items to working copy | partial | `updateItem`/`updateToRevision` APIs exist. | Verify from file explorer and repo browser. |
| Auth prompts appear automatically for protected paths | needs verification | Auth prompt components exist. | Verify protected path workflows across checkout/repo browser/sparse update. |

## User Experience and Performance Claims

| README claim | Status | Notes | Follow-up |
| --- | --- | --- | --- |
| Command Palette quick access to all actions | partial | Command palette exists and many actions are wired. | Complete command parity matrix before calling "all actions". |
| Keyboard Shortcuts | partial | Shortcut hooks/dialog exist. | Verify coverage and disabled states. |
| Bookmarks | partial | Bookmark manager exists. | Verify persistence and startup interactions. |
| Project Monitor | partial | Monitor APIs/panel exist. | Verify multiple working copies and refresh behavior. |
| Quick Notes | partial | Quick notes panel exists. | Verify revision/commit annotation workflows. |
| Settings Sync | overclaimed | Settings persistence exists, but "sync" implies cross-device or account sync; no evidence found. | Rename to "Settings persistence" unless sync exists. |
| Virtualized Lists for 60fps scrolling with 10,000+ files | overclaimed | Virtualization exists; performance tests exist, but the exact 60fps/10,000+ claim needs benchmark evidence. | Keep as target or link benchmark results. |
| Lazy Loading | partial | Lazy loading exists for sparse/repo browser/status areas. | Verify bounded concurrency and cancellation. |
| Background Scanning | partial | Background status/folder-size scanning exists. | Verify it does not block active SVN operations. |
| Cached History | covered | Marked complete in `.spec/tasks.md`. | Verify cache invalidation before release. |

## Architecture and Roadmap Claims

| README claim | Status | Notes | Follow-up |
| --- | --- | --- | --- |
| Logic engine is a production architecture path | stale | `.spec/adr-logic-engine.md` says Electron main remains production backend and logic engine is experimental. | Update README architecture text to match ADR. |
| Linux support in README roadmap | partial | Package metadata includes Linux build scripts, but parity roadmap de-prioritizes Linux compared with Windows/macOS. | Clarify release target and parity priority. |
| Git integration roadmap item | stale | `.spec/spec.md` says ShellySVN is not a Git client; parity task list keeps Git out unless product spec changes. | Remove from parity-adjacent README roadmap or move to wishlist. |
| Merge conflict resolution UI roadmap unchecked | stale | Conflict dialogs already exist, but parity hardening remains. | Change to "Conflict resolution hardening" or similar. |
| Visual diff for images roadmap unchecked | stale | `ImageDiffViewer` exists; verification and polish remain. | Change to "Image diff verification/polish" or mark partial. |
| Plugin/extension system roadmap item | deferred | Product spec has open question; not parity-critical. | Keep in wishlist unless 1.0 scope changes. |
| Dark/light theme customization | partial | Settings include theme and visual settings. | Verify theme coverage and mark accurately. |

## README Cleanup Tasks

- [ ] Fix mojibake characters in navigation, product copy, command comments, and footer.
- [ ] Reword "Settings Sync" unless actual cross-device sync exists.
- [ ] Align logic-engine architecture section with `.spec/adr-logic-engine.md`.
- [ ] Qualify "zero external dependencies" as a release-artifact claim backed by binary verification.
- [ ] Replace exact performance claims with benchmark-backed language or link benchmark evidence.
- [ ] Update roadmap items that are already partially implemented so they describe remaining work.
- [ ] Keep Git integration out of parity language unless `.spec/spec.md` changes.
