# Refactor Migration Notes

Generated: 2026-04-28

## Phase 1 - Shared Contracts and Boundaries

- Shared types, utilities, and IPC contracts now live in `packages/shared`.
- Main, preload, renderer, and logic-engine code should import shared contracts from the package boundary instead of duplicating local definitions.
- The architecture boundary check enforces that renderer code does not import main/preload modules and that logic-engine types stay aligned with shared types.

## Phase 2 - Main Process SVN Services

- `src/main/ipc/svn.ts` is now a registration layer for SVN IPC handlers.
- SVN command behavior moved into focused services:
  - `svn-working-copy.ts` for status/info/update/revert/add/delete/cleanup/move/rename.
  - `svn-checkout.ts` for checkout and checkout progress.
  - `svn-history.ts` for log/diff/streaming diff/blame.
  - `svn-metadata.ts`, `svn-locks.ts`, `svn-diagnostics.ts`, `svn-patch.ts`, `svn-repository-ops.ts`, and `svn-commit.ts` for the remaining SVN domains.
- Parser implementations moved to `src/main/svn/parsers.ts`.
- Public IPC channel names and preload API names are unchanged.

## Phase 3 - Renderer Feature Boundaries

- File status derivation and cache invalidation helpers moved into `src/renderer/src/features/files`.
- `FileExplorer.tsx`, `SettingsDialog.tsx`, and large SVN dialogs still need further controller/view splitting.

## Phase 4 - Quality Gates

- Boundary checks and expanded coverage include patterns are in place.
- Lint now passes with warnings. Main-process refactor warnings were reduced; renderer accessibility and hook warnings remain as the next quality target.

## Phase 5 - Documentation

- README architecture documentation was aligned with the current runtime shape.
- README mojibake diagrams were replaced with ASCII diagrams for stable rendering.
