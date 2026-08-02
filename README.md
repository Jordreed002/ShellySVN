# ShellySVN

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build](https://github.com/Jordreed002/shellysvn/actions/workflows/build-electron.yml/badge.svg)](https://github.com/Jordreed002/shellysvn/actions/workflows/build-electron.yml)
[![Electron](https://img.shields.io/badge/Electron-33+-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Bun](https://img.shields.io/badge/Bun-1.2+-fbf0df?logo=bun&logoColor=black)](https://bun.sh/)

**A modern, standalone Subversion client for macOS and Windows**

_Inspired by TortoiseSVN, rebuilt for today_

[Features](#features) | [Download](#download) | [Getting Started](#getting-started) | [Architecture](#architecture) | [Contributing](#contributing)

</div>

---

## Overview

ShellySVN is a native desktop application that provides a graphical interface for Subversion (SVN) version control. It's designed to be **fast**, **portable**, and **user-friendly**. Release artifacts are built to include the required SVN and helper binaries after package verification.

### Why ShellySVN?

| Problem                         | Solution                                    |
| ------------------------------- | ------------------------------------------- |
| Installing SVN tools is tedious | Portable SVN binary bundled with the app    |
| Other clients feel outdated     | Modern UI with virtualized rendering        |
| Large repositories lag          | Virtualized rendering for large file lists  |
| Cross-platform inconsistency    | Desktop app workflows for macOS and Windows |

---

## Features

### Core SVN Operations

- **Working Copy Management**
  - Browse files with real-time SVN status indicators
  - File explorer with filtering, sorting, and search
  - Thumbnail previews for images

- **Version Control Actions**
  - Commit, Update, Revert, Add, Delete
  - Checkout (including sparse checkout)
  - Export and Import
  - Lock and Unlock files
  - Cleanup working copy

- **History & Diffs**
  - Commit history viewer with filtering
  - Unified diff viewer with syntax highlighting
  - Blame/annotate view
  - Revision graph visualization

- **Branching & Merging**
  - Branch/Tag creation wizard
  - Merge wizard with revision range selection
  - Switch between branches
  - Relocate working copies

- **Advanced Features**
  - Changelists support
  - Shelve/Unshelve where supported by the active SVN binary
  - Properties editor
  - Externals manager
  - Patch creation and application
  - Conflict resolution wizard
  - Hook scripts configuration

- **Sparse Checkout** (new)
  - Selective checkout of specific files and folders
  - Lazy-loading tree browser with search
  - Add remote items to existing working copy
  - Visual toggle for showing remote vs local items
  - Update individual items to working copy

### User Experience

- **Command Palette** - Quick access to all actions (Ctrl/Cmd+K)
- **Keyboard Shortcuts** - Efficient workflow without mouse
- **Bookmarks** - Quick access to frequent repositories
- **Project Monitor** - Track multiple working copies at once
- **Quick Notes** - Annotate commits and revisions
- **Settings Persistence** - Configurable preferences saved locally

### Performance

- **Virtualized Lists** - TanStack Virtual for large file and tree views
- **Lazy Loading** - On-demand SVN status fetching
- **Background Scanning** - Non-blocking status updates
- **Cached History** - Fast navigation through commit logs

---

## Sparse Checkout

Sparse checkout lets you download only the files and folders you need from a large repository. This is useful when working with massive codebases where a full checkout would be impractical.

### Ways to Use Sparse Checkout

**1. During Checkout**

Click "Choose items..." in the Checkout dialog to select which folders and files to download. The repository structure loads on-demand as you expand folders.

**2. During Update**

In the Update dialog, click "Choose items..." to modify which items are included in your working copy. Add new paths or remove existing ones.

**3. From Repo Browser**

Browse the repository remotely and click "Add to Working Copy" on any folder to add it to an existing sparse working copy.

**4. From File Explorer**

Toggle "Show remote items" in the toolbar to see files that exist in the repository but aren't in your working copy. Right-click any remote item and select "Update to Working Copy" to download it.

### Tips

- Use the search box in the item picker to quickly find files by name or path
- Select/Deselect All buttons make bulk operations easy
- Remote items appear with a distinct icon to differentiate from local files
- Authentication prompts appear automatically for protected paths

---

## Download

| Platform | Architecture          | Download                        |
| -------- | --------------------- | ------------------------------- |
| Windows  | x64                   | `ShellySVN-x.x.x-x64-setup.exe` |
| macOS    | Intel (x64)           | `ShellySVN-x.x.x-x64.dmg`       |
| macOS    | Apple Silicon (ARM64) | `ShellySVN-x.x.x-arm64.dmg`     |
| Linux    | x64 AppImage          | `ShellySVN-x.x.x-x64.AppImage`  |

> Download the latest release from the [Releases](https://github.com/Jordreed002/shellysvn/releases) page.

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) 1.2+ (package manager and runtime)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/Jordreed002/shellysvn.git
cd shellysvn

# Install dependencies
bun install

# Start development server
bun run dev
```

### Build Commands

```bash
# Build frontend (renderer, main, preload)
bun run build

# Package for distribution
bun run build:win           # Windows x64
bun run build:mac           # macOS (current arch)
bun run build:mac-universal # macOS universal binary

# Packaging first verifies bundled SVN and shelly-engine binaries.
# Placeholder, missing, or non-executable binaries fail before electron-builder runs.
bun run verify:binaries win32-x64

# Build logic engine only
bun run engine:dev          # Run engine directly
bun run engine:build:all    # Compile for all platforms
```

---

## Architecture

ShellySVN uses Electron process isolation for the desktop app. The Electron main process is the production SVN backend for desktop workflows. The separate Bun-based logic engine is packaged and verified as a helper/CLI surface, but it is not the primary desktop execution path.

```
+-------------------------------------------------------------+
|                    Electron Main Process                     |
|                Production desktop SVN backend                |
|                                                             |
|  - Window management                                        |
|  - IPC coordination                                         |
|  - Native dialogs                                           |
|  - Settings storage                                         |
|  - SVN execution, credentials, SSL, progress, cancellation  |
+------------------------+------------------------------------+
                         | child_process.spawn()
                         v
+-------------------------------------------------------------+
|                   Bundled SVN Binary                        |
|                                                             |
|  - Portable, self-contained release resource                |
|  - Verified before packaging                                |
+-------------------------------------------------------------+

Optional CLI/helper path:

+-------------------------------------------------------------+
|              Logic Engine (shelly-engine)                   |
|                    Compiled Bun Binary                      |
|                                                             |
|  - Headless CLI experimentation and automation              |
|  - Structured JSON output to stdout                         |
|  - Not the primary desktop SVN backend                      |
+------------------------+------------------------------------+
                         | spawn SVN
                         v
+-------------------------------------------------------------+
|                   Bundled SVN Binary                        |
+-------------------------------------------------------------+
```

### Project Structure

```
ShellySVN/
|-- src/
|   |-- main/           # Electron main process
|   |-- preload/        # Preload scripts (IPC bridge)
|   |-- renderer/       # React frontend
|   |   |-- components/ # UI components
|   |   |   `-- ui/     # Reusable dialogs & controls
|   |   |-- hooks/      # React hooks
|   |   |-- routes/     # TanStack Router pages
|   |   `-- styles/     # Tailwind CSS
|-- packages/
|   |-- logic-engine/   # Optional compiled Bun CLI/helper engine
|   `-- shared/         # Shared types, IPC contracts, utilities
|-- build/              # Electron-builder resources
|-- binaries/           # Platform-specific SVN binaries
|-- out/                # Build output
`-- release/            # Packaged installers
```

### Technology Choices

| Layer             | Technology       | Why                                               |
| ----------------- | ---------------- | ------------------------------------------------- |
| Desktop Framework | Electron 43+     | Mature, cross-platform, native integrations       |
| Package Manager   | Bun              | Fast installs, workspace support, compile feature |
| Frontend          | React 18         | Component model, hooks, ecosystem                 |
| Routing           | TanStack Router  | Type-safe, file-based routing                     |
| State             | Zustand          | Simple, performant, minimal boilerplate           |
| Data Fetching     | TanStack Query   | Caching, background updates, deduplication        |
| Virtualization    | TanStack Virtual | Handle large file and tree views                  |
| Styling           | Tailwind CSS     | Utility-first, consistent design                  |
| Icons             | Lucide React     | Beautiful, consistent, tree-shakeable             |

---

## Screenshots

_Coming soon_

---

## Contributing

We welcome contributions! Here's how to get started:

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run type checking (`bun run typecheck`)
5. Check for newly unreachable code (`bun run check:dead-code`)
6. Run the complete verification suite (`bun run verify`)
7. Commit your changes
8. Push to the branch
9. Open a Pull Request

Knip checks both the complete project graph and production-only reachability in CI. Existing findings
are tracked in `knip-baseline.json`; after removing known dead code, run
`bun run dead-code:baseline` to shrink that baseline. Baseline updates should accompany the deletion
that resolved the findings and must not be used to accept newly introduced dead code.

### Code Style

- TypeScript strict mode enabled
- React functional components with hooks
- Tailwind CSS for styling
- Follow existing patterns in the codebase

---

## Roadmap

Native Windows Explorer and macOS Finder integration contracts are hardened in the app, including common command handoff, status presentation, diagnostics, and packaged-helper checks. Production release claims remain limited to the standalone desktop app until signed native helpers are included in release artifacts.

- [x] Windows Explorer and macOS Finder integration hardening
- [x] Packaged app smoke tests for Windows and macOS release targets
- [x] Merge conflict resolution hardening
- [x] Image diff verification and polish
- [x] Repository browser with remote browsing
- [x] Linux packaging smoke tests where release artifacts are produced
- [x] Plugin/extension system decision
- [x] Dark/light theme customization

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [TortoiseSVN](https://tortoisesvn.net/) - Inspiration for the UI/UX
- [CollabNet](https://www.collab.net/) - SVN binaries
- [The Subversion Project](https://subversion.apache.org/) - Version control system

---

<div align="center">

**[Report a Bug](https://github.com/Jordreed002/shellysvn/issues/new?template=bug_report.md)** | **[Request a Feature](https://github.com/Jordreed002/shellysvn/issues/new?template=feature_request.md)**

Made with ❤️ by the ShellySVN Team

</div>
