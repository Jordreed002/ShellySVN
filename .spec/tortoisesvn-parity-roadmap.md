# TortoiseSVN Parity Roadmap

Generated: 2026-04-28

ShellySVN is intended to be the best SVN client choice on both Windows and macOS. That means matching the workflows users rely on in TortoiseSVN where they matter, while avoiding Windows-only design choices that do not translate well to macOS.

## Product Position

ShellySVN should not be a clone of TortoiseSVN. It should provide:

- first-class Windows Explorer integration
- first-class macOS Finder integration
- a full standalone app for workflows that are awkward from a file manager
- reliable bundled SVN tooling
- modern diagnostics, cancellation, progress, and test coverage
- approachable SVN workflows for less technical users

## Replacement-Critical

These are required before ShellySVN can credibly replace TortoiseSVN for everyday users.

### File Manager Integration

- Windows Explorer context menu commands for common working-copy actions.
- Windows Explorer overlay icons for modified, added, conflicted, locked, ignored, unversioned, normal, and external items.
- macOS Finder Sync context menu commands for common working-copy actions.
- macOS Finder badge support for the same status set where Finder allows it.
- Shell integration health diagnostics and repair actions.
- Installer/package checks that validate shell helper registration.
- Clear fallback behavior when overlays/badges are unavailable.

### Core Workflow Polish

- Commit dialog item selection parity: versioned, unversioned, missing, deleted, changelist, and externals visibility.
- Commit message templates, history, minimum length, and required issue ID validation.
- Commit message spellcheck and path/keyword autocomplete.
- Update dialog support for revision, depth, ignore externals, force, and progress/cancellation.
- Revert/cleanup/resolve dialogs that explain consequences before destructive actions.
- Drag/drop or app-native move/copy workflows for reorganizing versioned files.

### Status And Repository Awareness

- Local status and remote status checks with explicit "check repository" behavior.
- Background status refresh with bounded concurrency and cancellation.
- Repository browser prefetch/caching for faster navigation.
- Working-copy upgrade detection and guided upgrade flow.
- Clear handling for sparse working copies, externals, nested working copies, and switched paths.

### Diff, Merge, And Conflict Resolution

- Reliable text diff, side-by-side diff, and unified diff views.
- Image diff parity for common asset workflows.
- External diff/merge tool configuration with per-extension overrides.
- Three-way merge/conflict editor with safe save/revert behavior.
- Patch create/apply workflows with dry-run output and reject-file visibility.
- Office/document diff strategy decision: supported integration, external-tool handoff, or explicit non-goal.

### History And Review

- Revision log filtering by author, message, path, revision range, date range, and issue ID.
- Log cache for large repositories.
- Branch/tag comparison.
- Revision graph that clearly shows branches, tags, copies, and merges.
- Merge-tracking log view.
- Blame view with line-level revision, author, date, and log-message context.
- Project statistics: commits over time, authors, file churn, and branch/tag activity.

### Issue Tracker Integration

- Per-project issue tracker configuration.
- Commit dialog issue ID field or message parsing.
- Required issue ID warnings before commit.
- Issue links in log and commit views.
- Issue ID column in revision log.
- Configurable regex and URL templates compatible with common SVN project properties where practical.

## Platform-Specific But Important

These should be implemented in a platform-appropriate way, not copied one-for-one.

- Windows right-click workflows should feel native in Explorer.
- macOS Finder actions should avoid trying to replicate every Explorer-only behavior.
- macOS services/share extensions should be considered for workflows Finder Sync cannot cover well.
- Windows installer should validate shell extension registration.
- macOS package should validate Finder Sync extension registration and permissions.
- Both platforms need a diagnostics view that explains why file-manager integration is not active.

## Useful But Not Blocking

- Multi-language UI.
- Group policy deployment controls.
- Built-in SubWCRev equivalent.
- Dedicated repository creation wizard.
- Advanced overlay priority tuning.
- Office document diff support beyond external-tool handoff.
- Legacy URL protocol compatibility with TortoiseSVN command URLs.
- Full TortoiseSVN settings compatibility.

## Explicit Non-Goals For Now

- Recreating every TortoiseSVN Windows shell command exactly.
- Depending on Windows Explorer as the primary product surface.
- Treating Linux parity as equal priority to Windows and macOS.
- Replacing server-side repository administration tools.

## Release Bar For "Best Choice On Windows And macOS"

- Common SVN workflows can be completed from both the app and the native file manager.
- Shell/Finder integration is diagnosable, repairable, and tested in packaged builds.
- Long-running operations can be cancelled and report progress.
- Commit, update, merge, resolve, log, blame, diff, and patch workflows are reliable with large working copies.
- Credential, SSL, proxy, and bundled-binary behavior is consistent across all SVN operations.
- Skipped test count trends down and packaged-app smoke tests run per release target.
