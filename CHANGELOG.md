# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
