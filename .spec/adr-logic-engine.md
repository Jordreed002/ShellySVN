# ADR: Logic Engine Release Role

Date: 2026-04-28

## Decision

ShellySVN's production SVN execution path remains the Electron main process. `packages/logic-engine` is retained as experimental CLI/scaffolding and must not be treated as the authoritative production SVN backend until it reaches parser, credential, SSL, cancellation, progress, and settings parity with the main-process executor.

## Rationale

- The main process already owns IPC permissions, native dialogs, credential lookup, SSL trust policy, redacted logging, and renderer progress events.
- The logic engine still has simplified behavior for several operations and does not share the full app settings/security boundary.
- Moving production SVN execution into the logic engine would be a larger architecture migration, not a release-hardening fix.

## Consequences

- Release documentation should describe the main process as the production SVN backend.
- Packaged `shelly-engine` binaries may still be verified as resources, but absence of logic-engine parity blocks advertising it as the product backend.
- Future work should either remove the package from release messaging or promote it through a deliberate parity project with shared executor contracts and fixtures.
