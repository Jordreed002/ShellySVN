# Track B — Product & Experience: Progress & Coordination

Status of the Track B backlog (`docs/beta-plan.md`) as executed against branch
`beta/1.2.0`. Track A worked the same tree in parallel (commits `8ce806f`…`bb1c2e6`);
its Phase 1/2 backends — safeStorage credentials, pristine analyzer, WC relink,
secret scanner — were consumed by Track B UI as they landed.

All work below is in the working tree (uncommitted by design), verified per-wave:
typecheck 0 errors · oxlint 0 errors · **4,101 unit tests / 0 failed** at the
Wave 3 gate. Wave 4 (settings depth, e2e, property tests, i18n, docs) in flight.

## Delivered by wave

### Wave 1 — Quick wins (#39–43, #77–80)
- **#39** VirtualizedTree scroll-jump: scroll-position anchor hook, keep-alive
  through empty states (VirtualizedList/ChooseItemsDialog).
- **#40** Dialog geometry persistence per dialog id (`useDialogGeometry`,
  DialogBase); main-window position persistence → Track A (below).
- **#41** Central query-key registry (`lib/queryKeys.ts`) + stale-repo cache
  reset wired into relocate/switch (`useSvnActions.relocate/switchTo`).
- **#42** `DialogBase` + dialog stack: top-most-only Escape, focus trap/restore,
  ref-counted scroll lock; 11 dialogs migrated.
- **#43** 45s IPC timeout on every query (`createAppQueryClient` +
  `lib/queryTimeout.ts`), shared `ErrorPanel` with retry on main surfaces.
- **#77** Command palette: 42+ actions, tiered fuzzy scoring, recent-usage boost.
- **#78** Remappable keybindings (`lib/shortcutStore.ts`), record/conflict/reset
  UI; parity test green.
- **#79** Accent picker (8 presets + custom), high-contrast mode (system/on/off,
  `prefers-contrast` aware).
- **#80** Density (compact/comfortable via CSS row vars) + font scaling 85–125%.

### Wave 2 — Features (#108–114, #18–20, #32–33, #46–49, #71–72, #68–70)
- **#108** Providers: Anthropic-native, Azure OpenAI, OpenAI-compatible, Ollama
  (`src/main/services/ai-providers/`, fetch + hand-rolled SSE, zero new deps);
  `'auto'` preference tries CLI providers first.
- **#109** Streaming: `ai:stream` events keyed by operationId, mid-stream
  cancel; cost estimates (pricing table + chars/4) surfaced pre-send.
- **#110** Style learning: pure `styleLearner.ts` → `RepositoryAiStyleHints`
  persisted into the repository profile; "Learn from history" action.
- **#111** AI conflict explainer embedded in the resolution wizard
  (consent-gated, cancellable, streaming).
- **#112** Review Center bulk triage: severity filters, accept/dismiss-all with
  undo, j/k/a/d keyboard flow.
- **#113** Per-WC AI consent (`shellysvn:ai-consent:v1` + `ai:consent:*` IPC,
  Not-set/On/Off) + usage-history retention pruning.
- **#114** Verification suite: no secrets in provider payloads, no key leakage
  in logs/errors, consent gate, cancel-mid-stream (7 new test files).
- **#18** Privacy gate: `ai-privacy-scanner.ts` blocks/redacts secrets before
  any provider call; typed `secret_detected`/`consent_required` errors + UX.
- **#19** Prompt-injection: untrusted-data wrapping in every prompt builder;
  allowlist sanitizer for AI-rendered markdown in Review Center/explainer.
- **#20** Provider keys in safeStorage only (`ai-credentials.ts`, atomic 0600
  writes, refuse-on-unavailable); auth headers redacted from diagnostics.
- **#32** Mixed-revision banner + status-bar cell + one-click update-to-HEAD.
- **#33** Out-of-date pre-commit gate via existing `svn:statusRemote`;
  update-and-retry loop.
- **#46** Blame gutter in the diff viewer (viewport-cost rendering,
  click→revision card).
- **#47** Unified/side-by-side toggle, word-level highlights, ignore-whitespace/EOL.
- **#48** Image diff completed (overlay/slider/opacity, keyboard-accessible) +
  binary info cards.
- **#49** Diff wizard: rev↔rev / URL↔URL, saved comparisons; palette entry.
- **#71** Blame range comparison (rX vs rY attribution delta).
- **#68** Repo-browser drag-drop move/copy, multi-select + marquee, persistent
  per-repo sorting.
- **#69** Remote mkdir/delete/move with affected-count confirmations
  (typed-name confirmation for destructive ops).
- **#70** Revprop editor with old→new preview + permanent/server-logged notice.

### Wave 3 — Product depth (#45, #51–56, #58–67, #72–96, #62–65)
- **#45** Visual revision graph: lanes from copy points, branch/merge edges,
  10k revisions ≈ 30–50ms, graph/list toggle with synced selection.
- **#51** Tag wizard (templates `release/x.y.z`, semver bump vs latest tag,
  dry-run command preview).
- **#52** svn:ignore editor: APR-fnmatch linting, live match preview,
  apply-to-siblings, effective-vs-inherited view.
- **#53** svn:keywords editor with live expansion preview.
- **#54** Externals manager: table + peg/operative revision editing, legacy
  format warnings.
- **#55** Tree-conflict wizard: full accept-mode catalog per conflict kind,
  mine/theirs/base/merged previews, batch resolve with overrides.
- **#56** Property-conflict (merge editor) and binary-conflict flows.
- **#58** Update All: global + per-group, into the existing batch pipeline with
  per-WC results and retry-failed.
- **#59** Sidebar groups/favorites/pins, aggregate dirty badges, drag reorder.
- **#60** Relink flow (UUID-verify, weak-match confirmation) consuming Track A's
  `svn:applyWcRelink`/`svn:detectWcRelinks`.
- **#61** Disk-usage panel consuming `svn:analyzePristine`, vacuum via cleanup.
- **#62** Import/export wizards: progress, cancellation, dry-run estimates,
  junk-scan advisory (5 payload fields pending backend — below).
- **#63** Patch hub: index, dry-run conflict preview, .rej recovery UI.
- **#64** Shelf manager: table, expiry nudges, stale-aware prompts
  (rename/diff/export/import pending backend — below).
- **#65** Changelist suggestions (path heuristics, accept/adjust/dismiss).
- **#66** Log search: regex + field filters, date ranges, CSV/JSON export.
- **#67** Saved log views per WC (+ shipped defaults incl. date-preset views).
- **#72** Show-changes per log entry (list, detail, keyboard, repo browser).
- **#73** Recent messages per WC, template variables, subject guide.
- **#74** Issue-tracker integration (Jira/GitHub/custom presets) + shared
  `IssueKeyText` linkify (adopted in CommitHistory + LogViewer's native links).
- **#75** Pre-commit checklist (debug leftovers/TODO/oversized/forbidden
  patterns; consumes Track A's `svn:scanSecrets` which landed mid-wave).
- **#81** Notification center + toasts + long-op desktop notifications.
- **#83** Working-copy tabs (views over the shared query cache, ≤12, persisted).
- **#84** Session restore (tabs/route/active tab honoring `startupAction`).
- **#85** Drop-folder-to-open WC with validation overlay.
- **#86** Quick actions (open in Finder/VS Code/editors) from registered tools.
- **#87** External diff/merge tool config with argument templates — settings
  half in Wave 4 (#89–91 bundle).
- **#88** Onboarding checklist (auto-checked from observable state); sample
  repo pending backend (below).
- **#92** Skeletons for log/history + optimistic-UI helper (exemplar: saved views).
- **#93** Shared EmptyState + error-panel adoption on route surfaces.
- **#94** Status legend dialog (compile-enforced completeness) + palette entry.
- **#95** `prefers-reduced-motion` kill-switch + framer `reducedMotion="user"`.

### Wave 4 — Settings, tests, i18n, docs
- **#89** Searchable settings (~100-entry control index, jump-to-section);
  JSON import/export (versioned envelope, hostile-input-safe validation,
  secrets never exported); whole-app + per-section reset.
- **#90** Per-WC overrides (proxy/credential/profile) with effective-value
  resolution; informational proxy labeling until main-side routing lands.
- **#91** Named connection profiles (glob URL matching, CRUD, duplicate);
  profiles reference credential realms only — asserted secret-free by test.
- **#87** External diff/merge tool templates with per-kind placeholder
  validation + live expansion preview (launcher needs main-side consumer).
- **AI provider settings** — AI Providers tab: 6 providers, write-only key
  entry via safeStorage credentials, base URLs, model picker, cost preview,
  storage-unavailable handling.
- **#130** Property-based testing: dependency-free seeded harness
  (`src/__test-utils__/propertyCheck.ts`, deterministic, best-effort shrinker)
  + 14 suites / 90 tests across shared XML parsers and 13 renderer libs.
  Found 3 real bugs: shared status-parser `changelist` type-leak (→ Track A,
  below); order-dependent suggestion ids (FIXED); reject-file `+++` add-line
  drop (FIXED).
- **#134** i18n scaffolding: locale store + `t()`/`useTranslation`
  (providerless via useSyncExternalStore), deterministic invertible
  pseudo-localization, pure POT-like extractor, 28-key pilot
  (StatusLegendDialog + files route) with en byte-identity test.
- **#129/#132** e2e: all 5 runtime skips + 1 conditional un-skipped (root
  cause was test-environment assumptions — fixed with a real `svnadmin`
  fixture + native-dialog mocking; no app bugs); a11y smoke spec — now with
  full axe audits (`@axe-core/playwright` delivered by Track A, item 7 below);
  visual regression over 7 core
  screens with deterministic setup and darwin baselines (3 consecutive clean
  passes). Known pre-existing flake: random Electron launches die mid-test
  (~10–20% under load, A/B-proven against HEAD) — CI retries absorb it today.

## Final gate (Track B territory)

typecheck **0 errors** · unit suite **4,301 passed / 4 skipped / 0 failed**
(baseline 2,841 → +1,460 tests) · renderer lint clean. Repo-wide `lint` and
`test:skips` currently exit 1 solely from Track A's in-flight `src/main`
test files (2 unused imports in pristine-analyzer/app-shutdown-safety tests;
skipIf guards in background-status-scan / svn-portable-shelves / svn-runner /
path-guard not yet in `.spec/skipped-tests.md`) — flagged to Track A, not
fixed from this side per the ownership protocol.
- **#135** docs/troubleshooting.md + site error-map (verified against real
  error semantics: E155004=locked, E155015=incomplete, E160028=out-of-date),
  docs/architecture.md (mermaid), CONTRIBUTING.md, shortcuts page
  (programmatically diffed against DEFAULT_BINDINGS — 16/16), site build ×2 green.
- **#96** Tutorials refreshed: Review Center walkthrough, shelves +
  shelf-manager (pending-backend honesty), sparse checkout loop.

## Coordination requests for Track A

Ordered by user impact.

> **Status update (Track A, in the working tree):** items **1–3 are now
> implemented** — the four `svn:shelve:*` channels, the export/import payload
> fields, and `svn:createSampleRepository` — and the corresponding disabled
> affordances (ShelfManagerDialog rename/diff/export/import, export wizard
> options, import `--no-ignore`, onboarding playground step) are enabled.
> The renderer can drop its local pending-backend shims.
>
> **Second update:** items **4, 5, 9 and 12 are also done** (see inline
> notes). Item 6 turned out to be a non-issue: `invalidateStatusAfter<T>`
> preserves the handler's `{success: boolean}` return, so preload and main
> already agree. Remaining open: 7 (axe-core), 8 (i18n extraction script),
> 11 (per-WC proxy routing). Item 10 (external-tool launcher) is also
> delivered — see its inline note.
>
> **Third update:** items **7 and 8 are delivered** — see inline notes.

1. **Shelf IPC** ~~(blocks #64 completion)~~ **DELIVERED**: `svn:shelve:rename(name, path, newName)`,
   `svn:shelve:diff(name, path, against: 'working-copy'|'HEAD')`,
   `svn:shelve:export(name, path, outputPath)`,
   `svn:shelve:import(portableShelfPath, targetWorkingCopyPath)`.
   The ShelfManagerDialog UI is complete; the four affordances render disabled
   with these exact channel names.
2. **Export/import payload fields** ~~(blocks #62 options)~~ **DELIVERED**: `depth?`,
   `ignoreExternals?`, `nativeEol?`, `force?` on
   `exportRepositoryWithProgress` (channels `svn:export[WithProgress]`), and
   `noIgnore?` on `importRepositoryWithProgress`. Controls are rendered
   disabled with per-field notes.
3. **Sample-repository IPC** ~~(blocks #88 playground step)~~ **DELIVERED**: e.g.
   `svn:createSampleRepository()` wrapping `svnadmin create` + seed import →
   `file://` URL, then the existing `svn:checkout` finishes the flow.
4. **Merge-history parser field** **DELIVERED (superseded design)**: verified
   against the Subversion source that `svn log -g --xml` emits merged
   revisions as *nested `<logentry>` elements* — there is no `mod` attribute.
   `parseSvnLogXml` now flattens nested logentries into the merge commit's
   paths flagged `merged: true` (the `@_mod` read is kept as a defensive
   extra), `SvnLogPath.merged` exists, `lib/revisionGraph.ts` emits exact
   merge edges with the message heuristic as fallback, and both graph
   consumers (`RevisionGraph.tsx`, `RevisionGraphPanel.tsx`) request merge
   history — the panel's log-cache scope intentionally splits from
   CommitHistory's since `-g` output is a superset.
5. **Main-window geometry** **DELIVERED** (#40 main half): `src/main/window-geometry.ts`
   persists bounds+maximized per display id (debounced saves, close flush,
   off-screen fallback, hostile-input-safe restore); wired in `src/main/index.ts`.
6. **`window.api.svn.cleanup` typing**: **RESOLVED AS NON-ISSUE** —
   `invalidateStatusAfter<T>` preserves the handler's `{success: boolean}`
   return; preload and main already agree.
7. **axe-core dependency** ~~(A-exclusive package.json change)~~ **DELIVERED**:
   `@axe-core/playwright@^4.10.0` is a dev dependency and
   `accessibility-smoke.spec.ts` runs full axe audits (home, files empty state,
   settings dialog, command palette) on top of the structural checks — 5/5
   green (Electron `--project=electron`; legacy mode because Electron cannot
   host axe's blank finisher page). Violations found live in renderer app code
   (not fixed from the A side per ownership); each is disabled in-scope with a
   justification comment and reported here:
   - `color-contrast` — dark-theme token debt: `text-muted` #727d8a on #161b22
     (~4.1:1), `kbd` #727d8a on #30363d (~2.9:1), `accent` #6366f1 on dark
     (~3.9:1), `text-faint` #4d5866 (~2.1:1). Needs a palette re-tune.
   - `aria-allowed-role` — `<footer role="status">` in `ui/StatusBar.tsx`
     (the smoke spec itself asserts this live region; wants role="region" +
     aria-live).
   - `aria-prohibited-attr` — NotificationCenter's fixed toast region is a
     `<div aria-label>` with no role (`layout/NotificationCenter.tsx`).
   - `aria-required-children` + `region` — TabBar's `role="tablist"` contains
     the "new tab" `button[aria-haspopup]` and sits outside any landmark
     (`layout/TabBar.tsx`).
   - `select-name` — the Language and Startup section `<select>`s in
     `settings/SettingsPanels.tsx` have no accessible name (real bug).
   - `scrollable-region-focusable` — `.command-palette-list` items are not
     focusable (keyboard nav goes through the search input).
   - `page-has-heading-one` (files) — best-practice rule; screens are
     landmark-based, heading hierarchy is an app-wide decision.
8. **i18n extraction script** **DELIVERED**: `scripts/extract-strings.mjs` walks
   `src/renderer/src` (tests/generated code excluded), feeds the pure extractor
   (`src/renderer/src/i18n/extract.ts`), and writes the deterministic POT-like
   catalog to `src/renderer/src/i18n/extracted.json` (361 files / 2,713
   candidates at delivery). npm scripts: `bun run i18n:extract` regenerates,
   `bun run check:i18n` is the drift gate (exit 1 on stale catalog). Usage is
   documented in the extractor header.
9. **Status-parser type leak** **DELIVERED** (found by property testing, `packages/shared/src/svn-parsers.ts`): fixed by disabling `parseAttributeValue` on the shared xmlParser — coercion is lossy (`name="0x1F"` strnum-converts to 31) while disabling preserves every name exactly, and every consumer in the file already parses strings. The property generator is un-narrowed. The same leak in `src/main/utils/svn-xml.ts` `parseSvnStatusEntriesXml` is fixed with targeted `String()` coercion (that instance must keep numeric conversion for blame); logic-engine parsers audited clean.
10. **Custom external-tool launcher** (#87 completion) **DELIVERED**: the pure placeholder/expansion logic moved to `packages/shared/src/external-tool-templates.ts` (renderer lib re-exports it, so settings-UI preview and main spawn can never diverge). `src/main/services/external-template-launcher.ts` validates the stored template, expands placeholders, verifies the executable, and spawns detached with an argv array (`shell: false`, no env). `external:openDiffTool`/`external:openMergeTool` resolve a settings template by id (checked between the built-in aliases and the registry; channel signatures unchanged, so preload/types/IPC contract are untouched), returning SvnMutationResult-style `errorCode`s (`TEMPLATE_INVALID`, `PLACEHOLDER_UNRESOLVED`, `EXECUTABLE_NOT_FOUND`, `SPAWN_FAILED`, `TOOL_CONFIG_INVALID`). SettingsManager now accepts `externalToolTemplates` ids as `diffMerge.externalDiffTool`/`externalMergeTool` (and override) values, so the renderer can point those settings at a custom template tool. Track B can now wire the settings UI selection.
11. **Per-WC proxy routing** (#90 completion) **DELIVERED**: the pure parsing/precedence logic moved to `packages/shared/src/wc-connection-settings.ts` (renderer libs re-export it, so settings-UI preview and main routing can never diverge). `src/main/services/wc-operation-context.ts` reads the renderer-persisted override/profile stores main-side (via `getStore()`), walks the command cwd up to `.svn`, and resolves override → linked profile → URL-pattern-matched profile; `svn-executor.ts` applies it centrally in `runSvn`/`runSvnMuccText`, so every operation picks up per-WC routing with zero call-site churn (explicit per-call operationContext still wins). Repository-URL operations (repo browser) resolve the originating working copy through the monitor's URL registry (registered one-way from `ipc/monitor.ts`), else fall back to profile glob matching. `credentialsProfileId` realms are dereferenced through the existing auth cache (`cache.get(realm)`) ahead of URL-cached credentials; a realm miss falls through unchanged. Settings-UI proxy labeling now states routing is live; IPC channel signatures unchanged (contract green).
12. **Global shortcut overrides** **DELIVERED**: Layout.tsx's global handlers (⌘K/⌘B/⌘⇧A/⌥⌘P/?) now resolve through `useShortcutBindings` (new `command-palette-quick`/`ai-review-center`/`performance-dashboard`/`shortcut-help` bindings); remaps propagate live via the overrides-changed event (self-echo suppressed with an origin tag), the cheat sheet and recorder consume the same combo builder, and the site shortcuts page is updated.
13. **Script-change requests**: none — no new npm scripts were needed by Track B.

## Known follow-ups (Track B internal, not blocking)

- Repo-browser `ShelfDialog` handlers in `RepoBrowserView` are display-only
  stubs (open/close, empty files) — wire to the real shelve IPC when touched
  next; the ShelfManagerDialog is the functional surface.
- ~~`CLAUDE.md` claims a Zustand dependency that doesn't exist~~ **fixed** —
  now documents the plain `useSyncExternalStore` store modules.
- DialogBase migration remains for ~15 lower-traffic dialogs (pattern is
  documented in the DialogBase header).
- Density CSS vars (`--row-height` etc.) are wired app-wide; a retrofit pass
  over per-component hardcoded row heights (FileExplorer, MillerColumns,
  RepoTreeNode/RepoContentsRow) would let compact mode reach 100%.
- ~~`BranchSwitcher` (features/branches) still calls `svn switch` directly~~
  **fixed** — now routes through `useSvnActions.switchTo` (inherits the #41
  cache reset and surfaces real error messages).
- Stale default pins in `settings-defaults.test.ts` / `settingsTransfer.test.ts`
  (timeout 30→300s, `aiCommit.claudeModel`/`disabledCliProviders` from the
  recovery/auth commit) **fixed** — they had been failing on the branch tip.
- ~~Repo-browser `RevisionLogView` got show-changes; its full filter-bar/saved-view
  adoption of `useLogViewSurface` is prepared (snippet in the log agent's
  report) but not yet mounted.~~ **fixed** — RevisionLogView now mounts
  `useLogViewSurface` (filter bar, saved views, export; views persisted per
  repository under a `repo:`-prefixed storage key). Path-scoped filters match
  nothing there because the repo-browser entry carries a changed-path count,
  not the paths.
- ~~Un-migrated inline query keys (ChangelistDialog, LockManagementDialog,
  BlameViewer, etc.) behave correctly via registry segment matching;
  migration is cosmetic.~~ **fixed** — every renderer inline query-key literal
  now goes through `lib/queryKeys.ts`; new factories were added for the
  families that had none (svn:blame, blame-context, tag-wizard svn:list,
  changelist-suggestions, disk-usage, patch-hub, shelf-manager config,
  shell status, sidebar/settings/app-chrome scopes).
