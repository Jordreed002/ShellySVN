# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased — Track B, Product & Experience]

### Added

- AI vertical: Anthropic, Azure OpenAI, OpenAI-compatible, and Ollama providers with streaming responses, cancellation, token/cost estimates, and safeStorage-only key storage; AI privacy gate blocks secrets from ever reaching providers with per-working-copy consent, sanitized AI markdown rendering, and prompt-injection-safe prompt wrapping
- AI Review Center bulk triage with severity filters, accept/dismiss-all with undo, and a keyboard-driven flow; commit-message style learning from the repository's own history; AI conflict explainer embedded in the resolution wizard
- Diff and blame: blame gutter in the diff viewer, side-by-side/unified toggle with word-level highlights and ignore-whitespace options, image diff overlay/slider compare, a revision-to-revision and URL-to-URL diff wizard with saved comparisons, and blame range comparison
- Log tools: regex and field-scoped log search with CSV/JSON export, saved log views per working copy, and a "Show changes" action on every log entry (list, keyboard, and repository browser)
- Visual revision graph with branch lanes, copy-point markers, and merge edges, toggleable beside the history list
- Working-copy freshness: mixed-revision banner with one-click update to HEAD and an out-of-date pre-commit check with update-and-retry
- Conflict resolution: full accept-mode coverage for tree conflicts with mine/theirs/base/merged previews and batch resolve, plus property-conflict and binary-conflict flows; tag/release wizard with name templates and dry-run command preview
- Property editors: linting svn:ignore editor with live match preview and apply-to-siblings, svn:keywords editor with live expansion preview, and an externals manager with peg/operative revision editing
- Repo browser: drag-and-drop move/copy, multi-select with marquee, persistent per-repo sorting, affected-count confirmations for remote mkdir/delete/move, and a revprop editor with permanent-change notice
- Commit dialog: per-working-copy recent messages, template variables with issue-key autolink, Jira/GitHub/custom issue-tracker linkification, and a pre-commit checklist (debug leftovers, TODO markers, oversized files, forbidden patterns, server-side secret scan)
- Sidebar: working-copy groups, favorites, aggregate dirty badges, and Update All across groups through the existing batch pipeline; relink flow with repository-UUID verification and a pristine-store disk-usage panel with cleanup
- App shell: notification center with toasts and long-operation desktop notifications, working-copy tabs, session restore honoring the startup action, drop-folder-to-open, quick actions for registered external tools, and a shelf-manager entry point
- Patch hub with dry-run conflict preview and reject-file recovery; changelist auto-grouping suggestions; import/export wizards with progress, cancellation, and dry-run estimates
- Command palette grew to 40+ actions with tiered fuzzy matching and recent-usage boosting; keybindings are now remappable with conflict detection
- Theming: accent color picker, high-contrast mode (honoring the OS contrast preference), compact/comfortable density, and font scaling
- Settings: searchable settings with jump-to-section, versioned import/export with hostile-input-safe validation, per-section reset, per-working-copy overrides, named connection profiles, external diff/merge tool templates, and an AI provider configuration tab
- Onboarding checklist, shared empty states and skeleton loaders, status-overlay legend, prefers-reduced-motion support, i18n scaffolding with pseudo-localization, property-based parser test harness, e2e accessibility smoke, and visual-regression baselines for core screens
- Docs: troubleshooting error map, architecture diagram, CONTRIBUTING guide, verified keyboard-shortcuts reference, and refreshed Review Center/shelving/sparse-checkout tutorials

### Changed

- React Query caches are centrally keyed and invalidated on relocate/switch; every query now runs under an IPC timeout with shared error-and-retry panels instead of unbounded spinners
- Dialogs gained a shared base with focus traps, top-most-only Escape, focus restoration, and persisted geometry
- The virtualized file tree keeps its scroll position anchored across status refreshes

### Fixed

- VirtualizedTree scroll jumps when statuses refresh mid-scroll
- Nested dialogs no longer close their parents on Escape
- Changelist suggestion ids are stable across input reordering and reject-file hunks no longer drop added lines starting with `++`

## [1.1.0-beta.3] - 2026-08-22

### Added

- AI Review Center for reviewing pending changes, planning commit groups, and explaining diffs with persisted findings per working copy
- Commit stack and repository profile tracking behind the review center
- Packaged binary manifest verification for the bundled SVN client and logic engine
- Cross-platform SVN workflow coverage, end-to-end user journeys, and expanded unit test suites

### Changed

- Hardened the IPC boundary: renderer invokes are now validated by sender identity, frame, and trusted entry URL
- Repository browser refreshed with a rebuilt tree, address bar, status flag, and dialog suite

### Fixed

- Packaged builds no longer lose trusted-renderer authorization after in-app navigation (file protocol routing now uses URL fragments)

## [1.1.0-beta.2] - 2026-08-08

### Added

- User-approved automatic updates for Windows NSIS, signed macOS, and Linux AppImage builds
- Stable and opt-in preview release channels
- Download progress, cancellation, restart, and install-on-quit controls
- A connected Check for Modifications inspector with local and repository status separation
- A working-copy command center for reviewing repository state and coordinating batch updates
- A working-copy problems dialog with direct links to affected paths
- Cross-platform SVN workflow coverage and end-to-end user-journey tests

### Changed

- Public releases now require matching Git/package versions and signed Windows/macOS artifacts
- Release workflows publish and validate updater metadata, blockmaps, and macOS update ZIPs
- Settings now displays the packaged application version instead of a hard-coded value
- Windows uses native titlebar controls and improved non-interactive SVN process handling

### Fixed

- Stable GitHub releases are no longer mislabeled as preview releases on the website
- The application version now matches the `v1.1.0-beta.2` release line
- Windows command wrappers, password input, path handling, and process-tree termination are now handled consistently

## [0.2.0] - 2026-02-20

### Added

#### Sparse Checkout Support

- **Selective checkout**: Choose specific files and folders to download from large repositories
- **ChooseItemsDialog**: Interactive item picker with search, select all/deselect all, and lazy-loading tree
- **VirtualizedTree with checkboxes**: Efficient rendering of large directory trees with checkbox selection
- **Remote items display in File Explorer**: Toggle to show files that exist in the repository but aren't in your working copy
- **Repo Browser integration**: Add remote items to existing working copy directly from the repository browser
- **Update dialog integration**: Modify sparse checkout selections during update operations
- **Progress indicators**: Visual feedback during sparse checkout operations
- **Error handling**: Comprehensive error classification with recovery suggestions via SparseCheckoutErrorBoundary

#### Sparse Checkout Workflows

1. **During Checkout**: Click "Choose items..." to select which folders and files to download
2. **During Update**: Modify which items are included in your working copy
3. **From Repo Browser**: Browse remotely and add folders to existing sparse working copies
4. **From File Explorer**: Show remote items and update individual items to working copy

### Fixed

- Fixed `updateToRevision` depth and target directory issues for sparse operations
- Improved React keys in error boundary suggestions list
- Added missing component exports for ChooseItemsDialog and SparseCheckoutErrorBoundary

### Changed

- Simplified sparse checkout test setup and mocks for better maintainability

---

## [0.1.0] - Initial Release

### Added

- Core SVN operations (checkout, update, commit, revert)
- Authentication management with credential caching
- Repository browser
- File explorer with status indicators
- Commit dialog with file selection
- Log viewer with revision history
- Diff viewer for file comparisons
- Basic conflict detection
- Cross-platform support (Windows, macOS, Linux)
