# Beta Release Plan — 1.2.0-beta.1

Two-agent execution plan. The backlog below is the full candidate pool (~135 items); the
split assigns every item to exactly one owner so the two agents never edit the same files.

- **Agent A — Platform & Trust**: owns `src/main/`, `src/preload/`, `packages/`,
  `scripts/`, `build/`, CI, packaging, and release infrastructure.
- **Agent B — Product & Experience**: owns `src/renderer/`, `apps/site`, `docs/`,
  and tutorials.
- **Exception**: the entire AI vertical (`src/main/services/ai-*`, `src/main/ipc/ai.ts`,
  Review Center UI) is owned end-to-end by **Agent B**, to avoid splitting a cohesive domain.

---

## Full Backlog (numbered for reference)

### Security Hardening
1. SSRF protection for webhook targets (block private/link-local IPs, re-resolve DNS at request time)
2. Bind local-status-server to 127.0.0.1 with per-session bearer token + port-collision handling
3. Migrate credential storage to Electron `safeStorage`/OS keychain; verify nothing persists plaintext
4. Strict CSP for renderer (no `unsafe-inline`/`eval`, no remote origins); roll out report-only first
5. Enable Electron sandbox + fuses (`runAsNode`, `nodeCliInspect`, prod devtools off)
6. Deep-link/protocol-handler hardening: allowlisted actions, arg format/length caps, zero shell interpolation
7. Path-traversal guard on every `fs:*` IPC call (resolve + approved-root containment + symlink check)
8. Zip-slip protection for export/patch/shelf extraction (validate every archive entry path)
9. fast-xml-parser hardening: entity processing off, attribute/text size caps, fuzz against billion-laughs
10. Cap spawned-process stdout/stderr buffers; global timeouts on all SVN commands
11. Central secret-redaction layer for logs, error reports, and crash dumps (credential-registry scrub)
12. Auto-clear clipboard N seconds after password copy
13. Rate-limit + payload-size caps on expensive IPC channels
14. Updater downgrade protection (semver floor), enforced HTTPS metadata, publisher-name verification
15. Runtime code-signature tamper self-check on macOS/Windows launch
16. Generate SBOM + artifact attestations for every release
17. Supply-chain hygiene: `bun audit` in CI, lockfile integrity check, Renovate/Dependabot
18. AI privacy gate: secret-pattern scanner blocks `.env`/key material from ever reaching providers; per-WC consent toggle
19. Prompt-injection defenses: repo/diff content treated as untrusted data; sanitize AI-rendered markdown/HTML in Review Center
20. AI provider keys in safeStorage only; redact auth headers from diagnostics
21. Add SECURITY.md, threat-model doc, and private vulnerability-disclosure channel

### Bugs & Robustness
22. Single-instance lock with second-instance handoff (two instances mutating one WC = corruption)
23. Detect stale `.svn/lock` at startup and offer guided cleanup
24. Graceful shutdown: kill child `svn` processes on quit, flag operations as interrupted
25. Sleep/resume handler: abort in-flight network ops, re-verify connectivity before retry
26. Watcher lifecycle audit: close chokidar watchers on WC remove/relocate; debounce save-storm bursts
27. Close remaining gaps in option-like paths / `@`-peg filename handling across every multi-target op
28. Windows long paths (>260), UNC shares, reserved device names (CON, PRN)
29. Unicode NFC/NFD normalization (macOS) + case-collision warnings on case-insensitive filesystems
30. Disk-full handling during checkout/export/update with actionable recovery messaging
31. Interrupted-mutation recovery flow (detect partial update/commit, propose cleanup/retry)
32. Mixed-revision WC banner with one-click "update to HEAD"
33. Out-of-date check before commit, optional auto-update-and-retry loop
34. Timezone/DST-correct log timestamps + relative-time display
35. Handle empty repos (r0 only) and missing trunk/tags layout gracefully
36. IPv6 literals, IDN hostnames, percent-encoded segments round-trip correctly in repo browser
37. Authenticated-proxy and client-cert flows tested end-to-end + visible in settings diagnostics
38. Self-signed/expired cert UX: clear trust prompt, no silent retry loops
39. Fix VirtualizedTree scroll-jump when statuses refresh mid-scroll
40. Persist sort order, column widths, dialog geometry, and per-monitor window positions
41. Invalidate React Query caches after relocate/switch (stale URL keys)
42. Focus trap + Escape handling in nested dialogs; restore focus to trigger
43. Eliminate infinite spinners: every async path gets timeout + error state + retry button
44. Finish locale-independent revision parsing for remaining ops (switch, relocate, etc.)

### SVN Feature Completeness
45. Visual revision graph (branch/merge history with copy-point markers)
46. Blame gutter in the content/diff viewer; click a line to see its revision
47. Side-by-side vs unified diff toggle, word-level highlights, ignore-whitespace options
48. Image diff (overlay/slider compare) + binary file info cards
49. Arbitrary revision-to-revision / URL-to-URL diff wizard with saved comparisons
50. Switch & relocate dialogs with dry-run summary and recent-branches picker
51. Tag/release wizard: create tags from any revision with name templates (`release/x.y.z`)
52. `svn:ignore` / `svn:global-ignores` editor with pattern linting and apply-to-siblings
53. `svn:keywords` editor with live preview
54. Externals manager UI: table view, peg/operative revision editing
55. Full tree-conflict resolution wizard (all accept modes, mine/theirs/base previews)
56. Property-conflict and binary-conflict resolution flows
57. Lock upgrades: steal/break with owner warning, lock comments, expiry display
58. "Update All" batch update across multiple working copies
59. Sidebar working-copy groups/favorites with aggregate dirty badges
60. Auto-relink working copies whose folders were moved/renamed on disk
61. Pristine-store analyzer: disk usage breakdown + scheduled vacuum prompts
62. Import/export wizards wiring existing progress-capable implementations (depth, externals, cancellation)
63. Patch hub: create/share/apply with conflict preview and reject-file recovery UI
64. Shelf manager: rename, diff shelves, expiry nudges, portable-shelf import/export
65. Changelist auto-grouping suggestions based on path heuristics
66. Log search: regex + full-text, author/date/path/message filters, CSV/JSON export
67. Saved log filters and named views per working copy
68. Repo browser: drag-drop move/copy, multi-select ops, persistent sorting
69. Remote mkdir/delete/move with affected-count confirmation summaries
70. Revprop editing with explicit confirmation + server-logging notice
71. Blame range comparison (annotate between rX and rY)
72. "Show changes" action on every log entry (jumps straight to that revision's diff)
73. Commit dialog: recent-messages recall, templates, spellcheck, issue-key autolink
74. Issue tracker integration (Jira/GitHub): linkify IDs in log and commit views
75. Pre-commit checklist: debug leftovers, TODO markers, oversized files, forbidden patterns
76. Block committing likely secrets (pattern detection) behind explicit override

### UX & Product Polish
77. Command palette (Cmd/Ctrl+K) with fuzzy search over all actions
78. Shortcut cheat-sheet overlay + remappable keybindings
79. Dark/light/system themes, accent color picker, high-contrast mode
80. Density toggle (compact/comfortable rows) + font-size control
81. Notification center consolidating toasts; desktop notifications for long operations
82. System tray / menu-bar item with per-WC dirty summary and quick actions
83. Multi-window or tab support (several working copies at once)
84. Session restore: reopen last WC, tabs, and sidebar state on launch
85. Drag & drop: drop folder to open/add a WC; drop files onto changelists
86. Quick actions: "Open in Terminal / VS Code / Finder|Explorer" (extend external-tool registry)
87. Configurable external diff/merge tools (Beyond Compare, KDiff3, VS Code) with argument templates
88. First-run onboarding checklist + built-in sample repo playground
89. Searchable settings page + settings import/export/reset
90. Per-WC settings overrides (proxy, credentials profile, AI opt-in)
91. Named connection profiles (repo + proxy + auth bundles) reused across WCs
92. Skeleton loaders; optimistic UI for cheap mutations with rollback on failure
93. Empty states with next-step CTAs; consistent error panels everywhere
94. Status-overlay legend/help panel
95. Respect `prefers-reduced-motion`
96. Tutorial refresh covering Review Center, shelves, sparse checkout

### Performance
97. Stream-parse `svn status --xml` incrementally for huge working copies
98. Route-level code splitting; lazy-load react-syntax-highlighter language packs
99. Variable-height virtualization for the log list; windowed blame rendering
100. Prefetch adjacent revisions in history; prefetch repo-browser children on hover
101. Coalesce/throttle watcher-triggered status refreshes
102. Pause watchers + timers when the window is hidden/minimized (CPU/battery)
103. IPC structured-clone audit; eliminate double serialization of large payloads
104. Startup profiling: defer updater/auth/network init until after first paint
105. CI perf-regression gate on synthetic 10k/100k-file WCs (extend `test:perf`)
106. 24-hour memory-leak soak test (repeated scans, dialogs, watcher churn)
107. Idle-time maintenance scheduler: cache pruning + vacuum prompts

### AI Features
108. More providers: Anthropic-native, Azure OpenAI, custom OpenAI-compatible base URL, Ollama/LM Studio local models
109. Streaming responses with cancel + token/cost estimate shown before sending
110. Commit-message style learning from the repo's own history
111. AI merge-conflict explainer embedded in the conflict wizard
112. Review Center bulk triage: severity filters, accept/dismiss-all, keyboard-driven flow
113. Per-WC AI enable/disable + retention limit on AI usage history
114. Verification suite proving no secrets appear in any provider payload

### CLI & Logic Engine
115. `--json` output for every command, stable machine-readable exit codes, `--no-color`
116. Shell completions (bash/zsh/fish/PowerShell) + man pages
117. `watch` subcommand streaming the same status feed the GUI sees
118. Config file support with documented precedence (env > flag > file)
119. Parity contract tests: logic-engine vs GUI emit identical commands/results
120. Interactive TUI mode (select files, confirm commits from terminal)

### Distribution & Release
121. Flatpak + Snap packages; signed apt/yum repositories
122. Homebrew cask, winget, and Chocolatey submissions
123. Linux arm64 + Windows arm64 builds; portable Windows zip
124. Staged rollout percentages + auto-rollback on crash-rate spike
125. In-app release-notes viewer before installing an update; defers while ops are running
126. Opt-in crash/analytics telemetry with published schema and local-first queuing
127. Diagnostics-bundle exporter (redacted logs/settings) + in-app beta feedback widget
128. One-command release gate chaining all `verify:release-*` scripts

### Quality & Docs
129. Un-skip remaining Playwright suites; add axe accessibility audits to E2E
130. Property-based tests (fast-check) for externals/patch/property-name parsers
131. XML fuzz suite (malformed, truncated, hostile-entity server responses)
132. Visual regression snapshots for core screens across all three OSes
133. Minimum-supported SVN client matrix in CI (1.8 → 1.14 behavior differences)
134. i18n scaffolding + string extraction + pseudo-localization test
135. Docs: troubleshooting map (SVN error → app guidance), shortcuts page, refreshed architecture diagram, CONTRIBUTING.md

---

## Track A — Platform & Trust (~55 items)

### A Phase 1 — Security Foundation (weeks 1–2)
- Items **1–9**: SSRF guards, status-server lockdown, safeStorage credential migration,
  CSP, sandbox/fuses, deep-link hardening, fs path-traversal guard, zip-slip, XML hardening
- Items **22–26**: single-instance lock, stale-lock recovery, graceful shutdown,
  sleep/resume handling, watcher lifecycle audit
- **Item 3 ships first** — it unblocks Agent B's AI work in Phase 2

### A Phase 2 — Robustness + Core SVN Backends (weeks 3–4)
- Items **27–31, 35–38, 44**: option-like paths, Windows long paths, Unicode/case
  collisions, disk-full recovery, interrupted mutations, r0 repos, IPv6/IDN URLs,
  proxy/client-cert flows, locale-independent revisions
- Backend services for:
  - Switch/relocate validation (**50** backend half)
  - Lock steal/break (**57** backend)
  - WC auto-relink detection (**60** detection service)
  - Pristine analyzer (**61** analyzer service)
  - Revprop confirmations (**70** backend)
  - Pre-commit secret scanner (**76** scanner service)

### A Phase 3 — Infra + Release (week 5)
- Performance: stream-parsed status XML (**97**), IPC clone audit (**103**),
  hidden-window pause (**104**), startup deferral (**106**), CI perf gate (**107**),
  idle maintenance (**109**)
- CLI/engine: **115–120** including parity contract tests (**119**)
- Distribution: Flatpak/Snap/apt/yum (**121**), cask/winget/Chocolatey (**122**),
  arm64/portable builds (**123**), staged rollout (**124**), updater metadata gating
  for release-notes viewer (**125** backend), telemetry opt-in (**126**),
  diagnostics exporter (**127**), one-command release gate (**128**)

### A Ongoing
- Fuzz suites (**131**), SBOM/attestation (**16–17**), supply-chain CI (**17**),
  SVN client matrix CI (**133**), security items **10–21** slotted by risk

---

## Track B — Product & Experience (~70 items)

### B Phase 1 — Quick Wins (weeks 1–2, no A dependency)
- Renderer fixes: scroll-jump (**39**), geometry persistence (**40**), query
  invalidation after relocate (**41**), focus traps (**42**), spinner elimination (**43**)
- UX foundation: command palette (**77**), shortcut cheat-sheet + remapping (**78**),
  themes/accent/high-contrast (**79**), density/font controls (**80**)

### B Phase 2 — Features (weeks 3–4, depends on A Phase 1)
- AI vertical end-to-end: providers incl. local models (**108**), streaming +
  cost estimates (**109**), style learning (**110**), conflict explainer (**111**),
  bulk triage (**112**), per-WC consent + retention (**113–114**),
  prompt-injection defenses + redaction suite (**18–20**) — built on A's safeStorage migration
- Mixed-revision banner + out-of-date check UI (**32–33**)
- Diff/blame: blame gutter (**46**), side-by-side toggle (**47**), image diffs (**48**),
  diff wizard (**49**), annotate ranges (**71**), show-changes-per-log-entry (**72**)

### B Phase 3 — Product Depth (week 5)
- Revision graph (**45**), tag wizard (**51**), ignore editor (**52**), keywords editor
  (**53**), externals manager (**54**), conflict wizards (**55–56**)
- Sidebar: groups/favorites (**59**), Update All UI (**58**), relink flow (**60 UI**),
  pristine UI (**61 UI**, on A's analyzer)
- Log/repo browser: search + saved filters (**66–67**), drag-drop ops (**68**),
  affected-count confirms (**69**), revprop UI (**70 UI**)
- Commit dialog upgrades (**73–75**)
- Polish batch: notification center (**81**), tray item (**82**), multi-window/tabs (**83**),
  session restore (**84**), drag & drop (**85**), quick actions (**86**), external tools (**87**),
  onboarding (**88**), searchable settings + profiles (**89–91**), optimistic UI/skeletons (**92–93**),
  empty states/error panels (**93**), status legend (**94**), reduced motion (**95**),
  tutorial refresh (**96**), patch hub UI (**63**), shelf manager UI (**64**),
  changelist suggestions (**65**), import/export wizard wiring (**62**)

### B Ongoing
- E2E un-skip + axe audits (**129**), visual regression (**132**),
  property-based parser tests (**130**), i18n scaffolding (**134**),
  docs/troubleshooting map/CONTRIBUTING (**135**)

---

## Coordination Protocol

### Hot files (edit protocol)
| File(s) | Rule |
|---|---|
| `packages/shared/src/types.ts`, `src/preload/api/*.ts` | Additive-only changes; A owns merges, B rebases daily |
| `package.json`, build configs, CI workflows | A-exclusive; B files script-change requests |
| `CHANGELOG.md` | Append-only, both agents |

### Rituals
- Branches: `a/*` and `b/*` namespaces off `main`; cross-review every PR
  (A reviews B's security-relevant UI, B reviews A's DX-breaking changes)
- End-of-phase integration: run `bun run verify` + `bun run test:e2e` +
  `bun run verify:svn-workflows` together on merged main before starting next phase
- Disputes: platform/architecture calls go to A, product/UX calls go to B

### Cross-track dependencies
| B needs | A delivers | When |
|---|---|---|
| AI key storage (108+) | safeStorage migration (#3) | A Phase 1, first |
| Pristine UI (61) | Analyzer service (#61 backend) | A Phase 2 |
| Secret-scan warning UI (75–76) | Scanner service (#76) | A Phase 2 |
| Release-notes viewer (125 UI) | Updater metadata gate | A Phase 3 |

---

## Timeline

| Week | Track A | Track B |
|---|---|---|
| 1–2 | Phase 1: security foundation | Phase 1: renderer fixes + UX foundation |
| 3–4 | Phase 2: robustness + SVN backends | Phase 2: AI vertical + diff/blame features |
| 5 | Phase 3: infra + release engineering | Phase 3: product depth + polish batch |
| 6 | Integration week: merge, joint `verify` + e2e + svn workflow gates, beta cut, changelog, tagged release | same |

Not everything will fit — cut from B Phase 3's polish batch first, then A Phase 3's
distribution stretch goals (#122–123). Never cut security Phase 1.
