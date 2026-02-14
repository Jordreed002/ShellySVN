# ShellySVN

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build](https://github.com/Jordreed002/shellysvn/actions/workflows/build-electron.yml/badge.svg)](https://github.com/Jordreed002/shellysvn/actions/workflows/build-electron.yml)
[![Electron](https://img.shields.io/badge/Electron-33+-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Bun](https://img.shields.io/badge/Bun-1.2+-fbf0df?logo=bun&logoColor=black)](https://bun.sh/)

**A modern, standalone Subversion client for macOS and Windows**

*Inspired by TortoiseSVN, rebuilt for today*

[Features](#features) • [Download](#download) • [Getting Started](#getting-started) • [Architecture](#architecture) • [Contributing](#contributing)

</div>

---

## Overview

ShellySVN is a native desktop application that provides a graphical interface for Subversion (SVN) version control. It's designed to be **fast**, **portable**, and **user-friendly**—bundling everything you need with zero external dependencies.

### Why ShellySVN?

| Problem | Solution |
|---------|----------|
| Installing SVN tools is tedious | Portable SVN binary bundled with the app |
| Other clients feel outdated | Modern UI with virtualized rendering |
| Large repositories lag | 60fps scrolling with 10,000+ files |
| Cross-platform inconsistency | Native experience on both macOS and Windows |

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
  - Shelve/Unshelve (SVN 1.10+)
  - Properties editor
  - Externals manager
  - Patch creation and application
  - Conflict resolution wizard
  - Hook scripts configuration

### User Experience

- **Command Palette** - Quick access to all actions (Ctrl/Cmd+K)
- **Keyboard Shortcuts** - Efficient workflow without mouse
- **Bookmarks** - Quick access to frequent repositories
- **Project Monitor** - Track multiple working copies at once
- **Quick Notes** - Annotate commits and revisions
- **Settings Sync** - Configurable preferences with persistence

### Performance

- **Virtualized Lists** - TanStack Virtual for smooth 60fps scrolling
- **Lazy Loading** - On-demand SVN status fetching
- **Background Scanning** - Non-blocking status updates
- **Cached History** - Fast navigation through commit logs

---

## Download

| Platform | Architecture | Download |
|----------|-------------|----------|
| Windows | x64 | `ShellySVN-Setup-x.x.x.exe` |
| macOS | Intel (x64) | `ShellySVN-x.x.x-x64.dmg` |
| macOS | Apple Silicon (ARM64) | `ShellySVN-x.x.x-arm64.dmg` |
| macOS | Universal | `ShellySVN-x.x.x-universal.dmg` |

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

# Build logic engine only
bun run engine:dev          # Run engine directly
bun run engine:build:all    # Compile for all platforms
```

---

## Architecture

ShellySVN uses a unique **multi-process architecture** for maximum performance:

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                     │
│                      (Node.js runtime)                       │
│                                                              │
│  - Window management                                         │
│  - IPC coordination                                          │
│  - Native dialogs                                            │
│  - Settings storage                                          │
└────────────────────────┬────────────────────────────────────┘
                         │ child_process.spawn()
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Logic Engine (shelly-engine)                    │
│                    Compiled Bun Binary                       │
│                                                              │
│  - SVN command execution via Bun.spawn()                     │
│  - XML → JSON parsing (fast-xml-parser)                      │
│  - Structured JSON output to stdout                          │
└────────────────────────┬────────────────────────────────────┘
                         │ Bun.spawn()
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Bundled SVN Binary                         │
│                                                              │
│  - Portable, self-contained                                  │
│  - No system dependencies                                    │
│  - Cross-platform binaries                                   │
└─────────────────────────────────────────────────────────────┘
```

### Project Structure

```
ShellySVN/
├── src/
│   ├── main/           # Electron main process
│   ├── preload/        # Preload scripts (IPC bridge)
│   ├── renderer/       # React frontend
│   │   ├── components/ # UI components
│   │   │   └── ui/     # Reusable dialogs & controls
│   │   ├── hooks/      # React hooks
│   │   ├── routes/     # TanStack Router pages
│   │   └── styles/     # Tailwind CSS
│   └── shared/         # Shared types (IPC contracts)
├── packages/
│   └── logic-engine/   # Compiled Bun binary for SVN ops
├── build/              # Electron-builder resources
├── binaries/           # Platform-specific SVN binaries
├── out/                # Build output
└── release/            # Packaged installers
```

### Technology Choices

| Layer | Technology | Why |
|-------|-----------|-----|
| Desktop Framework | Electron 33+ | Mature, cross-platform, native integrations |
| Package Manager | Bun | Fast installs, workspace support, compile feature |
| Frontend | React 18 | Component model, hooks, ecosystem |
| Routing | TanStack Router | Type-safe, file-based routing |
| State | Zustand | Simple, performant, minimal boilerplate |
| Data Fetching | TanStack Query | Caching, background updates, deduplication |
| Virtualization | TanStack Virtual | Handle massive lists at 60fps |
| Styling | Tailwind CSS | Utility-first, consistent design |
| Icons | Lucide React | Beautiful, consistent, tree-shakeable |

---

## Screenshots

*Coming soon*

---

## Contributing

We welcome contributions! Here's how to get started:

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run type checking (`bun run typecheck`)
5. Commit your changes
6. Push to the branch
7. Open a Pull Request

### Code Style

- TypeScript strict mode enabled
- React functional components with hooks
- Tailwind CSS for styling
- Follow existing patterns in the codebase

---

## Roadmap

- [ ] Linux support
- [ ] Git integration (hybrid repos)
- [ ] Merge conflict resolution UI
- [ ] Visual diff for images
- [ ] Repository browser with remote browsing
- [ ] Plugin/extension system
- [ ] Dark/light theme customization

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

**[Report a Bug](https://github.com/Jordreed002/shellysvn/issues/new?template=bug_report.md)** • **[Request a Feature](https://github.com/Jordreed002/shellysvn/issues/new?template=feature_request.md)**

Made with ❤️ by the ShellySVN Team

</div>
