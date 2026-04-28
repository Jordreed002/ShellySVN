# Fix Plan

Generated: 2026-04-28

This plan turns the review findings into an execution order. The intent is to reduce release risk first, then improve maintainability and product polish.

---

## Phase 0 - Stabilize Verification

Goal: make the project measurable before changing behavior.

Tasks:

- Repair dependency reproducibility from `bun.lock`.
- Add `test:unit`, `test:coverage`, and `verify` scripts.
- Update CI to run lint, typecheck, local unit tests, build, and smoke tests.
- Fix `bunx vitest` usage by running local Vitest.
- Confirm `bun run build` passes from a clean checkout.
- Add a skipped-test inventory check so skipped tests cannot grow silently.

Acceptance criteria:

- Fresh clone plus `bun install --frozen-lockfile` produces all required local binaries.
- `bun run verify` works locally.
- CI fails on lint, typecheck, unit, or build failures.
- Current skipped tests are documented and assigned.

Primary issues addressed:

- 4, 12, 14, 22, 23

---

## Phase 1 - Secret and External-Boundary Hardening

Goal: prevent credential leakage and unsafe external execution before broader refactors.

Tasks:

- Add a shared redaction utility for command args, URLs, paths, errors, diagnostics, and copied error reports.
- Redact SVN command logging before logging reaches any sink.
- Prevent persistent plaintext storage when `safeStorage` is unavailable.
- Move webhook secrets into a secret-storage path.
- Reuse one external URL validator for `app:openExternal`, `window.open`, protocol helpers, and renderer-opened URLs.
- Validate custom SVN executable paths before save and before execution.
- Add confirmation and validation for mutating deep-link actions.

Acceptance criteria:

- Tests prove `--password`, proxy passwords, webhook secrets, and auth credentials are not logged or copied in diagnostics.
- With `safeStorage` unavailable, persistent secrets are either disabled or require explicit opt-in.
- Unsafe URL schemes are rejected consistently.
- Deep links cannot execute mutating actions without confirmation.
- Custom SVN paths must exist, be executable, and return plausible `svn --version` output.

Primary issues addressed:

- 1, 2, 3, 8, 18, 19, 27

---

## Phase 2 - Centralize Privileged Main-Process Services

Goal: make all privileged operations go through auditable service boundaries.

Tasks:

- Create one `SvnExecutor` service used by all main IPC, monitor, filesystem status, and logic-engine integration points.
- Move proxy, SSL, timeout, credentials, binary path, cancellation, and redacted logging into the executor.
- Create one path-validation service with typed path intents.
- Scope filesystem IPC to approved roots and user-selected paths.
- Move webhook delivery to a main-process service.
- Ensure all long-running operations support timeout and best-effort cancellation.

Acceptance criteria:

- No direct `spawn('svn')` or `spawn('svn.exe')` remains outside the executor.
- Filesystem IPC has tests for approved and rejected roots on Windows and POSIX path styles.
- Webhook delivery has main-process URL validation, timeout, and redacted logs.
- Monitor and filesystem status respect custom SVN path and global settings.

Primary issues addressed:

- 6, 7, 16, 20

---

## Phase 3 - Parser and SVN Behavior Consistency

Goal: make SVN behavior correct and consistent across features.

Tasks:

- Replace regex XML parsing with typed `fast-xml-parser` helpers.
- Consolidate duplicated parser implementations between main and logic engine.
- Add fixtures for status, log, info, list, blame, properties, externals, changelists, shelve, and lock outputs.
- Centralize SSL trust failure mapping and remove broad `other` support from default flows.
- Decide whether logic engine is production code or remove it from release architecture.

Acceptance criteria:

- SVN XML parser tests cover single vs array nodes, escaped entities, empty output, malformed output, and real fixtures.
- No XML `matchAll()` parsing remains for SVN XML responses.
- SSL bypass behavior is identical across checkout, list, info, diagnostics, and sparse checkout.
- Logic-engine behavior is either brought to parity or documented as non-release scaffolding.

Primary issues addressed:

- 5, 17, 25

---

## Phase 4 - Product Runtime Fixes

Goal: fix user-facing failures that do not require architecture changes.

Tasks:

- Replace renderer Node globals with preload APIs or remove those template variables.
- Replace browser-native `prompt()` and `confirm()` with accessible app dialogs.
- Fix auth cache reporting and clearing paths.
- Bundle fonts locally or use system font fallbacks.
- Fix shell integration status reporting when native helpers are missing.
- Add a diagnostics panel for SVN path, version, bundled binaries, encryption, shell integration, and build metadata.

Acceptance criteria:

- Renderer has no `require()` usage and no reliance on `process.env` / `process.platform`.
- No production workflow uses `prompt()` or `confirm()`.
- Cache settings accurately report and clear the real auth cache.
- CSP passes without blocked Google Fonts or unexpected network requests.
- Shell integration reports missing helper, unsupported, failed, or registered accurately.

Primary issues addressed:

- 9, 10, 11, 15, 21, 26

---

## Phase 5 - Maintainability Refactor

Goal: make future changes safer and faster.

Tasks:

- Split `src/main/ipc/svn.ts` by operation family.
- Split `SettingsDialog.tsx` into tab modules and shared setting controls.
- Split `FileExplorer.tsx` into data hooks, action handlers, and presentation components.
- Introduce typed IPC request/response validation.
- Add module-level ownership notes for security-sensitive areas.

Acceptance criteria:

- No single production file exceeds an agreed threshold without explicit justification.
- Security-sensitive modules have focused tests.
- IPC handlers are small, typed, and mostly delegate to services.
- UI component tests cover split settings/file explorer behavior.

Primary issues addressed:

- 24

---

## Recommended First Sprint

Scope:

- Fix dependency/test/build verification.
- Add redaction and stop credential logging.
- Stop plaintext secret persistence when encryption is unavailable.
- Apply URL validation to `setWindowOpenHandler`.
- Add local unit tests for those fixes.

Why this first:

- It closes the highest-risk security issues.
- It makes later work verifiable.
- It keeps the patch size contained before larger service refactors.

Definition of done:

- `bun run verify` exists and passes locally.
- CI runs the same verification steps.
- Secret logging tests pass.
- SafeStorage unavailable behavior is tested.
- External URL validation is tested for both IPC and `window.open`.
