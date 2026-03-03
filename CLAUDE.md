# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ShellySVN is a cross-platform Subversion client built with Electron. It provides GUI and CLI interfaces for SVN operations.

## Build Commands

```bash
bun run dev              # Start development server
bun run build            # Build for production (compile TypeScript)
bun run typecheck        # Run TypeScript type checking
```

## Platform Builds

```bash
bun run build:mac        # Build for macOS
bun run build:win        # Build for Windows
bun run build:linux      # Build for Linux
bun run build:all        # Build for all platforms
```

## Testing

```bash
bun run test:e2e                    # Run Playwright E2E tests
bun run test:e2e:ui                 # Run E2E tests with UI
bun run test:e2e:debug              # Run E2E tests in debug mode
bunx vitest run                     # Run unit tests
bunx vitest run src/shared/__tests__/types.test.ts  # Run single test file
```

## CLI Development

```bash
bun run cli:dev status /path/to/repo   # Run CLI in development
bun run cli status /path/to/repo       # Run compiled CLI
bun run engine:dev                     # Run logic engine directly
bun run engine:build                   # Compile logic engine binary
```

## Architecture

### Electron Process Model

- **Main Process** (`src/main/`): Node.js environment, handles SVN CLI execution, filesystem operations, and native dialogs
- **Renderer Process** (`src/renderer/`): React app with TanStack Router for UI
- **Preload** (`src/preload/`): Exposes safe IPC bridge via `contextBridge`

### IPC Communication

IPC handlers are organized by domain in `src/main/ipc/`:
- `svn.ts` - SVN operations (status, log, commit, update, etc.)
- `dialog.ts` - Native file/directory dialogs
- `store.ts` - Persistent settings storage
- `auth.ts` - Credential management
- `fs.ts` - Filesystem operations
- `monitor.ts` - Working copy monitoring

The renderer accesses these via `window.api` (typed as `ElectronAPI` in `src/shared/types.ts`).

### Key Patterns

- **SVN Operations**: Spawn `svn` CLI processes, parse XML output with `fast-xml-parser`
- **Routing**: TanStack Router with file-based routes in `src/renderer/src/routes/`
- **State Management**: Zustand stores for client state, TanStack Query for server state
- **Styling**: TailwindCSS with custom components in `src/renderer/src/components/ui/`

### Logic Engine Package

`packages/logic-engine/` is a standalone Bun-compiled binary for CLI use. It shares SVN client logic but runs independently of Electron.

## Path Aliases

- `@main` → `src/main/`
- `@renderer` → `src/renderer/src/`
- `@shared` → `src/shared/`
- `@preload` → `src/preload/`
