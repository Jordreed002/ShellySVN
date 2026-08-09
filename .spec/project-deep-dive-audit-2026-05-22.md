# Project Deep Dive Audit - 2026-05-22

## Scope

This audit reviews ShellySVN top to bottom across architecture, performance, standards compliance, and security. It is based on local source inspection, the existing `.spec` engineering records, and local verification commands run on 2026-05-22.

The audit includes:

- Electron main, preload, renderer, shared, and worker boundaries.
- SVN command execution, auth/cache behavior, filesystem IPC, local status server, webhooks, external URL/tool handling, and settings storage.
- Renderer data flow, bundle shape, virtualization, React Query usage, and large-repository performance patterns.
- Existing release gates, lint/type/test coverage, architecture boundary checks, remote asset checks, and performance budgets.

## Remediation Completion Update

The remediation plan generated from this audit is tracked in
`audit-remediation-tasks-2026-05-22.md`. Commit Points 1 through 11 have now
been completed and committed through `856610d` plus the final documentation
checkpoint.

High-impact items closed during the remediation pass:

- `bun run check:boundaries` is back to passing without weakening production
  architecture rules.
- Renderer query keys no longer serialize stored SVN credentials.
- Auth realm matching now uses URL-aware origin and path-boundary semantics.
- Filesystem read/probe/status IPC is gated by approved roots.
- The local status server requires a per-run capability token and rejects
  malformed, oversized, or unauthenticated requests.
- Status cache and worker queue behavior now have explicit bounds.
- Webhook delivery is HTTPS-only, blocks local/private targets, and caps payload
  size before delivery.
- BrowserWindow sandboxing is enabled, preload fails closed without context
  isolation, and local file/folder opening is separated from external URL
  opening behind approved-root checks.
- `FileExplorer.tsx` has been reduced by extracting command-event, lazy-dialog,
  dialog-state, and directory-data hooks.
- Renderer initial bundle budgets are now enforced by `scripts/analyze-bundle.mjs`.

Final local verification on 2026-05-22:

- `bun run verify`: passed on rerun. The first full-suite attempt hit a transient
  timeout in `src/main/workers/__tests__/svn-worker.test.ts`; the isolated test
  passed immediately afterward and the full suite passed on the next run.
- `SHELLYSVN_BUNDLE_REPORT=1 bun run build`: passed.
- `bun run check:bundle-budget`: passed at 641.8 KiB raw / 135.6 KiB gzip against
  the 750 KiB / 160 KiB initial renderer bundle budgets.
- `bun run verify:svn-workflows`: passed against local SVN 1.14.2 for checkout,
  status, info, add, commit, update, revert, log, diff, patch, branch, tag, merge,
  switch, sparse checkout, externals, repository browser, conflict resolve,
  lock/unlock, and cleanup. Shelving was reported as unavailable by this SVN
  client and remains a release-toolchain verification item.

Remaining public-release blockers are no longer source-level audit remediations:
signed Windows/macOS artifacts, clean-machine packaged smoke evidence, and
replacement-critical SVN workflow verification against the signed release
candidate toolchains/artifacts still need release-process evidence. Deferred
hardening items remain tracked at the end of `audit-remediation-tasks-2026-05-22.md`.

## Executive Summary

The original audit found a strong intermediate project with good architecture
documentation and several important Electron controls, but not a release-clean
source state. The remediation pass closed the source-level high and medium risk
items identified in the recommended order while preserving the status/cache
performance improvements.

The current source tree is verification-clean locally: `bun run verify`, bundle
report generation, bundle budget enforcement, and local real-SVN workflow
verification all pass. Public production release remains gated by signed artifact
and release-candidate workflow evidence tracked in
`.spec/production-release-blockers.md`.

## Evidence Collected

Commands and checks run during this audit/hardening cycle:

- `bun run typecheck`: passed.
- `bun run lint`: passed with 119 warnings and 0 errors.
- `bun run build`: passed.
- `SHELLYSVN_BUNDLE_REPORT=1 bun run build`: passed and generated `reports/bundle/renderer-bundle-report.md`.
- Targeted status/worker/file tests from the optimization pass: 68 tests passed.
- `bun run check:remote-assets`: passed.
- `bun run test:skips`: passed.
- `git diff --check`: passed apart from line-ending warnings.
- `bun run check:boundaries`: failed on renderer tests importing main/preload modules.

Current boundary failures:

- `src/renderer/__tests__/lock-conflict-recovery.test.tsx`
- `src/renderer/__tests__/performance/log-history.perf.test.ts`
- `src/renderer/__tests__/performance/working-copy-status.perf.test.ts`
- `src/renderer/__tests__/text-conflict-detection.test.ts`
- `src/renderer/__tests__/tree-conflict-detection.test.tsx`

Bundle evidence:

- Initial renderer chunk: `assets/index-c9oPpghg.js`
- Raw size: 642.8 KiB
- Gzip size: 135.8 KiB
- Largest modules in the initial chunk: React DOM production, TanStack Router core, and `Sidebar.tsx`.
- Major dialogs and heavier feature surfaces are still split into dynamic chunks, including `SettingsDialog`, `CommitDialog`, `EnhancedDiffViewer`, `PluginManagerDialog`, `PerformanceDashboard`, `LogViewer`, and others.

## Architecture And Standards

The repository has unusually good architecture documentation for an Electron app of this size. `.spec/architecture-boundaries.md` defines ownership for shared, main, preload, renderer, and logic-engine modules, and `scripts/check-boundaries.mjs` enforces the most important dependency directions. `.spec/performance-budgets.md` defines concrete startup, renderer bundle, repository browsing, worker, and IPC expectations. `.spec/production-release-blockers.md` correctly identifies signing, SVN client verification, and release workflows as production gates.

The code mostly follows the intended shape:

- Main process owns native capabilities, filesystem access, SVN process execution, settings storage, auth cache, and worker lifecycle.
- Preload exposes a typed bridge through `contextBridge`.
- Renderer mostly calls typed API wrappers and uses React Query for async state.
- Shared and logic-engine areas are meant to remain free of Electron/renderer dependencies.
- Worker code handles expensive SVN/status/file-size operations away from the renderer.

The main standards gap is that the checker catches architecture violations in renderer tests. Even if those imports are test-only, this undermines the value of the boundary gate because the official `verify` script cannot complete. The best fix is not to weaken production boundaries; it is to move shared test fixtures into test utilities, mock typed preload APIs from the renderer side, or adjust the checker only if there is a deliberate test-only allowance with explicit path rules.

The second standards gap is component size and ownership concentration. `src/renderer/src/components/FileExplorer.tsx` is about 1,855 lines and contains data fetching, command handlers, dialog orchestration, selection logic, status display, navigation behavior, and rendering. It contains good optimization patterns, but the size makes it harder to audit, test, and safely change. This is now a maintainability and risk issue, not just style.

## Performance Analysis

### Build And Bundle

The renderer initial bundle is currently within budget:

- Budget: initial renderer entry <= 750 KiB raw and <= 160 KiB gzip.
- Observed: 642.8 KiB raw and 135.8 KiB gzip.

This is good, but the margin is not large. The initial chunk is dominated by React DOM, TanStack Router, and app shell code. Most heavy features remain lazy-loaded, which is the right pattern for an Electron SVN client where many dialogs are rarely used in a normal session.

Recommendations:

- Keep bundle reporting enabled in CI or at least run `SHELLYSVN_BUNDLE_REPORT=1 bun run build` before release.
- Add an automated threshold check against `reports/bundle/renderer-bundle-report.json`, not only a generated report.
- Continue to keep diff viewers, log viewers, plugin management, diagnostics, and secondary dialogs behind dynamic imports.
- Watch `Sidebar.tsx` and `FileExplorer.tsx`; these are likely to become the next initial-bundle growth points.

### Startup And Electron Shell

Startup posture is reasonable:

- `contextIsolation` is enabled.
- `nodeIntegration` is disabled.
- `webSecurity` is enabled.
- External window opens are denied and delegated through validated external URL handling.
- Certificate errors are rejected.
- The app starts the local status server on ready and shuts down shared worker/status resources on quit.

Performance risks:

- `sandbox` is currently disabled in the BrowserWindow. This is primarily a security hardening issue, but sandboxing can also clarify preload constraints and reduce accidental native coupling.
- Quit cleanup calls `stopLocalStatusServer()` and `shutdownSharedWorkerPool()` without awaiting completion. This is acceptable for best-effort shutdown, but if workers or sockets hold resources under load, shutdown behavior may be nondeterministic.
- Cache-size helpers recursively walk Electron/user log cache directories on demand in the main process. These are utility operations, but large cache directories can make the main process do synchronous-feeling work through sequential async recursion.

Recommendations:

- Test whether the app can run with `sandbox: true`; if not, document the specific preload/native blocker.
- Move recursive cache-size and cache-clear work into a worker or add cancellation/progress if it can run on large directories.
- Await orderly shutdown where practical, or document why best-effort cleanup is sufficient.

### SVN Execution

The SVN runner has several good performance and safety properties:

- Uses `spawn` with argument arrays.
- Avoids shell execution except for Windows `.cmd/.bat` launch requirements.
- Supports cancellation with `AbortSignal`.
- Redacts sensitive arguments in logs.
- Supports stdout/stderr caps.
- Uses a mutation queue to serialize direct working-copy mutations per normalized working-copy key.

Performance risks:

- Not every SVN caller appears to set tight output caps or timeouts. Default output caps exist, but call sites should be audited so high-output commands cannot grow memory unexpectedly.
- Real SVN workflow verification is documented as a release blocker. Unit tests and mocked command behavior are not enough for edge cases around locks, conflicts, shelving, and auth prompts.
- Passing credentials as `--username` and `--password` is fast and simple, but it can expose secrets to local process inspection. This is a security issue, not a runtime speed issue.

Recommendations:

- Require explicit timeout/output-cap policy for every SVN command class.
- Keep mocked unit tests, but run real SVN workflow verification before release.
- Investigate avoiding command-line password exposure through SVN auth cache/config or safer credential handoff.

### Status, Worker, And Cache Path

The recent optimization pass improved the status path in important ways:

- Deep status operations are queued through a shared worker pool.
- Stale deep-status jobs are cancelled when newer scans supersede them.
- Status results are cached.
- Clean/empty deep status results are now cached.
- Cache keys are normalized.
- Invalidation is boundary-aware, so `/repo` no longer invalidates `/repo2`.
- Timed-out worker jobs retire the worker before it is reused, avoiding stale async results contaminating later jobs.

Remaining performance risks:

- `StatusService` has TTL-based caching but no visible max-entry/LRU bound. Long sessions that touch many paths can grow memory until process exit.
- Deep-status job identifiers include path-derived data. Very long paths or many repositories can increase queue and map memory pressure.
- Worker pool cancellation is cooperative. SVN jobs can abort, but folder-size recursion is not abortable and does not use a default timeout.
- `calculateFolderSize` recursively walks directories sequentially. It skips common expensive directories, but a large tree can still monopolize a worker.
- The scan queue has no documented global maximum length or backpressure policy.

Recommendations:

- Add max-entry and LRU behavior to status caches.
- Add queue length limits or dedupe/backpressure for path scans.
- Make folder-size work abortable, chunked, or timeout-bound.
- Add stress tests for many repositories, repeated path changes, long paths, and cancellation storms.

### Renderer Data Flow And UI Performance

The renderer contains several good patterns:

- React Query separates async data fetching from rendering.
- Large file lists use virtualization.
- Search uses deferred input.
- Dialogs and specialized viewers are lazy-loaded.
- Status loading is phased: directory listing, metadata, then deeper status.
- Expensive parse/filter behavior has performance tests for large synthetic SVN outputs.

Observed performance test evidence from the local suite shows large synthetic parse/filter scenarios completing in hundreds of milliseconds, with filtering/sorting generally much faster than parsing. This is useful coverage for parser regressions.

Remaining performance risks:

- `FileExplorer.tsx` is too large and carries too many responsibilities. This increases accidental rerender and regression risk.
- Query keys include `storedCreds` objects for remote list queries. Besides the security concern, object keys can create unnecessary cache churn when object identity changes.
- Some lint warnings point to hook dependency issues in tutorial, plugin/webhook hooks, and incremental status hooks. These can become stale data or excessive rerender bugs.
- `app.openExternal(parentDir)` is called from the renderer for a local path flow, but `app:openExternal` only validates web/mail URLs. This likely fails as a user workflow and should use a separate `showItemInFolder`/open-folder style API with approved-path checks.

Recommendations:

- Split `FileExplorer` into data hooks, command handlers, dialog state, and presentational components.
- Remove credentials from all React Query keys.
- Resolve hook dependency warnings rather than leaving them as lint noise.
- Add render-count or interaction-budget tests around FileExplorer for large working copies.

## Security Analysis

### Electron Hardening

Strong controls already present:

- `contextIsolation: true`
- `nodeIntegration: false`
- `webSecurity: true`
- Explicit CSP in `src/renderer/index.html`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self';`
- Denied new windows with validated external URL opening.
- Certificate errors rejected.
- No `dangerouslySetInnerHTML`, `eval(`, or `new Function` found in app source during scan.

Hardening gaps:

- `sandbox: false` remains enabled. The app may have a reason, but it should be treated as a conscious exception.
- CSP allows `style-src 'unsafe-inline'`. This is common for Vite/CSS-in-JS style workflows, but it weakens CSP. If feasible, remove or narrow it for packaged production.
- Preload has a fallback that assigns APIs directly if context isolation is unavailable. In production, context isolation should be mandatory. A fallback can hide accidental configuration regressions.

Recommendations:

- Attempt `sandbox: true` and document blockers.
- Consider failing fast in preload if context isolation is off in packaged builds.
- Tighten production CSP where feasible.

### Preload And IPC Boundary

The preload bridge uses typed wrappers and keeps renderer code away from raw Node APIs. That is the right general pattern.

The main gap is that TypeScript channel safety is compile-time only. `createInvokeIpc` constrains valid channels for application code, but it does not enforce a runtime allowlist inside preload. If a renderer compromise can reach the exposed invoke helper shape, runtime validation becomes important.

Recommendations:

- Add a runtime channel allowlist in preload IPC wrappers.
- Keep API methods narrow and semantic rather than exposing generic filesystem/process primitives.
- Treat renderer input as untrusted even when the UI path is controlled.

### Filesystem IPC

Good controls:

- File reads validate paths, file existence, file type, and preview/image size limits.
- Copy, write, folder-size, and watch operations use approved-path checks.
- Image reading restricts extensions and size.
- Dialog-selected paths are approved through `approved-paths`.

Gaps:

- Several read-oriented IPC handlers accept renderer-supplied paths without approved-root gating, including directory listing, metadata, status, deep status, version checks, parent lookup, and existence checks.
- Read-only filesystem enumeration is still sensitive in an Electron threat model. A compromised renderer should not be able to list or probe arbitrary local paths.
- Approved paths are process-global and in-memory. That is acceptable for a single-window app, but it is not scoped by `webContents` or window.
- `fs:applyStatus` accepts arrays from the renderer and performs main-side mapping. That is pure transformation work and does not need privileged main IPC.
- Watchers are keyed globally by path and tied to the first sender. Multiple windows or repeated watchers for the same path can interfere with each other.

Recommendations:

- Apply approved-root checks consistently to filesystem read/probe/status handlers.
- Scope approvals and watchers by `webContents.id` if multi-window behavior is supported.
- Move pure status transformation out of main IPC.
- Add tests proving arbitrary unapproved paths are rejected for every filesystem channel.

### Credentials And Auth Cache

Good controls:

- `safeStorage` is used when encryption is available.
- If encryption is unavailable, auth cache avoids persisting credentials.
- Sensitive SVN args are redacted in logs.

High-risk gaps:

- `AuthCache.findForUrl` uses raw `url.startsWith(realm)` matching. This can match sibling prefixes, such as a credential realm for `https://svn.example.com/repo` also matching `https://svn.example.com/repo2`. Credential realm matching needs URL-aware host/path boundary semantics.
- Renderer React Query keys include `storedCreds` objects in `FileExplorer.tsx`. Query keys are observable in devtools/logging and are not an appropriate place for usernames/passwords.
- SVN passwords are passed on the command line through `--password`, which may be observable to local users/process tools depending on OS and permissions.
- The encrypted auth-cache file does not appear to set restrictive file permissions explicitly. Platform defaults may be sufficient on Windows/macOS, but Linux packaging should confirm file mode.

Recommendations:

- Replace raw prefix credential matching with parsed URL origin plus path-boundary matching, preferring the longest valid realm match.
- Never put credential objects or passwords in React Query keys.
- Investigate safer SVN credential handoff and document the remaining local exposure risk if command-line passwords remain.
- Set or verify restrictive permissions for persisted secret files where the platform supports it.

### Webhooks And Network Egress

Good controls:

- Webhook delivery accepts only HTTP/HTTPS URL schemes.
- Timeouts are capped.
- HMAC signatures are supported when a secret is configured.
- Header names are validated.

Gaps:

- HTTP is allowed, including cleartext webhook delivery.
- Private network, localhost, and link-local targets are not blocked. This creates an SSRF-style risk if untrusted renderer input can configure or trigger webhooks.
- Payload size is not explicitly capped before `JSON.stringify` and delivery.

Recommendations:

- Prefer HTTPS-only by default.
- Add explicit allowlist or confirmation for localhost/private/link-local targets.
- Enforce payload size limits.
- Add tests for private IP, localhost, IPv6 loopback, DNS rebinding-sensitive hostnames, and oversized payloads.

### Local Status Server

The local status server is useful for sharing cached status information and invalidation across local processes.

Gaps:

- The named pipe/socket has no authentication token or capability secret.
- Any local process that can connect may be able to query cached status or invalidate cache entries.
- JSON line input does not appear to have a strict line-size cap.

Recommendations:

- Add a random per-run capability token or token file with restrictive permissions.
- Restrict socket permissions where the platform allows it.
- Enforce maximum message size and reject malformed/oversized requests early.

### External URLs And Tools

Good controls:

- External URLs are limited to `http:`, `https:`, and `mailto:`.
- Tool execution uses whitelisted aliases or custom executable paths and passes arguments as arrays.
- The external tool runner avoids shell argument interpolation.

Gaps:

- Custom tool validation checks existence but should also verify file type and executable suitability.
- Some external open file/folder flows are not clearly approved-root gated.
- Local path opening should be a separate approved-path API, not routed through URL opening.

Recommendations:

- Tighten custom tool validation with `stats.isFile()` and platform-specific executability checks where practical.
- Require approved roots for opening local files/folders.
- Keep URL opening and local shell opening as separate APIs with separate validation.

## Findings

| Severity | Area            | Finding                                                                            | Why It Matters                                                                                 | Recommended Fix                                                                            |
| -------- | --------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| High     | Architecture    | `bun run check:boundaries` fails on renderer tests importing main/preload modules. | `bun run verify` cannot pass, and the architecture gate is currently not release-clean.        | Move fixtures/mocks to allowed test utilities or create explicit test-only boundary rules. |
| High     | Credentials     | Auth realm lookup uses raw `startsWith`.                                           | Credentials can match sibling URL prefixes and be sent to the wrong repository path.           | Use parsed URL origin plus path-boundary matching and longest-realm selection.             |
| High     | Credentials     | Renderer query keys include credential objects.                                    | Passwords/usernames can leak into query cache keys, devtools, logs, snapshots, or diagnostics. | Key by URL plus a non-secret auth state/version; pass credentials only to query functions. |
| Medium   | Filesystem IPC  | Several read/probe/status handlers lack approved-root checks.                      | A compromised renderer could enumerate or probe arbitrary local paths.                         | Apply `assertPathApprovedForIpc` consistently to read-oriented filesystem channels.        |
| Medium   | Local IPC       | Local status socket has no auth/capability token.                                  | Other local processes can query/invalidate status if they can connect.                         | Add per-run token and message-size limits; restrict socket permissions.                    |
| Medium   | Webhooks        | Webhooks allow HTTP and private/local targets.                                     | Arbitrary configured webhook targets can become network egress or SSRF-like behavior.          | Prefer HTTPS, block or explicitly allow private/local targets, and cap payload size.       |
| Medium   | Electron        | BrowserWindow sandbox is disabled.                                                 | Renderer compromise impact is higher than necessary if sandboxing is feasible.                 | Test `sandbox: true`; document or remove blockers.                                         |
| Medium   | Workers         | Folder-size recursion is not abortable and has no default timeout.                 | Large directory trees can monopolize worker capacity.                                          | Add abort checks, chunking, and timeouts.                                                  |
| Medium   | Cache           | Status cache has TTL but no max-entry/LRU bound.                                   | Long sessions across many paths can grow memory without a hard limit.                          | Add max size and eviction policy.                                                          |
| Medium   | Maintainability | `FileExplorer.tsx` is about 1,855 lines.                                           | Performance and security changes in this component are hard to reason about safely.            | Split data hooks, actions, dialogs, and rendering into smaller modules.                    |
| Low      | Preload         | Runtime IPC allowlist is not explicit.                                             | Type safety does not protect against runtime misuse if renderer execution is compromised.      | Add runtime channel validation in preload wrappers.                                        |
| Low      | Validation      | Some traversal comments do not match normalize-first behavior.                     | Policy can be misunderstood; `foo/../bar` is normalized rather than rejected.                  | Decide whether to reject raw `..` segments before normalization and test it.               |
| Low      | Tooling         | Lint passes but has 119 warnings.                                                  | Warnings reduce signal and include hook dependency issues that can become real bugs.           | Burn down warnings, starting with hook dependency and loop-condition warnings.             |

## Positive Controls Worth Preserving

- Electron renderer has `contextIsolation` on, `nodeIntegration` off, `webSecurity` on, and a CSP.
- New window creation is denied; external URLs pass through explicit validation.
- SVN execution uses `spawn` with argument arrays and log redaction.
- Worker pool offloads expensive SVN/status work and now retires timed-out workers.
- Status cache key normalization and boundary-aware invalidation are now in place.
- Renderer uses virtualization, deferred search, lazy dialogs, and React Query.
- Performance budgets and architecture boundaries are documented in `.spec`.
- Remote asset checking and skipped-test baselining are part of the verification story.

## Recommended Remediation Order

1. Make `bun run verify` structurally pass again by fixing `check:boundaries` violations.
2. Remove credentials from renderer query keys.
3. Fix `AuthCache.findForUrl` to use URL-aware realm matching.
4. Apply approved-root checks to all filesystem read/probe/status IPC handlers.
5. Add local status server capability-token authentication and message-size limits.
6. Add cache size bounds and worker queue/backpressure controls for status scans.
7. Harden webhook target policy and payload limits.
8. Test Electron `sandbox: true` and either enable it or document the exact blocker.
9. Split `FileExplorer.tsx` along data/action/dialog/rendering boundaries.
10. Add automated bundle threshold enforcement.

## Go/No-Go Assessment

Current state is acceptable for continued development and internal testing, but not for production release.

Release should wait until:

- `bun run verify` passes end to end.
- Credential matching and credential query-key leakage are fixed.
- Filesystem IPC read/probe handlers are consistently approved-root gated.
- Local status socket access is authenticated or explicitly documented as trusted-local-only.
- Real SVN workflow verification has been run against supported SVN clients.
- Signing and packaging blockers in `.spec/production-release-blockers.md` are resolved.

The status optimization work is worth continuing, but the next pass should combine performance hardening with security hardening. The code is close enough that targeted fixes will have high leverage; a broad rewrite is not needed.
