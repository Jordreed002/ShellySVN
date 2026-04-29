# macOS Signing and Notarization Requirements

Date: 2026-04-29

ShellySVN is distributed outside the Mac App Store, so public macOS distribution requires Developer ID signing and Apple notarization before release. Apple documents notarization as the process for Developer ID-signed software distributed outside the store, and electron-builder delegates macOS signing/notarization to the Apple toolchain and `@electron/notarize`.

Sources checked:

- Apple: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- Apple common issues: https://developer.apple.com/documentation/security/resolving-common-notarization-issues
- electron-builder macOS signing: https://www.electron.build/code-signing-mac
- Electron code signing overview: https://www.electronjs.org/docs/latest/tutorial/code-signing

## Current Repo Configuration

`electron-builder.yml` already sets the macOS release baseline needed for notarization:

- `mac.hardenedRuntime: true`
- `mac.entitlements: build/entitlements.mac.plist`
- `mac.entitlementsInherit: build/entitlements.mac.plist`
- DMG output for both `x64` and `arm64`
- bundled `shelly-engine` and SVN resources under `extraResources`

`build/entitlements.mac.plist` currently enables:

- JIT support for Electron runtime behavior
- unsigned executable memory support
- disabled library validation
- user-selected file read/write access
- Downloads folder read/write access

Before public release, those entitlements must be reviewed against the final runtime needs. Any broad entitlement must have a specific reason, because notarization failures often come from malformed entitlements, missing hardened runtime, unsigned nested executables, or non-Developer-ID signatures.

## Required Release Secrets

CI or the local release environment must provide a valid Apple Developer identity and notarization credentials. Accepted approaches:

- Developer ID Application certificate installed in the signing keychain, selected through `CSC_NAME` when more than one identity exists.
- Certificate imported from secure CI storage through electron-builder-compatible `CSC_LINK` and `CSC_KEY_PASSWORD`.
- Notarization credentials using App Store Connect API key variables or Apple ID/app-specific password variables supported by the electron-builder version in use.

No Apple credentials, certificate passwords, app-specific passwords, API keys, or keychain passwords may be committed to the repository.

## Required Release Checks

Before publishing a macOS artifact:

1. Run `bun run verify:binaries darwin-x64 darwin-arm64` to prove the bundled SVN and `shelly-engine` binaries exist and execute.
2. Run `bun run build:mac` or `bun run build:mac-universal` from a macOS host with signing credentials available.
3. Confirm electron-builder signs the app with a `Developer ID Application` identity.
4. Confirm notarization completes successfully through Apple notary service.
5. Staple the notarization ticket to the distributed app/DMG when the release workflow does not do it automatically.
6. Validate Gatekeeper acceptance with `spctl` on the produced app/DMG.
7. Launch the installed app on a clean macOS x64 and macOS arm64 machine or VM.
8. Verify bundled command-line resources are still executable after signing and packaging.
9. If Finder Sync is added before release, verify the extension bundle is signed, embedded, notarized, enabled in System Settings, and covered by packaged smoke tests.

## Release Blockers

Do not publish a public macOS release if any of these are true:

- The app is unsigned or ad hoc signed.
- The app is signed without hardened runtime.
- Notarization fails or is skipped.
- Nested binaries in `extraResources` are missing, unsigned when signing requires them, quarantined incorrectly, or non-executable.
- Gatekeeper rejects the installed app or DMG.
- The final entitlements differ from `build/entitlements.mac.plist` without review.
- Finder Sync is advertised but the packaged extension is not signed, registered, permissioned, and smoke-tested.
