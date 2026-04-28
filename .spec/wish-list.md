# Wish List

Generated: 2026-04-28

This file tracks product and engineering improvements that are not immediate defects.

---

## Security Hardening

- Centralize IPC input validation by operation type: working-copy path, repository URL, user-selected file, plugin file, app data path, and external tool path.
- Add an Electron security checklist to release review, including sandbox, CSP, navigation restrictions, IPC exposure, and shell/openExternal handling.
- Consider enabling Electron renderer sandboxing after auditing preload dependencies.
- Add structured security logging that never records credentials, tokens, proxy passwords, commit messages by default, or full command lines containing secrets.
- Add a single secret-storage abstraction for SVN credentials, proxy passwords, client certificate passphrases, and future token-like values.
- Add a permission model for custom tools, hook scripts, and plugins that makes executable launches explicit and auditable.

---

## Developer Experience

- Add `test`, `test:unit`, and `test:coverage` scripts to `package.json`.
- Add a `verify` script that runs typecheck, lint, unit tests, and build in the same order as CI.
- Document the expected Bun version and a clean install recovery command in the README.
- Add a short architecture decision record for why SVN execution lives in the main process versus the logic-engine package.

---

## Product / UX

- Add a diagnostics screen that shows SVN binary path, version, bundled binary availability, encryption availability, and shell integration status.
- Add a safe "copy diagnostic report" action that redacts usernames, passwords, repository credentials, and local sensitive paths.
- Add a TortoiseSVN replacement roadmap focused on Windows Explorer, macOS Finder, commit workflow, status, diff/merge, history, and issue tracker parity.
- Prefer platform-native integration over copying Windows-only TortoiseSVN behavior directly.
- Add clearer user prompts for SSL certificate trust decisions, especially for certificate failures that map to SVN's broad `other` category.
- Add a guided first-run setup for selecting system SVN versus bundled SVN.
- Replace all browser-native prompts/confirms with consistent app-native dialogs.
- Add a credential-management screen that clearly distinguishes encrypted persistent credentials from session-only credentials.

---

## Reliability / Performance

- Add cancellation support consistently across long-running SVN operations, not just checkout and scans.
- Add operation-level progress reporting for update, commit, merge, export, and import.
- Add bounded concurrency for folder-size calculation and deep status scans.
- Add smoke tests that launch the packaged app, not only the development Electron app.
- Add a test health dashboard or report that fails CI when skipped tests increase.

---

## Packaging

- Verify bundled SVN and `shelly-engine` resources for Windows, macOS x64, macOS arm64, and Linux in CI.
- Add release artifact checks that confirm app resources exist before publishing.
- Add platform-specific signing/notarization documentation.
