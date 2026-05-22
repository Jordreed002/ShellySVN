# Production Release Blockers

Date: 2026-04-30

This checklist is the release gate for a public production release. A preview or beta build may intentionally ship with some items open, but the release notes must say so.

## Must Be Closed Before Public Release

- [x] Public release workflow blocks unsigned Windows and macOS artifacts.
- [ ] Windows release artifact is Authenticode signed and installable on a clean Windows 10/11 x64 machine.
- [ ] macOS x64 release artifact is Developer ID signed, notarized, stapled, accepted by Gatekeeper, and launches on a clean Intel Mac or VM.
- [ ] macOS arm64 release artifact is Developer ID signed, notarized, stapled, accepted by Gatekeeper, and launches on a clean Apple Silicon Mac or VM.
- [x] Bundled SVN and `shelly-engine` binaries are present, executable, and version-checkable in every published artifact.
- [x] Packaged-app smoke tests cover Windows x64, macOS x64, macOS arm64, and Linux x64 when Linux artifacts are published.
- [x] Windows Explorer integration is either fully implemented and smoke-tested, or all public copy clearly says it is not included yet.
- [x] macOS Finder Sync integration is either fully implemented and smoke-tested, or all public copy clearly says it is not included yet.
- [x] README feature claims are aligned with verified release behavior.
- [ ] Replacement-critical SVN workflows have real-repository verification: checkout, update, commit, revert, cleanup, resolve, branch/tag, switch, merge, sparse checkout, externals, locks, shelving, repository browser, and diff/patch.

## Real SVN Verification Evidence

- `src/main/services/__tests__/svn-working-copy.real.test.ts` verifies working-copy info, context, modified/missing/unversioned status parsing, and local status behavior against a disposable `svnadmin` repository.
- `tests/e2e/conflict-resolution.spec.ts` verifies conflict creation and guided resolve behavior against a disposable real SVN repository through the app UI.
- `src/main/services/__tests__/svn-release-workflows.real.test.ts` verifies service-layer checkout, commit, update, revert, cleanup, locks, patch dry-run/apply, branch/tag creation, switch, merge, sparse checkout expansion, repository browser listing, and externals definition/list/update against disposable real SVN repositories.
- `src/main/services/__tests__/svn-metadata.test.ts` verifies app-side shelve/list/apply/delete command construction and structured unsupported handling when the active SVN binary lacks `shelve` / `unshelve`.
- 2026-05-22 local verification: `bun run verify:svn-workflows` passed against SVN 1.14.2 for checkout, status, info, add, commit, update, revert, log, diff, patch, branch, tag, merge, switch, sparse checkout, externals, repository browser, conflict resolve, lock/unlock, and cleanup. The verifier reported `shelve-unavailable` for this SVN client.

Remaining before this blocker can close: shelving execution with an SVN client that supports shelving, and the same workflow verifier run against signed release-candidate toolchains/artifacts.

## Existing Tracking

- Main task list: `.spec/tasks.md`
- Product scope and parity decisions: `.spec/spec.md` and `.spec/parity-decisions.md`
- Packaged binary verification script: `scripts/verify-binaries.mjs`

## macOS Signing and Notarization Gate

Public macOS distribution requires Developer ID signing, hardened runtime, notarization, stapling where applicable, Gatekeeper validation, and a clean-machine launch check on both Intel and Apple Silicon.

Before publishing macOS artifacts:

1. Run `bun run verify:binaries darwin-x64 darwin-arm64`.
2. Build on a macOS host with Developer ID credentials available.
3. Confirm the app and nested binaries are signed as required by the final package.
4. Confirm notarization succeeds and the distributed app or DMG is stapled when the workflow does not do it automatically.
5. Validate with `spctl` and launch the installed app on clean macOS x64 and arm64 machines or VMs.
6. If Finder Sync is advertised, verify the extension is signed, embedded, notarized, enabled in System Settings, and covered by packaged smoke tests.
