# SVN Executor Migration Plan

Updated: 2026-04-28

## Current decision

Production SVN process spawning should go through `src/main/services/svn-executor.ts`.

The executor owns:

- selected SVN binary path from settings
- proxy temp config generation and cleanup
- connection timeout handling
- SSL trust handling with restricted failure values
- client certificate arguments
- credential argument injection with redacted logging
- cancellation via `AbortSignal`
- stdout/stderr streaming callbacks for progress parsing

## Migrated

- `src/main/ipc/svn.ts` command execution now delegates to the executor through `runSvnText`.
- `svn:checkoutWithProgress` now delegates to `runSvn`, preserving progress events and cancellation through `AbortController`.
- `src/main/ipc/fs.ts` SVN status, version checks, and deep scans now use the executor.
- `src/main/ipc/monitor.ts` working-copy info and status refresh now use the executor.

## Remaining exceptions

- `src/main/ipc/fs.ts` still spawns `wmic` for Windows drive listing. This is not SVN and should remain outside the SVN executor.
- `packages/logic-engine/src/svn/client.ts` uses `Bun.spawn`. Per `adr-logic-engine.md`, the logic engine is not the production SVN backend. If it returns to the release path, its SVN client must adopt the same executor contract or expose a compatible engine-side executor.

## Follow-up coverage

- Add unit tests directly around `runSvn` for argument redaction, timeout rejection, abort rejection, proxy config cleanup, and custom SVN path selection.
- Add integration coverage proving `fs` and `monitor` respect a configured SVN client path.
- Add progress/cancellation coverage for update, commit, merge, export, and import once those operations expose operation IDs in the renderer.
