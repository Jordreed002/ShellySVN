# ShellySVN CLI Parity Contract

Date: 2026-04-29

This document defines what must exist in `shellysvn-cli` or `shelly-engine` before CLI parity can be claimed. It is scoped to automation and scripting. The Electron main process remains the production desktop SVN backend per `adr-logic-engine.md`.

## Release Role

- Desktop UI workflows continue to run through typed preload APIs, main-process IPC handlers, and main-process SVN services.
- `shellysvn-cli` is a headless automation surface. It may wrap `shelly-engine`, but it must not be advertised as production-equivalent until the engine shares the desktop executor contract for credentials, SSL trust, cancellation, progress, settings, redaction, and parsing.
- `shelly-engine` is allowed as a compiled helper binary and experimental backend. A future promotion requires shared fixtures and parity tests against the main-process services.

## CLI Operation Coverage

Required CLI commands before parity is claimed:

| Command       | Scope                                     | Notes                                                                                                                                         |
| ------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`      | Working-copy status                       | Must expose full local statuses, changelists, locks, externals, switched paths, nested working copies, and remote-check state when requested. |
| `info`        | Working-copy or repository metadata       | Must include URL, repository root, revision, UUID, node kind, schedule, copy-from metadata, and lock info when available.                     |
| `log`         | Revision history                          | Must support revision ranges, limits, author/message/path filters, changed paths, issue IDs, and pagination-ready output.                     |
| `diff`        | Unified diff                              | Must support working-copy paths, revision ranges, binary indicators, properties, copied/renamed paths, and output truncation metadata.        |
| `checkout`    | New working copy                          | Must support revision, depth, credentials, SSL trust, proxy/timeout settings, progress events, and cancellation.                              |
| `update`      | Existing working copy                     | Must support revision, depth, ignore externals, force, progress events, cancellation, and conflict summaries.                                 |
| `commit`      | Commit selected paths                     | Must support selected paths, message validation, issue ID validation, hooks, credentials, and committed revision reporting.                   |
| `revert`      | Revert selected paths                     | Must support recursive/non-recursive operation, explicit confirmation in interactive mode, and structured affected-path output.               |
| `cleanup`     | Working-copy cleanup                      | Must expose cleanup options and partial/failure state without crashing.                                                                       |
| `export`      | Export repository or working-copy content | Must support revision, force, depth where SVN supports it, progress, and output revision.                                                     |
| `diagnostics` | Environment support report                | Must report SVN path/version, bundled binary state, encryption availability, shell/Finder state where applicable, and redacted settings.      |

Desktop-only workflows that are not required in CLI parity:

- Shell/Finder overlay registration and repair UI.
- Interactive visual diff and merge editors.
- Rich repository browser tree navigation, except where covered by `list`/future scripting commands.
- Onboarding, command palette, and renderer accessibility behavior.

## Structured JSON Envelope

Every `--json` response must use one of these envelopes:

```json
{
  "schemaVersion": 1,
  "command": "status",
  "success": true,
  "state": "success",
  "data": {},
  "warnings": [],
  "diagnostics": {
    "svnVersion": "1.14.5",
    "svnPathSource": "bundled"
  }
}
```

```json
{
  "schemaVersion": 1,
  "command": "update",
  "success": false,
  "state": "failure",
  "error": {
    "code": "svn-command-failed",
    "message": "Redacted user-facing message",
    "retryable": false
  },
  "warnings": [],
  "diagnostics": {
    "exitCode": 1
  }
}
```

`state` is one of:

- `success`
- `failure`
- `canceled`
- `partial`

Rules:

- Secrets, credential-bearing URLs, proxy passwords, and client certificate passphrases must be redacted before output.
- Human output can be formatted for terminal readability, but `--json` must stay machine-stable.
- Parsing structs should come from shared types or shared parser helpers whenever the desktop app and CLI expose the same SVN concept.
- Large payloads must include truncation metadata rather than silently dropping output.

## Auth and Config Decision

Initial CLI parity relies on the same SVN runtime settings model as the desktop app, but non-interactive use must be explicit:

- Credentials can be supplied through secure OS storage, session-only environment variables, or explicit command flags that are redacted from logs.
- Persistent plaintext credential storage is not allowed silently.
- SSL trust decisions must distinguish temporary trust, permanent trust, and individual failure classes.
- Proxy, timeout, custom SVN path, SSH, and client certificate options must resolve through the same normalized settings shape used by main-process SVN services.
- Interactive prompts are allowed only when stdin is a TTY and `--non-interactive` is not set.

## Boundary Requirements

- Renderer code must not import main, preload, CLI, or logic-engine modules.
- Main-process services own privileged SVN execution for the desktop app.
- Shared parsing and DTO contracts belong in `packages/shared` when used by more than one runtime.
- `scripts/check-boundaries.mjs` remains the local guard for Electron main/preload/renderer separation.
