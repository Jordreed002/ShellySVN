# ShellySVN — User Journeys & Test Strategy

This document defines the **user scenarios and journeys** that drive test coverage
for ShellySVN. Every test we write — unit, integration, or E2E — should trace back
to one of these journeys so coverage stays anchored to real user value rather than
to implementation details.

The journeys are derived from:

- The **48-channel IPC surface** (`src/main/ipc/*`) — the full set of operations the
  app can perform.
- The **feature components** (`src/renderer/src/components/{home,checkout,commit,files,
sidebar,settings,…}`) and routes (`files`, `history`, `repo-browser`).
- The existing **1,736 unit tests** (182 files) and **81 E2E tests** (12 specs).

The companion spreadsheet **`test-tracker.csv`** records, per test: which journey it
belongs to, its layer, area, file, name, and status (`existing` / `gap` / `planned`).

---

## How to read a journey

Each journey is written as a numbered sequence of **steps**. Each step names:

- the **action** the user takes,
- the **IPC channel(s)** it exercises,
- the **component(s)** involved,
- and the **observable outcome** that a test should assert.

Tests can cover a single step (unit/integration) or chain several steps (E2E journey).

---

## J1 · First-run onboarding

> _A brand-new user opens ShellySVN for the first time._

| Step | Action                   | IPC / Component                 | Observable outcome                                        |
| ---- | ------------------------ | ------------------------------- | --------------------------------------------------------- |
| 1    | Launch the app           | `main/index.ts` window creation | Window opens with correct title; tutorial overlay appears |
| 2    | Dismiss tutorial         | `Close tutorial` button         | Overlay closes; Welcome/Home screen visible               |
| 3    | See empty state          | `home/HomeScreen.tsx`           | No working copies; CTA to Add Repository / Browse present |
| 4    | (optional) Open Settings | `store:get` defaults            | Defaults render (no crash)                                |

**Covered by:** `app-launch.spec.ts`, `welcome-screen.spec.ts`, `onboarding.state.test.tsx`.
**Gap:** end-to-end "first run with zero config never crashes" journey that dismisses the tutorial and reaches the home empty-state in one `test`.

---

## J2 · Repository checkout (happy path)

> _A user checks out a working copy for the first time._

| Step | Action                  | IPC / Component                     | Observable outcome                       |
| ---- | ----------------------- | ----------------------------------- | ---------------------------------------- |
| 1    | Click "Add Repository"  | sidebar button                      | Checkout dialog opens                    |
| 2    | Enter SVN URL           | `checkout/CheckoutPrompts.tsx`      | URL field populated                      |
| 3    | Auth if protected       | `svn:native-auth`, `auth:list/save` | Credentials prompt; on success saved     |
| 4    | Pick local path         | `dialog:showOpenDialog`             | Directory chosen                         |
| 5    | (optional) Choose items | `ChooseItemsDialog` → `svn:list`    | Sparse selection                         |
| 6    | Pick depth, submit      | `svn:checkout` + `svn:progress`     | Progress bar; on success repo in sidebar |
| 7    | Land in File Explorer   | `files/WorkingCopyTree.tsx`         | Working copy contents listed             |

**Covered by (structural):** `sparse-checkout.spec.ts`, `svn-operations.spec.ts` (Checkout),
`CheckoutDialog.sparse.test.tsx`, `svn-checkout.test.ts`.
**Gap:** a true journey that mocks `svn:checkout` success and asserts the repo appears in
the sidebar _and_ the file explorer loads — currently each step is verified in isolation.

---

## J3 · Repository browsing (remote, no checkout)

> _A user explores a remote repository without checking it out._

| Step | Action                      | IPC / Component                 | Observable outcome       |
| ---- | --------------------------- | ------------------------------- | ------------------------ |
| 1    | Open Repo Browser           | `routes/repo-browser/index.tsx` | URL input + tree         |
| 2    | Enter URL, browse           | `svn:list` (lazy)               | Top-level entries load   |
| 3    | Drill into a dir            | `svn:list` (cached, lazy)       | Children load on expand  |
| 4    | Filter listings             | repo-browser filter             | List narrows             |
| 5    | View file contents          | `svn:cat`                       | Content renders          |
| 6    | View log                    | `svn:log`                       | Revisions list           |
| 7    | Hit auth / connection error | `repoBrowserAuth`, error UI     | Recoverable prompt shown |

**Covered by:** `repo-browser.spec.ts` (filter + recover), `repoBrowserAuth.test`,
`repoBrowserCache.test`, `repoBrowserRevision.test`, `useRepoBrowserState.test`.
**Gap:** explicit "browse → cat → log" content-verification journey.

---

## J4 · Daily edit & commit loop

> _The core loop: open a working copy, change files, commit._

| Step | Action                         | IPC / Component                    | Observable outcome                      |
| ---- | ------------------------------ | ---------------------------------- | --------------------------------------- |
| 1    | Open working copy from sidebar | `svn:status`, `svn:info`           | Tree + status dots render               |
| 2    | Modify a tracked file          | (external edit) → `svn:status`     | File shows _modified_                   |
| 3    | Add new untracked file         | `svn:add`                          | File shows _added_                      |
| 4    | Open Commit dialog             | `commit/useCommitDialogController` | Selected files + message box            |
| 5    | Write message, commit          | `svn:commit`                       | Success; status clears; history updates |
| 6    | Verify in history              | `svn:log`                          | New revision appears                    |

**Covered by:** `svn-operations.spec.ts` (Commit dialog structure), `useCommitDialogController.test.tsx`,
`commitMessageHistory.test.tsx`, `useCommitTemplates.test.tsx`, `commitRules.test`, `commitWarnings.test`.
**Gap:** a journey that goes status → add → commit → history and asserts the new revision
landed; the commit-dialog tests today stop at UI structure.

---

## J5 · Update & stay in sync

> _A user pulls the latest changes from the remote._

| Step | Action                 | IPC / Component                | Observable outcome                |
| ---- | ---------------------- | ------------------------------ | --------------------------------- |
| 1    | See incoming revisions | `home/useIncomingRevisions.ts` | Badge / briefing shows N incoming |
| 2    | Click Update           | `svn:update` + `svn:progress`  | Progress; clean update            |
| 3    | Confirm clean state    | `svn:status`                   | No conflicts                      |

**Covered by:** `svn-operations.spec.ts` (Update button accessible), `remoteUpdateTarget.test`,
`useIncomingRevisions` (via home tests).
**Gap:** journey asserting the incoming badge clears / decrements after a successful update.

---

## J6 · Conflict resolution

> _An update produces a conflict; the user resolves it._

| Step | Action                     | IPC / Component          | Observable outcome         |
| ---- | -------------------------- | ------------------------ | -------------------------- |
| 1    | Update triggers conflict   | `svn:update`             | File marked conflicted     |
| 2    | Detect conflict type       | text vs tree detection   | Correct resolver offered   |
| 3    | Open resolve dialog        | File Explorer resolve UI | Options: mine/theirs/merge |
| 4    | Launch external merge tool | `external-tool-registry` | Tool opens                 |
| 5    | Mark resolved              | `svn:resolve`            | Status clears              |
| 6    | Commit resolution          | `svn:commit`             | Clean commit               |

**Covered by:** `conflict-resolution.spec.ts` (real), `conflict-resolution-workflows.test.tsx`,
`text-conflict-detection.test`, `tree-conflict-detection.test.tsx`, `lock-conflict-recovery.test.tsx`.
**Relatively well covered** — this is the model journey others should emulate.

---

## J7 · History & investigation

> _A user investigates "who changed what, when"._

| Step | Action              | IPC / Component                       | Observable outcome |
| ---- | ------------------- | ------------------------------------- | ------------------ |
| 1    | Open History        | `routes/history/index.tsx`, `svn:log` | Log entries load   |
| 2    | Filter / search log | `logFilters`                          | List narrows       |
| 3    | Select a revision   | `svn:diff`, changed-files list        | Diff renders       |
| 4    | Blame a file        | `svn:blame`                           | Annotated lines    |
| 5    | Revision graph      | `RevisionGraph`                       | Graph renders      |

**Covered by:** `svn-operations.spec.ts` (History nav + empty state), `LogViewer.test.tsx`,
`BlameViewer.test.tsx`, `RevisionGraph.test.tsx`, `logFilters.test`.
**Gap:** "select revision → see changed files → diff" chained journey test.

---

## J8 · Branching & tagging

> _A user creates branches/tags and switches between them._

| Step | Action            | IPC / Component          | Observable outcome           |
| ---- | ----------------- | ------------------------ | ---------------------------- |
| 1    | Create branch/tag | `svn:copy`               | New remote path created      |
| 2    | Switch to it      | `svn:switch`             | Working copy reflects branch |
| 3    | Compare branches  | `BranchTagCompareDialog` | Diff summary                 |
| 4    | Merge back        | `svn:merge`              | Changes integrated           |

**Covered by:** `BranchSwitcher.test.tsx`, `BranchTagCompareDialog.test.tsx`,
`MergeWizard.test.tsx`, `branchDetection.test`.
**Gap:** full create → switch → merge journey; merge is unit-tested only.

---

## J9 · File locking (reserved checkout)

> _A user locks a file for exclusive editing, then releases it._

| Step | Action                    | IPC / Component    | Observable outcome   |
| ---- | ------------------------- | ------------------ | -------------------- |
| 1    | Lock a file               | `svn:lock`         | Lock indicator shown |
| 2    | Edit, commit              | `svn:commit`       | Allowed while locked |
| 3    | Unlock                    | `svn:unlock`       | Lock released        |
| 4    | (another user) steal lock | `svn:lock` (steal) | Recovery path        |

**Covered by:** `svn-locks.test`, `lock-conflict-recovery.test.tsx`.
**Gap:** E2E lock indicator + unlock UI verification.

---

## J10 · Sparse-checkout management

> _A user controls which parts of a large repo are materialized locally._

| Step | Action                      | IPC / Component                | Observable outcome      |
| ---- | --------------------------- | ------------------------------ | ----------------------- |
| 1    | See "not checked out" items | `files/MillerColumns` excluded | Ghosted entries         |
| 2    | Include a directory         | sparse ops                     | Files materialize       |
| 3    | Exclude a directory         | `svn:exclude`                  | Files removed from disk |
| 4    | Working copy reflects state | `svn:status`                   | Tree consistent         |

**Covered by:** `sparse-checkout.spec.ts`, `integration/sparse-checkout.test.tsx`,
`sparse.error-handling.test.tsx`, perf tests, `MillerColumns.excluded.test.tsx`.
**Relatively well covered.**

---

## J11 · Settings & configuration

> _A user configures ShellySVN to their environment._

| Step | Action                       | IPC / Component                            | Observable outcome              |
| ---- | ---------------------------- | ------------------------------------------ | ------------------------------- |
| 1    | Open Settings, navigate tabs | `settings/*`                               | All tabs render                 |
| 2    | Change theme                 | appearance settings                        | Applied immediately + persisted |
| 3    | Set SVN client path          | SVN tab, validation                        | Path validated                  |
| 4    | Configure external tools     | `code-editors`, `external-tool-validation` | Diff/merge/editor set           |
| 5    | Configure notifications      | `NotificationService`                      | Sound/notify toggles            |
| 6    | Persist across restart       | `store:set/get`                            | Values survive                  |

**Covered by:** `settings.spec.ts` (broad), `SettingsPanels.auth.test`,
`SettingsPreviewContext.theme.test.tsx`, `OpenWithSettings.test.tsx`,
`external-tool-validation.test`, `externalToolOverrides.test`.
**Gap:** explicit "change setting → restart → still set" persistence journey (spec only checks
"while app is open").

---

## J12 · Properties & metadata

> _A user manages SVN properties (ignores, etc.)._

| Step | Action                | IPC / Component               | Observable outcome |
| ---- | --------------------- | ----------------------------- | ------------------ |
| 1    | Set `svn:ignore`      | `svn:propset`                 | Property stored    |
| 2    | List / get properties | `svn:proplist`, `svn:propget` | Properties shown   |
| 3    | Delete a property     | `svn:propdel`                 | Removed            |
| 4    | Revision properties   | `svn:revpropget/set/del`      | Managed            |

**Covered by:** `PropertiesDialog.remote.test.tsx`, `svn-metadata.test`.
**Gap:** ignore-set → file disappears from untracked list journey.

---

## J13 · Diagnostics & recovery

> _A user recovers from an interrupted/failed operation._

| Step | Action              | IPC / Component   | Observable outcome    |
| ---- | ------------------- | ----------------- | --------------------- |
| 1    | Run cleanup         | `svn:cleanup`     | Working copy repaired |
| 2    | Run diagnostics     | `svn:diagnostics` | Health report         |
| 3    | Relocate moved repo | `svn:relocate`    | URL updated           |

**Covered by:** `svn-diagnostics.test`, `RepoDiagnostics.test`, `RepoDiagnosticsPanel.test.tsx`.
**Gap:** cleanup-after-failed-commit recovery journey.

---

## J14 · App lifecycle & integrations

> _The app itself: updates, deep links, webhooks, packaging._

| Step | Action             | IPC / Component                     | Observable outcome     |
| ---- | ------------------ | ----------------------------------- | ---------------------- |
| 1    | Check for updates  | `updater:check`, `updater:download` | Update flow            |
| 2    | Deep link `svn://` | `protocol-handler`                  | Repo opened            |
| 3    | Webhook delivery   | `webhook:deliver`                   | Notification sent      |
| 4    | Shell integration  | `shell/*`                           | Context-menu installed |
| 5    | Packaged smoke     | `packaged-app-smoke-workflow`       | Binary boots           |

**Covered by:** `updater.test`, `protocol-handler.test`, `webhook.test`,
`ShellIntegration.test`, `packaged-app-smoke-workflow.test`, `compiled-binary-smoke.test`.
**Relatively well covered.**

---

## Coverage philosophy

- **Structural E2E** ("button is accessible") is cheap and worth keeping as a baseline, but
  the highest-value E2E tests **chain steps** into a journey and assert the _outcome_ of an
  operation, not just that a control exists.
- **Unit/integration tests** own the logic edge cases (parsing, caching, error handling,
  auth flows, mutation queuing). E2E should not re-test these.
- **Real-IPC vs mocked-IPC:** where a journey needs deterministic, fast feedback, mock the
  IPC channel via `tests/helpers/mock-ipc.ts` and assert the renderer's behavior. Where a
  journey needs true end-to-end confidence (e.g. J6 conflict), exercise a real SVN repo.
- Every new test gets a row in `test-tracker.csv` tagged with its journey.
