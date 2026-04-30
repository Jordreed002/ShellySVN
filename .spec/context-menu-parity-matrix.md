# Context Menu Parity Matrix

This matrix tracks TortoiseSVN-style right-click action parity across ShellySVN surfaces.

| Surface | Current Interaction | Covered Actions | Gaps / Follow-up |
| --- | --- | --- | --- |
| File explorer | Native app context menu via `getSvnContextMenuItems` on file rows | Update, commit, revert, resolve, add, ignore, delete, lock/unlock, changelist, branch/tag, switch, merge, log, revision graph, diff, preview, blame, properties, patch, repo browser, export/import, relocate, cleanup, open in Explorer, copy path | Keep shell-specific wording platform aware: Explorer vs Finder. |
| Repository browser | Selection details panel and toolbar-style actions | Checkout, add to working copy, show log, open in browser, create folder, delete, move/rename, copy | Add right-click menu over repository rows if users expect browser parity without selecting first. |
| History / log viewer | Inline revision actions | Open changed path, view diff for revision, copy revision metadata through selectable UI | Add explicit right-click menu for revisions and changed paths if workflow testing shows repeated use. |
| Diff viewers | Toolbar and keyboard actions | Search, next/previous match, view mode controls, copy line/content where supported | Add line-level context menu for copy line, copy hunk, open file, and blame from line. |
| Project monitor | Panel controls | Start/stop monitoring, refresh status, open working copy from panel controls | Add context menu for monitored working copies: open, update, commit, show log, remove from monitor. |
| Windows Explorer shell | Shell helper registration and command handoff | Planned/partial shell integration surface for working-copy actions | Validate command coverage separately in Windows shell integration tasks. |
| macOS Finder Sync | Finder extension registration and command handoff | Planned/partial Finder integration surface for working-copy actions | Validate command coverage separately in Finder Sync integration tasks. |

## Baseline Action Set

Common working-copy surfaces should expose these actions when their preconditions are met:

- Update
- Commit
- Revert
- Resolve
- Add
- Delete
- Lock / unlock
- Show log
- Diff / preview
- Blame
- Properties
- Branch / tag
- Switch
- Merge
- Cleanup
- Create / apply patch
- Open in system file manager
- Copy path

## Parity Rule

If an action is reachable from a toolbar or command palette but not from the relevant context menu, record the gap here before adding a new workflow. If the surface intentionally uses an inline details panel instead of a context menu, the matrix must name the equivalent control.
