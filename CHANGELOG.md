# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
