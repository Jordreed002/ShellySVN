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

Remaining before this blocker can close: shelving execution with an SVN client that supports shelving, and the same workflow verifier run against signed release-candidate toolchains/artifacts.

## Existing Tracking

- Main task list: `.spec/tasks.md`
- Parity roadmap: `.spec/PARITY_ROADMAP_TASKS.md`
- README claim audit: `.spec/readme-parity-audit.md`
- macOS signing/notarization notes: `.spec/macos-signing-notarization.md`
- Packaged binary verification script: `scripts/verify-binaries.mjs`
