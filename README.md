# ShellySVN

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/Jordreed002/ShellySVN/actions/workflows/ci.yml/badge.svg)](https://github.com/Jordreed002/ShellySVN/actions/workflows/ci.yml)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3+-fbf0df?logo=bun&logoColor=black)](https://bun.sh/)

**A standalone desktop client for Subversion working copies**

_Modern SVN workflows for Windows, macOS, and Linux_

[Features](#features) | [Release status](#release-status) | [Getting started](#getting-started) | [Architecture](#architecture) | [Contributing](#contributing)

</div>

---

## Overview

ShellySVN is an Electron desktop application for inspecting and operating Subversion (SVN)
working copies. Its current direction is to make the state of several working copies understandable
at a glance, then provide a safe next action: inspect changes, update selected copies, resolve a
problem, or open the affected path.

Release packages are designed to carry their own SVN command-line client and the optional
`shelly-engine` helper, so end users do not need a separate SVN installation. Packaging fails when
the target binaries are missing, placeholders, non-executable, or fail their version checks.

The repository is currently on the **1.1.0-beta.2** development line. The next candidate is focused
on release hardening rather than expanding the SVN feature surface.

## Features

### Daily working-copy overview

- **Working-copy command center** — check all known working copies, compare BASE and HEAD
  revisions, see local-change and incoming-change counts, and coordinate selected updates.
- **Check for Modifications inspector** — separate local and repository status, search and filter
  affected paths, and open diff, log, reveal, or conflict-resolution actions.
- **Working-copy problem guidance** — identify conflicts, obstructions, missing paths, locks, and
  other actionable states, with links back to the affected location.
- **Project monitor and bookmarks** — keep frequently used working copies within reach.

### SVN workflows

- Checkout, including sparse checkout; update; commit; revert; add; delete; cleanup; and upgrade.
- Repository browsing, export/import, revision history, blame, unified and image diffs, and patch
  creation/application.
- Branch/tag, switch, relocate, revision-range merge, and guided conflict resolution.
- Locks, changelists, properties, externals, hook configuration, and external diff/merge tools.
- Shelve/unshelve when the active SVN client implements those commands. SVN versions without
  shelving report the limitation instead of pretending the operation succeeded.

### Desktop experience

- Virtualized file, history, and repository views for large result sets.
- Background status work, cached reads, progress reporting, and cancellation.
- Optional AI-assisted commit-message drafts using a separately installed Codex CLI or Claude CLI.
  Generated text remains editable and is never committed automatically.
- Command palette (`Ctrl+K` / `Cmd+K`), keyboard shortcuts, themes, and persistent local settings.
- User-approved application updates with **Stable** and opt-in **Preview** channels. Supported
  packaged formats check at startup and every six hours by default, but never download an update
  until the user approves it. Preview includes beta and release-candidate builds; returning to
  Stable does not downgrade an installed preview.

## Release status

The build configuration targets the following artifacts. Availability varies by GitHub release.

| Platform | Architecture          | Configured packages        | In-app updates         |
| -------- | --------------------- | -------------------------- | ---------------------- |
| Windows  | x64                   | NSIS installer             | NSIS builds            |
| macOS    | Intel (x64)           | DMG and ZIP                | Signed packaged builds |
| macOS    | Apple Silicon (arm64) | DMG and ZIP                | Signed packaged builds |
| Linux    | x64                   | AppImage, deb, rpm, tar.gz | AppImage only          |

See the [GitHub Releases](https://github.com/Jordreed002/ShellySVN/releases) page for artifacts that
have actually been published.

### Release caveats

- Windows and macOS are the replacement-readiness priority. Linux packaging is supported where an
  artifact is published, but Linux file-manager integration is not in the current parity target.
- A public stable Windows/macOS release requires signed artifacts. macOS builds must also be
  notarized and stapled, and all three Windows/macOS architectures must pass clean-machine checks.
- Those signing and clean-machine gates are not yet recorded as complete in the repository's
  [production release checklist](.spec/production-release-blockers.md). Treat beta and release-
  candidate artifacts according to their accompanying release notes.
- The complete replacement-critical SVN workflow matrix still needs verification against signed,
  packaged release candidates. The development test suite already exercises those workflows
  against disposable real repositories.

### Native file-manager integration

The application contains typed handoff contracts, status mapping, registration diagnostics, and
fallback UI for Windows Explorer and macOS Finder integration. **The native Windows shell helper
and macOS Finder Sync extension are not included in the current repository/package configuration,**
so Explorer context menus and overlays, and Finder context menus and badges, are not currently
available in standard builds.

Use the standalone application's file explorer, toolbar, context menus, and command palette for SVN
operations. Native helper binaries must be implemented, signed, packaged, and smoke-tested before
ShellySVN advertises those integrations as shipped. Linux file-manager integration is deferred.

## Getting started

### Prerequisites

- [Bun](https://bun.sh) 1.3 or newer for dependency management and scripts.
- Platform build tools required by Electron when developing or packaging on that platform.
- Docker only for the optional SVN compatibility lab.

The desktop app uses bundled SVN binaries in a packaged release. A source checkout must have the
appropriate files under `binaries/<platform>-<arch>/` before package-verification or distribution
commands can succeed.

### SVN review assistant

This feature is disabled by default. To use it:

1. Install either the [Codex CLI](https://developers.openai.com/codex/cli/) or
   [Claude CLI](https://docs.anthropic.com/en/docs/claude-code/getting-started) separately. Neither
   CLI is bundled with ShellySVN.
2. Configure the provider's authentication, then confirm that `codex --version` or
   `claude --version` works in your user environment.
3. In ShellySVN, open **Settings > SVN**, enable **Generated commit-message drafts**, and select a
   provider and message style. **Auto** prefers Codex when both providers are available. Codex
   defaults to **GPT-5.6 Luna** for efficient commit-message drafting; Settings also offers Terra
   and Sol when more capability is preferred.
4. Open the commit dialog and select the files to work with. From there you can generate an
   editable commit draft, run an advisory pre-commit review, or ask ShellySVN to group the paths
   into logical commits and SVN changelists.

The same structured assistant is available in three other focused workflows:

- In a file diff, choose **Summarize file**, **Why it changed**, **Risky lines**, or **Review
  questions**. Results are cached by diff checksum for the current app session.
- In revision history, filter or enter a revision range and choose **Release notes** to generate
  user-facing notes, technical changes, breaking changes, upgrade notes, and references.
- In the three-way merge editor, choose **Suggest resolution** to receive an explanation,
  confidence, unresolved questions, and a proposed merge. The proposal is never saved
  automatically; **Use as editable draft** only places it in the existing merge editor.

ShellySVN sends only the SVN text diff for the selected paths, up to the configured 32–512 KiB
limit. Likely secrets are redacted and binary contents are omitted. Enabling the feature is an
explicit first-use choice, and the default setting also asks for consent before each send. Choosing
**Always allow** in that prompt disables the per-run confirmation; it can be restored in Settings.
The optional **Match recent repository message style** setting is a separate privacy control. When
enabled, ShellySVN also sends a small, redacted sample of recent messages affecting the selected
paths so drafts can match repository terminology and issue conventions.

Codex reuses the CLI's saved sign-in and runs non-interactively in a temporary, isolated directory
with a read-only sandbox, approvals and web search disabled, and no persisted session. Claude runs
with `--bare`, tools and MCP disabled, no session persistence, and a one-turn limit. For Claude,
ShellySVN deliberately requires `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or supported Amazon
Bedrock/Google Vertex credentials; Claude subscription OAuth credentials are not used.

If the Generate button is unavailable, check the provider status shown by its tooltip and verify
that the CLI is executable on `PATH`. For Codex, run `codex login status` and sign in through the
CLI if needed. For Claude, ensure the API or cloud-provider credentials are present in the
environment that launches ShellySVN. A selection with no text changes cannot produce a draft;
timeouts, provider errors, selection changes, and closing the dialog cancel generation without
committing anything.

### Development setup

```bash
git clone https://github.com/Jordreed002/ShellySVN.git
cd ShellySVN
bun install
bun run dev
```

### Verification

```bash
# Typecheck, lint, architecture/dead-code/remote-asset guards, skipped-test
# policy, unit tests, and a production build
bun run verify

# Strict performance tests and bundle report/budgets
bun run test:perf
bun run check:bundle-budget

# Playwright desktop journeys
bun run test:e2e

# IPC contract, scripted SVN workflows, and real-repository Vitest suite
bun run verify:svn-workflows

# Release-only superset of verify plus bundle analysis
bun run verify:release
```

`verify:svn-workflows` requires a usable SVN/SVNAdmin toolchain. The Docker compatibility lab is
available through `bun run svn:lab:up`, `bun run svn:lab:verify`, and `bun run svn:lab:down`.

### Build and package commands

```bash
# Compile Electron main, preload, and renderer bundles
bun run build

# Verify the target's bundled SVN and shelly-engine resources
bun run verify:binaries current
bun run verify:binaries win32-x64

# Package platform artifacts
bun run build:win
bun run build:mac
bun run build:mac-universal
bun run build:linux-appimage

# Optional helper/CLI engine
bun run engine:dev
bun run engine:build:all
```

Packaging commands run binary verification before `electron-builder`. They do not by themselves
prove code signing, notarization, native shell integration, or clean-machine compatibility.

## Architecture

ShellySVN follows Electron's process-isolation model:

```text
React renderer
  |  typed, allowlisted window.api calls
  v
context-isolated preload bridge
  |  validated IPC contracts
  v
Electron main process
  |-- settings, credentials, dialogs, updater and filesystem ownership
  |-- SVN command execution, progress, cancellation and serialized mutations
  |-- background workers and caches for expensive read operations
  `-- child processes
       |-- bundled SVN command-line client (desktop production path)
       `-- optional shelly-engine helper/CLI
```

The renderer does not receive direct Node or Electron access. Privileged work stays in the main
process behind the preload API. The main process is the production SVN backend for desktop
workflows; the Bun-based logic engine is packaged as an optional helper/CLI, not as the renderer's
primary backend.

### Project structure

```text
ShellySVN/
|-- src/
|   |-- main/             # Electron lifecycle, IPC, SVN services, workers
|   |-- preload/          # Context-isolated, typed renderer bridge
|   `-- renderer/         # React application
|-- packages/
|   |-- logic-engine/     # Optional Bun helper/CLI
|   `-- shared/           # Shared types, settings and IPC contracts
|-- apps/site/            # Product website
|-- scripts/              # Verification, release and preview tooling
|-- tests/                # E2E and real-SVN fixtures
|-- binaries/             # Per-platform packaged SVN/helper resources
|-- build/                # electron-builder resources
|-- out/                  # Compiled application output
`-- release/              # Generated installers/packages
```

### Main technologies

| Layer            | Technology                                                       |
| ---------------- | ---------------------------------------------------------------- |
| Desktop          | Electron 43, electron-vite, electron-builder                     |
| UI               | React 18, Tailwind CSS, Framer Motion, Lucide                    |
| Routing and data | TanStack Router, TanStack Query, TanStack Virtual, React context |
| Tooling          | Bun 1.3, TypeScript 5.7, Vitest 4, Playwright                    |

## Contributing

1. Fork the repository and create a focused branch.
2. Make the change with tests appropriate to its risk.
3. Run `bun run verify`.
4. For SVN behavior, also run `bun run verify:svn-workflows` where the required toolchain is
   available.
5. For renderer journeys, run the relevant Playwright test or `bun run test:e2e`.
6. Open a pull request describing the behavior and verification performed.

The project uses strict TypeScript, React functional components, and Tailwind CSS. Architecture
boundaries are enforced by `bun run check:boundaries`. Knip checks both the complete project graph
and production-only reachability; existing accepted findings live in `knip-baseline.json`. Run
`bun run dead-code:baseline` only when a change has removed known findings, never to accept newly
introduced dead code.

## Near-term direction

The 1.1 release train is focused on trust and release readiness:

- harden the command center and modification/problem inspection paths;
- close signing, notarization, packaged-workflow, and clean-machine release gates;
- keep updater channel behavior and published metadata consistent;
- improve accessibility, diagnostics, and cancellation/recovery behavior; and
- reduce warnings, stale documentation, dead-code baselines, and oversized UI modules.

Major new SVN surfaces, Git support, Linux shell integration, and a renderer-wide redesign are not
part of this release-hardening scope.

## License

ShellySVN is licensed under the MIT License. See [LICENSE](LICENSE).

## Acknowledgments

- [TortoiseSVN](https://tortoisesvn.net/) for the workflow inspiration.
- [The Apache Subversion project](https://subversion.apache.org/) for SVN.

<div align="center">

**[Report a bug](https://github.com/Jordreed002/ShellySVN/issues/new?template=bug_report.md)** |
**[Request a feature](https://github.com/Jordreed002/ShellySVN/issues/new?template=feature_request.md)**

</div>
