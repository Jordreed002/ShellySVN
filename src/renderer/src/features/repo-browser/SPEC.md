# Repository browser — build contract

Design source: **`prototypes/12-browser.html`** (open it; it is interactive and authoritative for
layout, spacing, wording and behaviour). This document is the contract several agents build against
in parallel. Shared types live in `./types.ts` — import from there, do not redeclare.

## The one rule that matters

`svn ls` describes the **server**. `svn status` describes **your disk**. They overlap only inside a
checkout. Therefore:

- Status codes, roll-up counts and change badges appear **only** when `scope === 'working-copy'`.
- Outside a checkout the status column stays empty. Never imply the server knows about local edits.
- Mark the **exception, not the rule**: in a 51-client repository "not checked out" is the normal
  state, so label the two that _are_ checked out, not the forty-nine that aren't.

### The two exceptions, and why they are not exceptions

Two things look local but are **repository** facts, and so are shown with or without a checkout:

- **`svn:externals`** — a property on a directory in the repository. A listing that hides it implies
  `vendor/` is ordinary content when its contents come from somewhere else, possibly at a revision
  that does not move with the tree. See `parseExternalsProperty` / `useRepoExternals`.
- **Presence** (`checked out` / `partly checked out`) — derived from _which paths you have checked
  out_, not from `svn status`. It is how the exception gets marked in a repository listing. See
  `presenceFromCheckouts`.

Containment is always compared on **segment boundaries** (`containsPath`). A prefix test says
`clients/acme` contains `clients/acme-corp`, which in a monorepo is a bug waiting to happen.

## Non-negotiables

1. **One vocabulary — Subversion's.** checkout, update, commit, switch, merge, revert, revision,
   BASE, HEAD, depth, externals, changelist, conflicted, locked. No invented synonyms
   ("get a copy", "send changes", "current work"). Where a status is shown, show the word and the
   code together: `Modified M`, `Conflicted C`. In prose sub-lines bracket the code —
   `1 conflicted (C)` — so it does not read as a truncated sentence.
2. **No modes.** There is no developer toggle. Paths, revisions, sizes and `svn` command hints are
   always visible.
3. **Say what a diff compares.** Anything showing a diff must state its `Comparand` and the
   consequence — e.g. "incoming changes only — your edits are not in this diff".
4. **Explain the ugly states.** Tree conflicts, needs-cleanup, stale locks and floating externals get
   cause, consequence and the exact command.
5. **Never print a confident zero for something you did not measure.** "0 eligible revisions" and
   "no eligible revisions could be counted, because no merge source was named" are different
   statements and Subversion can only make the second one. Render `—` and say why. The same applies
   to sizes nobody walked, counts behind a preference, and depths no IPC call reports: omit the
   segment rather than defaulting it. A number on screen is a claim.
6. **The window must not contradict itself.** If the listing footer says "working copy · status from
   disk", the status bar may not say "No working copy open" about the same directory. When a pane
   discovers something the rest of the shell needs — e.g. which checkout contains the current path —
   it lifts that into the route rather than keeping it private.

## House style

- **Tailwind only**, using the project's semantic tokens: `bg-bg`, `bg-bg-secondary`,
  `bg-bg-tertiary`, `bg-bg-elevated`, `border-border`, `border-border-muted`, `text-text`,
  `text-text-secondary`, `text-text-muted`, `text-text-faint`, `text-accent`, `bg-accent`, and the
  SVN status colours `text-svn-modified`, `text-svn-added`, `text-svn-deleted`, `text-svn-conflict`,
  `text-svn-replaced`, `text-svn-external`, `text-svn-unversioned`. No hard-coded hex.
- Icons: `lucide-react` only.
- Dialogs: reuse `@renderer/components/AccessibleDialog` (`AccessibleDialog`,
  `AccessibleDialogBody`, `AccessibleDialogFooter`). Do not hand-roll modals or focus traps.
- Mono type for paths, revisions and commands: `font-mono`.
- Components are **presentational and prop-driven**. No data fetching, no `window.api` calls, no
  router access inside them — the route wires those up. This keeps them testable and lets us build
  in parallel.
- TypeScript strict: no `any`, no non-null `!` assertions, explicit prop interfaces exported.
- Accessibility: the tree needs `role="tree"`/`treeitem` with `aria-expanded` and roving tabindex;
  the contents list needs `role="grid"` with `role="row"`/`gridcell`; every icon-only control needs
  an accessible name.
- **Copy must fit the box it is in.** A tile ~180px wide holds roughly 28 characters of 10px text;
  a detail line that truncates mid-word is a line nobody reads. Cut the sentence, or move the
  detail to the tooltip — do not let it clip. Check it rendered, not just written.
- **Dates are relative everywhere** (`formatEntryDate`: `3 d`, `4 mo`), with the exact timestamp in
  `title`. Never render a raw ISO string into the UI.

## Paths must never break the layout

Monorepo paths are long. Directories truncate from the **left** (so the filename survives):
`text-overflow: ellipsis` with `direction: rtl; text-align: left`, or the equivalent. The filename
itself never truncates before the directory does. This was a real bug in an earlier prototype.

## Scale honesty

Large directories must say so rather than silently truncating: _"Showing 200 of 4,812 — filter or
search to narrow"_, and in the tree _"… 39 more — search instead"_. Unlisted folders show a spinner
with a count, not an empty node.

## What exists to build against

The IPC surface is already rich (`window.api.svn.*`): `list`, `log`, `blame`, `diff`, `diffUrls`,
`mergeInfo`, `status`, `statusRemote`, `info`, `infoUrl`, `checkout`, `switch`, `merge`, `cleanup`,
`lock`/`unlock`, `proplist`/`propget`, `externals`, `shelve`, `resolve`, `revert`, `update`.
Typed in `packages/shared/src/types.ts` as `ElectronAPI`. Presentational components don't call these
— but design props so the route can supply real data without reshaping the component.

Known gaps in that surface, so nobody re-discovers them: `svn info` does not expose `<depth>`, so
checkout depth is honestly `'unknown'` and sparse checkouts cannot be detected; `svn.diff` builds
`-c`, not `-r`, so the `wc-head` comparand is unavailable; `svn shelf` is 1.14+ and "unsupported" is
a normal answer, not an error. Report these through `UnsupportedCapability` rather than guessing.

## Verify it rendered

This feature has been "finished" more than once while looking nothing like the prototype. A change
is not done until it has been _looked at_: build, serve the renderer with a stubbed `window.api`,
screenshot the real thing and compare it side by side with `prototypes/12-browser.html`. Gates
passing is not evidence that the pixels are right — and a component that never receives data
renders nothing while every test still passes.

Where a capability genuinely has no API, render an explicit empty state saying so. Never fake data
in a component.
