# Architecture Boundaries

Updated: 2026-04-28

## Ownership Rules

- `packages/shared/src` owns process-neutral contracts, shared constants, shared errors, and small pure utilities.
- `src/main` owns privileged Electron, filesystem, process spawning, settings persistence, credentials, shell integration, and native dialogs.
- `src/preload` owns the renderer bridge only. It should expose typed, narrow methods and should not contain domain behavior beyond IPC wiring and event cleanup.
- `src/renderer/src` owns React UI, route-level orchestration, client-side cache coordination, and presentation-specific helpers.
- `packages/logic-engine` owns the standalone Bun CLI engine and imports shared contracts from `@shellysvn/shared`.

## Import Rules

- Renderer code may import `@renderer/*` and `@shared/*`, but not `@main/*` or `@preload/*`.
- Main code may import `@main/*` and `@shared/*`, but not `@renderer/*`.
- Preload code may import `@preload/*` and `@shared/*`, but not `@main/*` or `@renderer/*`.
- Logic-engine code must not duplicate shared SVN types. Shared contracts belong in `@shellysvn/shared`.

## Enforcement

Run:

```sh
bun run check:boundaries
```

The `verify` script also runs the boundary check after typecheck and lint.

## Refactor Pattern

When extracting a large module:

1. Move pure helpers first and add focused tests.
2. Move service orchestration next, keeping public IPC channels stable.
3. Leave IPC files as thin registration and request/response mapping layers.
4. Commit each extracted boundary separately.

