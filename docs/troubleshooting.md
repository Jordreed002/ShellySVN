# Troubleshooting map: SVN error → app guidance

This map pairs the Subversion error codes users actually hit with the
ShellySVN surface that handles each one. Every "what the app does" claim below
was verified against the current source; the relevant module is named so
contributors can trace the behavior.

Error classification itself lives in `src/main/utils/svn-errors.ts`
(`classifySvnCommandError`): every failing `svn` invocation is reduced to a
category (`authentication`, `certificate`, `network`, `working-copy`,
`locked`, `out-of-date`, `not-found`, `conflict`, …) plus a `retryable` flag,
so renderer surfaces never string-match raw stderr themselves unless noted.

## Quick map

| SVN error / message | What it means | Where the app handles it | What to do |
| --- | --- | --- | --- |
| `E155007` / `E155010` / `W155010` "is not a working copy" | The path is not inside a checkout. | Treated as a normal answer, not a failure: the file explorer probes every opened folder and expects this code (`src/main/utils/svn-errors.ts` → `isNotAWorkingCopyError`; `src/renderer/src/features/repo-browser/hooks/queryKeys.ts`). The repo browser drops sidebar entries that no longer resolve to checkouts (`useRepositoryCheckouts.ts`). | Open the working-copy root, or re-add the repository. If the folder merely moved on disk, accept the offered relink (`RelinkDialog.tsx`, backed by `src/main/services/wc-relink-detector.ts`). |
| `E155004` "working copy locked" / "previous operation has not finished" / "run 'svn cleanup'" | An earlier operation was interrupted and the WC's internal lock is stuck. | The Problems dialog derives a blocking `needs-cleanup` entry with the exact fix (`problemDerivation.ts`); the working-copy command center marks the WC `cleanupRequired` (`working-copy-command-center/model.ts`); health scan recognizes the pattern (`svn-working-copy-health.ts`). | Run cleanup from the surfaced problem entry or the working-copy context menu, then retry the operation. |
| `E155015` / "is incomplete" | The working copy's metadata records an incomplete subtree (interrupted checkout/update). | `svn-working-copy-health.ts` flags incomplete working copies in the health report. | Run an update (update completes sparse/incomplete subtrees); re-run the health scan to confirm. |
| `E160028` / "out of date" (the app's classifier; other SVN builds commonly phrase this `E155011`) | The repository has newer revisions of paths you are committing. | The commit dialog's out-of-date gate checks incoming revisions *before* committing and offers **Update and retry**, **Commit anyway**, and **Cancel** (`OodCheckPanel.tsx`, state machine in `useWorkingCopyFreshness.ts`). The Problems dialog separately shows "N revisions behind" advisories. | Choose **Update and retry** in the commit dialog. If SVN still rejected the commit, reopen the commit dialog — the gate re-checks and re-offers the same path. |
| Mixed-revision working copy (not an error code; a state) | A partial update left subtrees at newer revisions than the root; commits/branch operations can trip over it. | The Files surface shows the mixed-revision banner with a one-click **Update to HEAD** for the folder (`MixedRevisionBanner.tsx`); the status bar shows a mixed-revision chip with the affected items (`StatusBar.tsx`); the repo browser draws a revision-range strip (`WorkingCopyBand.tsx`). The merge wizard exposes an explicit **Allow mixed revisions** option (`MergeWizard.tsx`, wired to `--allow-mixed-revisions` in `svn-repository-ops.ts`). | Click **Update to HEAD** on the banner before committing or branching. |
| `E170001` / `E215004` / "no more credentials" | Authentication failed or stored credentials were rejected. | Category `authentication` (retryable). The Files surface shows the auth prompt (`FileExplorerAuthPrompt.tsx`), the repo browser has its own prompt flow (`routes/repo-browser/-repoBrowserAuth.ts`), and Batch Update marks the WC as needing credentials instead of failing silently (`BatchUpdateProvider.tsx`). Accepted credentials go through the main-process auth cache; persistent credentials are encrypted via the OS secure storage when available (`auth-cache.ts`, `utils/secure-storage.ts`; status surfaced in Settings → Credentials). | Re-enter credentials when prompted. If prompts repeat, review saved credentials in Settings and confirm the username/realm is right for that repository path. |
| `E175002` / `E175001` "Unable to connect", often chained with `E720xxx` (DNS/URL, e.g. "could not resolve hostname") or `E730xxx` (TLS layer) | The client could not reach the repository URL, or the TLS handshake failed. | Classified as `network` (retryable) or `certificate` depending on the chained cause (`svn-errors.ts`). Repo Diagnostics runs targeted connectivity checks (`RepoDiagnostics.tsx` / `svn-diagnostics.ts`). | Fix the URL first (a wrong host is the usual `E720xxx` cause; correct it via checkout/switch to the right URL, and check VPN/proxy). `E730xxx` points at the TLS layer — see the certificate row below. |
| Certificate failure (`E230001`, "unknown CA", hostname mismatch; commonly surfaced inside `E175001/E175002`) | The server certificate did not verify. | The trust prompt shows subject/issuer/validity/fingerprint, lists the concrete failures (untrusted issuer, hostname mismatch, expired, not-yet-valid), and offers trust once or **Trust this certificate permanently** (`CheckoutPrompts.tsx` → `CheckoutSslPrompt`); permanent trust is cached main-side (`ssl-trust-cache.ts`). | Verify the fingerprint out-of-band, then trust — permanently only for long-lived internal CAs. For hostname mismatch, fix the URL instead of trusting. |
| `E200009` / `E160013` / `W160013` "not found" / "does not exist" | The URL/path does not exist in the repository (moved, renamed, deleted, typo, or case mismatch). | Category `not-found`; the failing operation reports the target path, and browsing the parent in the repo browser shows what is actually there. | Re-browse the parent in the repo browser and use the current path; watch casing on case-sensitive servers. |
| Conflict (`C` status; tree conflicts shown as `!`/missing) | Local and incoming changes collided. | The Conflict Resolution Wizard covers text (three-way merge editor), property, binary, and tree conflicts (`ConflictResolutionWizard.tsx` + panels); the Problems dialog explains each conflicted path and why commit is blocked (`problemDerivation.ts`); an optional AI explainer proposes a resolution and flags unresolved questions (`ConflictAiExplainer.tsx`, advisory only, gated on per-working-copy consent). | Resolve through the wizard (right-click a conflicted file → resolve). Use the AI proposal as a hint, not an answer. |
| Repository lock issues (not `E155004`): stale `svn lock` on files | Someone (maybe you) holds a repo lock that is no longer wanted. | Locks are managed in the lock management dialog (`LockManagementDialog.tsx`); the Problems dialog warns about locks older than 14 days and explains that SVN locks never expire on their own (`problemDerivation.ts` → `stale-lock`). | Review locks in the lock manager; break/steal stale ones deliberately, since other owners are notified by convention, not by the server. |
| Disk full (`E700028` POSIX / `E700112` Windows, "No space left on device", `ENOSPC`) | The disk filled mid-operation. | Detected as a typed `SVN_DISK_FULL` error (`svn-executor.ts`), distinct from generic failures; working-copy mutations are serialized (`svn-mutation-queue.ts`) and interrupted mutations are recorded for recovery on next launch (`app-lifecycle.ts`). | Free space, then re-run the operation; if the app was closed mid-write, let it report the interrupted mutation on next launch before doing anything else. |
| IO / watcher oddities (changes not reflected, missed events) | Filesystem events were coalesced or missed (bursty builds, network drives). | Watching is chokidar-based with per-watcher debounce and max-wait caps (`src/main/ipc/fs.ts`); watchers are closed when their working copy is removed or relocated. | Refresh explicitly (F5 / the refresh action). Avoid placing working copies on unreliable network mounts. |

## Reading an error in the app

1. **Notifications & Problems first.** The notification center and the
   repo-browser Problems dialog are the intended first stop — problem entries
   carry a plain-language explanation and the recovery command.
2. **Check the category, not the code.** The classifier maps the dozens of
   upstream spellings onto the categories above; two different E-codes can be
   the same underlying problem (e.g. hostname mismatch arrives inside several
   connection E-codes).
3. **Retryable ≠ retriable as-is.** `authentication`, `certificate`,
   `network`, `locked`, `out-of-date`, and `timeout` errors are marked
   retryable — but each needs its fix from the table above first.

## User-facing version

The user-facing copy of this map lives on the documentation site at
`apps/site/content/docs/troubleshooting/error-map.mdx` (rendered at
`/docs/troubleshooting/error-map`). Keep the two in sync when adding a new
error surface.
