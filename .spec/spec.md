# ShellySVN Product and Engineering Spec

Generated: 2026-04-28

Status: Draft

This document is the living specification for ShellySVN. It describes what the product is intended to be, the supported workflows, the technical shape of the app, and the quality bar required before release.

Related tracking files:

- `issues.md` - known defects and risks
- `tasks.md` - actionable implementation work
- `wish-list.md` - future improvements

---

## 1. Product Summary

ShellySVN is a cross-platform desktop Subversion client for users who need a modern graphical SVN workflow without separately installing and configuring SVN tooling.

The app should provide the core experience users expect from TortoiseSVN-style clients while improving portability, discoverability, performance on large working copies, and cross-platform consistency.

### Positioning

ShellySVN is:

- A desktop GUI for SVN working copies and remote repositories.
- A standalone app that can use bundled or custom SVN binaries.
- A workflow tool for browsing, committing, updating, diffing, resolving conflicts, and managing repository history.
- A client for large repositories, including sparse checkout workflows.

ShellySVN is not:

- A Git client.
- A hosted repository service.
- A replacement for SVN server administration tools.
- A general-purpose file manager.

---

## 2. Goals

### Product Goals

- Make SVN approachable through a modern, native-feeling desktop UI.
- Support day-to-day SVN workflows without requiring command-line usage.
- Handle large working copies and large repositories without freezing the UI.
- Provide a strong sparse checkout workflow for repositories where full checkout is impractical.
- Work consistently on Windows, macOS, and Linux where packaging support exists.
- Keep repository credentials and local filesystem access safe by default.

### Engineering Goals

- Keep Electron main, preload, renderer, and shared contracts clearly separated.
- Treat IPC handlers as privileged API boundaries.
- Keep long-running SVN and filesystem work off the renderer thread.
- Maintain a reproducible build and test workflow.
- Support packaged-app smoke testing before release.
- Keep security-sensitive behavior explicit and auditable.

---

## 3. Target Users

### Primary Users

- Developers and technical users working in SVN-backed codebases.
- Teams maintaining legacy or enterprise SVN repositories.
- Users who prefer graphical version-control workflows.
- Users who need sparse checkouts for large monorepos or asset repositories.

### Secondary Users

- Release engineers who inspect history, branches, tags, and working-copy state.
- Designers or non-developer contributors who need simple update/commit flows.
- Administrators who need to verify client configuration and bundled SVN behavior.

---

## 4. Core User Workflows

### 4.1 Open Existing Working Copy

Users can select a local folder and ShellySVN detects whether it is an SVN working copy.

Requirements:

- Show current working-copy root, repository URL, and status summary.
- Display versioned, modified, unversioned, ignored, missing, conflicted, and remote-only items distinctly.
- Allow navigation through files and directories.
- Preserve recent working copies for quick reopening.
- Avoid blocking the UI while status is calculated.

### 4.2 Browse Local Files

Users can inspect a working copy through a file explorer.

Requirements:

- Support sorting, filtering, search, and status indicators.
- Show file metadata such as size and modified time.
- Support optional thumbnails for image files.
- Support folder status aggregation.
- Support background refresh and manual refresh.

### 4.3 Commit Changes

Users can select changed files, review the change set, enter a message, and commit.

Requirements:

- Show changed files grouped or filterable by status.
- Support commit templates and message history.
- Validate commit message length and remove unsafe null bytes.
- Run configured hooks in the correct order.
- Report success with committed revision.
- Surface commit errors with actionable details.

Security requirements:

- Do not log commit credentials or command-line secrets.
- Do not expose passwords through renderer logs or diagnostic exports.

### 4.4 Update / Revert / Add / Delete / Cleanup

Users can run common SVN maintenance actions from toolbar, context menus, and command palette.

Requirements:

- Confirm destructive actions when the setting is enabled.
- Show progress for long-running operations where possible.
- Allow cancellation for long-running operations where SVN supports it.
- Return clear result states: success, failure, canceled, partially complete.

### 4.5 Checkout

Users can checkout a repository URL to a local directory.

Requirements:

- Support URL, destination path, revision, depth, and credentials.
- Support normal and sparse checkout.
- Support SSL trust decisions with explicit user consent.
- Store credentials only according to the security model.
- Show checkout progress and allow cancellation.

### 4.6 Sparse Checkout

Users can selectively checkout folders and files from a repository.

Requirements:

- Lazy-load repository tree nodes on expansion.
- Search within selectable repository items.
- Support selecting and deselecting subtrees.
- Support adding remote items to an existing sparse working copy.
- Show remote-only items in local file views when enabled.
- Update individual remote-only items into the working copy.

### 4.7 Repository Browser

Users can browse remote repository URLs without a full checkout.

Requirements:

- Support `http`, `https`, `svn`, and `svn+ssh` repository URLs where SVN supports them.
- Support credentials and cached credentials.
- Show files, folders, revisions, authors, and paths where available.
- Support adding selected folders to a working copy.
- Support opening safe external URLs only after scheme validation.

### 4.8 Diff, History, Blame, and Revision Graph

Users can inspect changes and history.

Requirements:

- Show unified diffs with syntax highlighting.
- Support large diffs without locking the renderer.
- Support external diff and merge tools through validated executable paths.
- Show revision log entries with filtering and pagination.
- Support blame/annotate view.
- Support revision graph visualization and export.

### 4.9 Branching, Tagging, Switching, Merging, and Relocation

Users can perform advanced SVN operations through guided dialogs.

Requirements:

- Branch/tag from a source URL or working copy path.
- Switch a working copy to another branch or URL.
- Merge with revision range selection.
- Relocate working copies between repository roots.
- Show command output and errors clearly.
- Guard destructive or high-risk operations with confirmation.

### 4.10 Conflict Resolution

Users can resolve text, tree, and lock conflicts.

Requirements:

- Detect conflicted files and display conflict state.
- Provide guided options for common SVN resolutions.
- Support external merge tools.
- Support three-way merge editing where available.
- Prevent accidental marking of unresolved conflicts as resolved unless explicitly confirmed.

### 4.11 Settings and Diagnostics

Users can configure app, SVN, diff/merge, notification, shell integration, and visual settings.

Requirements:

- Persist settings safely.
- Encrypt sensitive settings when persistence is allowed.
- Validate custom SVN binary paths before use.
- Provide diagnostics for SVN path, version, bundled binaries, encryption availability, and shell integration status.
- Provide a redacted diagnostic export for support.

---

## 5. Functional Requirements

### SVN Operations

The app must support:

- Status
- Info
- Log
- Diff
- Update
- Commit
- Revert
- Add
- Delete
- Cleanup
- Checkout
- Export
- Import
- Resolve
- Switch
- Copy / branch / tag
- Merge
- Relocate
- Changelists
- Shelve / unshelve where supported by the SVN version
- Properties
- Externals
- Lock / unlock
- Blame
- Remote list / repository browsing
- Patch create / apply
- Repository diagnostics

### Local Filesystem

The app must support:

- Listing directories.
- Reading previewable text files within configured limits.
- Reading supported image thumbnails within configured limits.
- Copying files only within approved workflows.
- Watching directories only within approved roots.
- Calculating folder sizes without unbounded blocking.

### Settings

The app must support:

- Theme and appearance settings.
- Startup behavior.
- Recent repositories and bookmarks.
- SVN client path.
- Proxy settings.
- SSL verification settings.
- Connection timeout.
- External diff and merge tools.
- Dialog preferences.
- Notification preferences.
- Shell integration preferences.
- Cache management.

### Authentication

The app must support:

- Per-realm SVN credentials.
- Session-only credentials.
- Persistent encrypted credentials when platform encryption is available.
- Clear indication when persistent encryption is unavailable.
- Credential deletion and clearing.

Persistent plaintext credential storage must not occur silently.

---

## 6. Non-Functional Requirements

### Performance

- Initial app shell should appear quickly and defer expensive operations.
- Large file lists should use virtualization.
- Status scans and folder-size scans should not block rendering.
- Long-running SVN operations should have progress or at least busy state.
- Background scans should be cancelable where practical.

### Reliability

- A failed SVN command must not crash the app.
- Failed parsing of SVN XML should produce a useful error or empty safe result, depending on workflow.
- App settings should survive partial migrations and missing fields.
- Concurrent settings saves must not corrupt the settings file.
- Build, lint, typecheck, and tests must be reproducible from a clean checkout.

### Security

- `contextIsolation` must remain enabled.
- `nodeIntegration` must remain disabled.
- Renderer sandboxing should be enabled if preload dependencies allow it.
- IPC handlers must validate all untrusted renderer input.
- Privileged filesystem operations must be scoped to approved roots or user-selected paths.
- External URL opening must allow only safe schemes.
- Custom executable paths must be validated before saving and before spawning.
- Logs must redact credentials, tokens, proxy passwords, and other secret-bearing values.
- SSL bypass must require explicit user intent and must avoid broad failure classes unless separately confirmed.
- Diagnostic exports must be redacted by default.

### Accessibility

- Core workflows must be keyboard accessible.
- Modal dialogs must trap focus and restore focus on close.
- Browser-native `prompt()` and `confirm()` should be replaced with accessible app dialogs.
- Status and progress changes should be screen-reader friendly.

### Offline / Portability

- The app should not depend on remote assets for normal operation.
- Fonts and static assets should be bundled or use system fallbacks.
- Bundled SVN binaries should be present and verified for each supported platform.

---

## 7. Architecture

### Current Stack

- Electron 33
- Electron Vite
- React 18
- TanStack Router
- TanStack Query
- TanStack Virtual
- Tailwind CSS
- Lucide React
- Bun
- Vitest
- Playwright
- electron-builder

### Process Boundaries

#### Main Process

Responsibilities:

- Window management.
- IPC registration.
- SVN command execution.
- Filesystem access.
- Settings persistence.
- Credential persistence.
- Shell integration.
- Native dialogs.
- Notifications.

#### Preload

Responsibilities:

- Expose a typed, narrow `window.api` bridge.
- Avoid exposing raw `ipcRenderer`.
- Keep renderer-facing APIs stable.

#### Renderer

Responsibilities:

- UI composition.
- User interaction.
- Data presentation.
- Calling preload APIs.
- Local UI state and query caching.

Renderer code must not rely on Node globals such as `require`, filesystem modules, or unrestricted environment access.

#### Logic Engine Package

Responsibilities:

- SVN-specific parsing and execution helpers.
- Structured SVN result types.
- Cross-platform binary support where applicable.

Open architectural question: decide whether SVN execution should be centralized in the main process, the logic-engine binary, or a clearly split model.

---

## 8. Packaging and Distribution

### Supported Targets

The package metadata describes support for:

- Windows x64
- macOS x64
- macOS arm64
- Linux x64

### Packaging Requirements

- `bun run build` must pass before packaging.
- Platform-specific SVN and engine binaries must be included as expected.
- Release artifacts must be verified before publishing.
- Windows, macOS, and Linux packages should each have smoke tests.
- macOS signing/notarization requirements should be documented before public distribution.

---

## 9. Verification Requirements

### Required Local Verification

- `bun run typecheck`
- `bun run lint`
- Unit tests
- `bun run build`
- Targeted E2E tests for touched workflows

### Required CI Verification

- Clean dependency install from lockfile.
- Typecheck.
- Lint.
- Unit tests.
- Production build.
- E2E smoke tests.
- Packaged-app smoke test when release artifacts are produced.

### Test Health Rules

- New skipped tests require a linked issue or task.
- Skipped test count should not increase without review.
- Security-sensitive code paths require direct tests.
- IPC validation must include Windows path cases.

---

## 10. Release Readiness Criteria

A release candidate should not ship until:

- Production build passes from a clean checkout.
- Critical and high issues in `issues.md` are resolved or explicitly accepted.
- No credentials are logged or silently stored in plaintext.
- External URL validation is consistent across all opening paths.
- Filesystem IPC permissions are scoped and tested.
- SSL trust behavior is centralized and user-confirmed.
- Packaged app launches on each target platform.
- Bundled SVN binaries are present and executable.
- README setup instructions are accurate and free of encoding corruption.

---

## 11. Assumptions

- Bun remains the package manager and development runtime.
- Electron remains the desktop shell.
- React remains the renderer framework.
- SVN is the primary and only version-control system for the current product.
- The app should continue to support both bundled and custom SVN clients.
- The existing `.spec` files are living project documents, not generated-only artifacts.

---

## 12. Open Questions

1. Which platforms are release-blocking for version `0.1.0`: Windows only, Windows plus macOS, or Windows/macOS/Linux?
2. Should bundled SVN be the default client, or should the system SVN remain the default when available?
3. Should persistent credentials be disabled completely when platform encryption is unavailable, or should users be allowed to opt into plaintext storage with a warning?
4. Should `svn+ssh` support include SSH key management, or should it rely entirely on the user's existing SSH agent/config?
5. Is the plugin system intended for untrusted third-party plugins, or only trusted local automation?
6. Should hook scripts be treated as trusted user scripts with broad permissions, or should they be sandboxed/permissioned?
7. What is the minimum acceptable SVN version for all advanced features, especially shelve/unshelve and sparse checkout?
8. Should the app support multiple windows/workspaces, or enforce single-window behavior?
9. What level of offline behavior is required beyond bundled static assets and local working-copy operations?
10. Should Linux packaging be considered first-class for the initial release, or remain roadmap until Windows/macOS stabilize?

---

## 13. Change Log

- 2026-04-28: Initial draft generated from README, package metadata, current architecture, and project review findings.
