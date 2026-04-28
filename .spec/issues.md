# Issues

Generated: 2026-04-28

This file tracks concrete defects and risks found during project review.

---

## Critical / High

### 1. SVN credentials can be written to debug logs

**Location:** `src/main/ipc/svn.ts`

`executeSvn()` appends `--username` and `--password` to the argument list, then logs the full command with `finalArgs.join(' ')`. This can expose SVN credentials in application logs.

**Impact:** Credential disclosure through debug output or collected logs.

**Suggested fix:** Redact sensitive argument values before logging. Prefer a helper that masks values following `--password`, `--username`, proxy password fields, certificate passwords, and future secret-bearing flags.

---

### 2. Credentials may be persisted in plaintext when Electron safeStorage is unavailable

**Location:** `src/main/auth-cache.ts`, `src/main/settings-manager.ts`

`AuthCache` logs that credentials will be "stored in memory only" when encryption is unavailable, but `set()` still stores the raw password and `save()` writes the credential cache to disk. `SettingsManager` has the same pattern for proxy passwords: if encryption is unavailable, it returns the original value and persists it.

**Impact:** SVN passwords and proxy passwords may be saved to disk in plaintext on systems where `safeStorage.isEncryptionAvailable()` is false.

**Suggested fix:** If encryption is unavailable, keep secrets in memory only and skip disk persistence for those fields, or require explicit user opt-in before plaintext persistence.

---

### 3. Window-open handler bypasses external URL validation

**Location:** `src/main/index.ts`

`app:openExternal` validates schemes, but `mainWindow.webContents.setWindowOpenHandler()` directly calls `shell.openExternal(details.url)` for any URL.

**Impact:** A malicious or compromised renderer path could attempt to open unsafe schemes through `window.open()`.

**Suggested fix:** Reuse the same URL validation helper for both `app:openExternal` and `setWindowOpenHandler`.

---

### 4. Production build fails on current checkout

**Command:** `bun run build`

The renderer build fails to resolve `react-syntax-highlighter` from `src/renderer/src/components/ui/CodeHighlighter.tsx`.

**Observed context:** `package.json` declares `react-syntax-highlighter`, but the local `node_modules` is missing several declared dependencies and binaries.

**Impact:** The app cannot be packaged or released from this checkout.

**Suggested fix:** Reinstall dependencies from `bun.lock`, verify Bun workspace install behavior, and add CI coverage for `bun run build`.

---

## Medium

### 5. SSL certificate bypass rules are inconsistent

**Location:** `src/main/ipc/svn.ts`

The shared SSL bypass allow-list excludes `other`, but some SVN handlers still pass `other` through `--trust-server-cert-failures`.

**Impact:** Security policy is weaker than the comments and helper constants imply.

**Suggested fix:** Route all SSL trust handling through one helper and explicitly reject or require separate confirmation for `other`.

---

### 6. Renderer-exposed filesystem IPC is overly broad

**Location:** `src/main/ipc/fs.ts`

**Status:** Partially resolved in code. Write, copy, watch, unwatch, and recursive folder-size IPC now require paths under a main-process approved root populated by native file/directory dialogs. Read/list operations still need a fuller product-level permission model.

The renderer can request arbitrary absolute writes, copies, watches, and reads through IPC.

**Impact:** A renderer compromise would have a broad local filesystem impact.

**Suggested fix:** Scope filesystem operations to working-copy roots, app-owned directories, plugin directories, or paths explicitly selected through native dialogs.

---

### 7. Path validation does not reliably enforce root or absolute-path restrictions

**Location:** `src/main/utils/validation.ts`

**Status:** Partially resolved in code. Sensitive filesystem operations now enforce resolve/relative root checks through the approved-path registry; broader path validation hardening and platform-specific edge-case coverage remain tracked.

`validatePath()` blocks paths starting with `/`, which does not catch Windows absolute paths. It also checks `normalizedPath.includes('..')`, which is not a robust substitute for resolving a candidate path against an allowed root.

**Impact:** Some validation comments overstate the actual protection.

**Suggested fix:** Use `path.resolve()` plus explicit allowed-root checks. Add Windows drive, UNC path, symlink, and traversal tests.

---

### 8. Custom SVN client path is trusted without validation

**Location:** `src/main/settings-manager.ts`, `src/main/ipc/svn.ts`

`getSvnClientPath()` returns any non-empty `svnClientPath` from persisted settings, and SVN IPC handlers pass that value directly to `spawn()`.

**Impact:** Any path that can be written into settings can become an executable launched by the app.

**Suggested fix:** Validate the custom SVN binary path before saving and before spawning. Require an existing executable selected through a native file picker, and consider version-checking it with `svn --version`.

---

### 9. Commit template variables use Node globals in the renderer

**Location:** `src/renderer/src/hooks/useCommitTemplates.ts`

The default `username` resolver reads `process.env`, and the `hostname` resolver calls `require('os').hostname()` inside renderer code. With `nodeIntegration: false`, `require` is not available in the browser context.

**Impact:** Templates using these variables can fail at runtime.

**Suggested fix:** Expose safe app/system metadata through preload IPC or remove Node-specific variables from renderer-side resolvers.

---

### 10. Cache clearing UI appears to target the wrong auth cache path

**Location:** `src/main/ipc/app.ts`, `src/main/auth-cache.ts`

`AuthCache` persists to `<userData>/auth-cache.json`, while cache breakdown and selective clearing look under `<userData>/shelly-cache/auth`.

**Impact:** The UI can report or clear an auth cache directory that does not contain the actual persisted credential file.

**Suggested fix:** Point cache reporting/clearing at the real auth cache location, or move auth persistence under the documented cache directory.

---

### 11. Remote font import conflicts with CSP and offline expectations

**Location:** `src/renderer/index.html`, `src/renderer/src/styles/global.css`

The global CSS imports Google Fonts, but the Content Security Policy only allows styles from `self` and inline styles. The app also positions itself as standalone/portable.

**Impact:** Fonts may be blocked by CSP in production, and the app makes an unnecessary remote dependency for a desktop client.

**Suggested fix:** Bundle fonts locally or remove the remote import.

---

## Low

### 12. Lint and unit-test commands are not reliable on current checkout

**Commands:**

- `bun run lint`
- `bunx vitest run`

`bun run lint` fails because `oxlint` is unavailable in `node_modules/.bin`. Running Vitest through `bunx` resolves a temporary/latest installation and fails to load local `vitest/config`.

**Impact:** Contributors cannot consistently verify changes.

**Suggested fix:** Add a first-class unit test script, run local binaries through `bun run`, and verify dependency installation restores `oxlint` and `vitest`.

---

### 13. TanStack Router warns about a non-route file in `routes`

**Location:** `src/renderer/src/routes/repo-browser/RepoBrowserContent.tsx`

Build output warns that `RepoBrowserContent.tsx` does not export a route.

**Impact:** Build noise can hide more important warnings.

**Suggested fix:** Move the component out of `routes`, prefix it with `-`, or configure `routeFileIgnorePattern`.

---

### 14. Many test suites are explicitly skipped

**Location:** `src/**/__tests__`, `tests/e2e`

The codebase currently contains 27 `describe.skip`, `it.skip`, or `test.skip` occurrences, including sparse checkout integration, auth persistence/concurrency, validation filesystem checks, and several renderer components.

**Impact:** Reported test coverage overstates exercised behavior, especially around areas that are already high-risk.

**Suggested fix:** Triage skipped tests, fix the jsdom/React incompatibilities, and move filesystem-dependent validation tests to a Node test environment.

---

### 15. Browser-native prompts and confirms are used in production UI

**Location:** Multiple renderer components and hooks

**Status:** Resolved in code. `confirm()` and `alert()` call sites now route through app-owned dialog IPC, and `prompt()` call sites use an app-owned renderer input dialog.

Several workflows use `prompt()` and `confirm()` for destructive actions, lock messages, ignore patterns, plugin input, and merge conflict decisions.

**Impact:** Native browser dialogs are inconsistent with the app UI, hard to test, block the renderer, and limit accessibility.

**Suggested fix:** Replace with the existing modal/dialog system.

---

### 16. Multiple SVN execution paths bypass shared settings and security controls

**Location:** `src/main/ipc/svn.ts`, `src/main/ipc/fs.ts`, `src/main/ipc/monitor.ts`, `packages/logic-engine/src/svn/client.ts`

The app has several independent SVN spawning paths. Some use `executeSvn()` with settings, proxy, timeout, SSL, and credential behavior. Others spawn `svn.exe` / `svn` directly and bypass those controls.

**Impact:** Behavior differs by feature. Custom SVN path, proxy settings, timeout, SSL policy, bundled binary selection, and logging/redaction can silently fail to apply.

**Suggested fix:** Centralize SVN process execution behind one main-process service. All IPC handlers, monitor status checks, filesystem status checks, and logic-engine calls should use the same executor contract or explicitly document why they cannot.

---

### 17. XML parsing is inconsistent and partly regex-based

**Location:** `src/main/ipc/svn.ts`, `src/main/ipc/fs.ts`, `src/main/ipc/monitor.ts`, `packages/logic-engine/src/svn/client.ts`

**Status:** Resolved in code. Regex-based SVN XML parsing in the main process and logic-engine property parser has been replaced with `fast-xml-parser` helpers and fixture coverage.

Some SVN XML parsers use `fast-xml-parser`, while list, blame, changelist, shelve, properties, filesystem status, and monitor parsing use regex matching.

**Impact:** XML entities, escaped paths, unexpected whitespace, multiple elements, and malformed output may parse incorrectly. This is especially risky for user-visible repository data and path handling.

**Suggested fix:** Move all SVN XML parsing to typed parser helpers using `fast-xml-parser`, with fixture coverage for SVN output variants.

---

### 18. Deep links are not validated before dispatching privileged actions

**Location:** `src/main/services/protocol-handler.ts`, `src/renderer/src/hooks/useDeepLinks.ts`

Deep links parse arbitrary `path` and `url` query values, then dispatch them to renderer handlers. The parser only checks the `shellysvn://` prefix and action name.

**Impact:** External protocol URLs can trigger app actions with untrusted local paths or repository URLs. Downstream validation may catch some cases, but the protocol boundary itself does not enforce a policy.

**Suggested fix:** Validate deep-link actions, URL protocols, path shape, maximum lengths, and required parameters before sending to the renderer. Require user confirmation before executing any mutating deep-link action.

---

### 19. Webhook secrets are persisted through the generic store

**Location:** `src/renderer/src/hooks/useWebhooks.ts`

**Status:** Resolved in code. Webhook secrets are migrated into the encrypted auth cache and stripped before generic store persistence.

Webhook configurations include optional `secret` values and are saved through `window.api.store.set()` as ordinary settings data.

**Impact:** Webhook signing secrets are likely persisted in plaintext in the app config.

**Suggested fix:** Store webhook secrets through the same secret-storage abstraction as SVN and proxy credentials. Return only redacted metadata to the renderer when listing webhook configs.

---

### 20. Renderer-side webhook delivery conflicts with CSP and bypasses main-process network policy

**Location:** `src/renderer/src/hooks/useWebhooks.ts`, `src/renderer/index.html`

**Status:** Resolved in code. Delivery now goes through `webhook:deliver` in the main process with URL validation, timeout handling, HMAC signing from the auth cache, and renderer CSP now keeps `connect-src` scoped to `self`.

Webhook delivery uses browser `fetch()` directly. The renderer CSP does not define `connect-src`, so external webhook delivery may be blocked by `default-src 'self'`. Even if allowed later, renderer-side network delivery bypasses main-process validation and auditing.

**Impact:** Webhooks may not work in production, and network permissions are not centrally enforceable.

**Suggested fix:** Move webhook delivery to a main-process IPC handler with URL validation, timeout enforcement, redacted logging, and explicit `connect-src` policy if renderer delivery remains necessary.

---

### 21. Local binary placeholders can make packaged or local builds non-functional

**Location:** `binaries/`

**Status:** Resolved in packaging scripts. Distribution scripts now run `verify:binaries` before `electron-builder` and fail on missing, placeholder-sized, or non-executable SVN / `shelly-engine` binaries.

The local `binaries/win32-x64/shelly-engine.exe` and `binaries/win32-x64/svn/svn.exe` files are 12-byte placeholders. Other platform binary directories are empty in this checkout.

**Impact:** Local packaging can produce an app with invalid bundled binaries unless CI-provided artifacts are present.

**Suggested fix:** Add a prepackage verification script that checks binary existence, size, executability, and `--version` output. Fail builds when placeholders are present.

---

### 22. CI job name claims linting but does not run lint

**Location:** `.github/workflows/ci.yml`

The `lint-and-typecheck` job runs `bun run typecheck` but does not run `bun run lint`.

**Impact:** Lint regressions are not caught in CI despite the job name implying they are.

**Suggested fix:** Add `bun run lint` to CI after dependency reproducibility is fixed.

---

### 23. Unit tests are run through unpinned `bunx vitest`

**Location:** `.github/workflows/ci.yml`, `package.json`

CI uses `bunx vitest run --coverage`, and `package.json` has no first-class unit test script.

**Impact:** CI can resolve a different Vitest than the lockfile expects, which matches the local failure mode observed during review.

**Suggested fix:** Add `test:unit` / `test:coverage` scripts and call them from CI using local dependencies.

---

### 24. Large core components and IPC modules are doing too much

**Location:** `src/main/ipc/svn.ts`, `src/renderer/src/components/FileExplorer.tsx`, `src/renderer/src/components/ui/SettingsDialog.tsx`

`svn.ts` is about 80KB, `SettingsDialog.tsx` about 78KB, and `FileExplorer.tsx` about 69KB. These files combine many responsibilities.

**Impact:** Changes are hard to review, test, and secure. Risky behavior is spread through long files where validation and side effects are difficult to audit.

**Suggested fix:** Split by domain: SVN executor, SVN parsers, SVN operation handlers, settings tabs, credential management, cache management, file-list data hooks, and file-list presentation.

---

### 25. Logic engine appears incomplete relative to product claims

**Location:** `packages/logic-engine/src/svn/client.ts`

The logic-engine client has simplified diff parsing and returns empty blame/list data for some operations.

**Impact:** If the compiled engine is used as intended by the README architecture, some features will be incomplete or inconsistent with main-process behavior.

**Suggested fix:** Decide whether the logic engine is production architecture or legacy scaffolding. If production, bring it to parity with the main-process SVN behavior and tests. If not, remove or clearly de-scope it from release docs.

---

### 26. Shell integration reports success when native helper is missing

**Location:** `src/main/shell/ShellIntegration.ts`

Windows shell integration logs that the helper is missing and returns without throwing, then `register()` sets `isRegistered = true` and reports success.

**Impact:** Users can see shell integration as enabled even though the native integration was not installed.

**Suggested fix:** Return a structured unsupported/missing-helper result and only mark registered after the helper succeeds.

---

### 27. Error detail copy can include sensitive local data

**Location:** `src/renderer/src/components/ErrorBoundary`

Error boundaries allow copying error messages, stacks, and component stacks directly.

**Impact:** Diagnostic text can include local paths, repository URLs, usernames, command output, or other sensitive data.

**Suggested fix:** Redact copied diagnostic details using the same redaction utility planned for logs and support exports.
