# ShellySVN — visual design prototypes

Six standalone HTML prototypes. No build step: open `prototypes/index.html` for the side-by-side
comparison, or open any file directly.

```
prototypes/
├── index.html          ← comparison page with live previews
├── 01-console.html     Round 1 · industrial, dense, dark
├── 02-ledger.html      Round 1 · editorial, plain-spoken, light
├── 03-carapace.html    Round 1 · organic canvas (not pursued)
├── 04-studio.html      Round 2 · the dial
├── 05-guide.html       Round 2 · plain by default, technical as a layer
├── 06-bench.html       Round 2 · no modes, teach the vocabulary
├── 07-console-v2.html  Round 3 · refined 01 — the changes workbench
├── 08-atlas.html       Round 3 · the monorepo navigator (power version)
├── 09-atlas-lite.html  Round 3 · simplified monorepo browser (superseded by 10)
├── 10-atlas.html       Round 3 · projects + developer mode (superseded by 11)
├── 11-browser.html     Round 3 · repository browser (superseded by 12)
└── 12-browser.html     Round 3 · CURRENT — refined against real SVN behaviour
```

---

## 12 · Where the design was wrong, and what changed

### 1. It merged two different truths

`svn ls` describes the server. `svn status` describes your disk. They only overlap inside a
checkout — but 11 painted status columns and roll-up counts across the whole repository tree,
implying one continuous truth. Browsing `clients/globex`, which you have never checked out, cannot
have a modified count.

Now the checked-out subtree is tinted and the footer carries a scope chip — *working copy · status
from disk* or *repository listing · nothing checked out here*. Status columns and tree roll-ups
appear only inside a checkout.

Related: **mark the exception, not the rule.** 11 labelled 46 of 51 clients "not checked out",
which is the normal state. 12 labels the 2 that *are*.

### 2. "Diff" didn't say what it was diffing

Subversion can compare working copy ↔ BASE, working copy ↔ HEAD, BASE ↔ HEAD, one branch against
another, or any two revisions. These give materially different answers. The detail pane now has a
comparand control and states the consequence — *"incoming changes only — your edits are not in this
diff"*.

### 3. Mixed revisions were invisible

A working copy is not "at r4821". It holds files anywhere between r4744 and r4838 until you update,
because `svn update` on a subtree only moves that subtree. This is the single biggest source of
confusion about `svn status`, and no client shows it. The band now draws the range.

### 4. Merge was a verb, not a question

The useful question is *which revisions from trunk have not landed here yet* — which
`svn:mergeinfo` can answer. The merge dialog lists the 4 eligible revisions, flags the one that
touches a file with local edits, distinguishes **sync / reintegrate / record-only**, and offers a
dry run first.

### 5. The ugly states weren't anywhere

A **Problems** surface covers the frequent, baffling ones, each with cause, consequence and command:

- **Tree conflict** — you deleted a file, they edited it. No merge editor helps; it needs a decision.
- **Needs cleanup** — an interrupted operation left the working copy holding its own lock. Nothing
  is broken, but every subsequent operation refuses to start.
- **Stale lock** — held 22 days. SVN locks never expire on their own.
- **Floating external** — no peg revision, so every update can silently change the build.

### 6. Modern expectations, mapped honestly

SVN has no pull request. Rather than pretend, review runs on **shelves** (`svn shelf`, 1.14) — set
aside, restore, or share as a patch. Build status per revision and issue references (via the
`bugtraq:` properties SVN already supports) ride along the log.

### Still open

Copy-from history (`A + (from ^/…:r4712)`) so a file can be followed across renames and branch
points; a revision graph; an externals audit across the whole tree; a standalone sparse-depth
editor; and proper `treeitem`/`grid` ARIA roles before any of this becomes React.

---

## 11 · Repository browser — where this landed

Two things were removed on purpose.

**Projects are gone.** Subversion has no project entity, and inventing one meant inventing detection
rules, provenance UI, override commands and an explainer modal — a lot of surface defending a
fiction. The repository is directories, so the browser is directories. What people actually needed
from "projects" is served better by **bookmarks, recent locations, working copies in the rail, and
repository-wide search**.

**The developer-details switch is gone.** There is one vocabulary — Subversion's — used precisely:
*checkout, update, commit, switch, merge, revision, BASE, HEAD, depth, externals, changelist,
conflicted, locked*. Status shows the word and the code together (`Modified M`, `Conflicted C`) so a
newcomer learns the letter they'll meet in a terminal instead of a private synonym. Paths, revisions,
sizes and `svn` command hints are always visible; nothing is gated behind a mode.

### What's in it

| | |
|---|---|
| **Rail** | Working copies (local path, URL, BASE, change count), repository roots, bookmarks, recent locations, disk meter |
| **Tree** | Lazily expanded, status roll-ups, `ext` badges, ghosting for what isn't checked out, "… 39 more — search instead" |
| **Contents** | Name · Rev · Author · Date · Size · Status. Sortable, multi-select with space, per-row Diff/Blame/Log/Checkout |
| **Detail** | Diff · Blame · Log · Properties, always available, collapsible |

### The five additions over 10

1. **Repository-wide path search.** Flip the scope chip and the contents pane becomes a search result
   list across all 512k paths, each with its location. This is what replaced the project finder.
2. **Working-copy banner.** Browsing a path you have checked out shows the local path, BASE vs HEAD,
   modified and conflicted counts, and Update / Commit / Reveal. It's the bridge between the
   repository and your disk that TortoiseSVN keeps in two separate tools.
3. **`@revision` peg.** Browse the entire tree as it was at any revision or date. The address bar
   tints amber so you can't forget you're looking at the past.
4. **Breadcrumb middle-collapse.** Deep monorepo paths keep the root and the last three segments,
   with the middle behind a `…` that has the full path as its tooltip.
5. **Multi-select action bar** — Checkout / Export / Copy URLs over a selection.

Plus keyboard parity throughout: `⌘K` go to, `⌘L` edit path, `⌘[` `⌘]` back/forward, `⌘↑` parent,
`/` filter, `⌥D` diff, `⌥B` blame, arrows, space to select, and type-ahead.

---

## 10 · Atlas — where this landed

### Subversion has no concept of a project

It stores directories. Nothing else. So "project" is something Shelly **infers or is told**, from
four sources in priority order:

1. **A versioned property on the folder** — `svn propset shelly:project "Acme Website" clients/acme-corp/website`.
   Versioned, visible to the whole team, survives renames and moves. The strongest signal.
2. **A list in the repository** — `/.shelly/projects.yml` at the root naming project roots, display
   names and grouping. One commit, reviewable, the practical way to label hundreds at once.
3. **Convention** — a folder that directly contains `trunk` (usually with `branches` and `tags`) is a
   project. Covers the standard layout with nobody doing anything.
4. **Your working copies** — anything checked out on your disk is a project to you regardless.

**If none apply there are no projects** — plain folders, and the explorer is unchanged. Projects are
a lens over directories, never a requirement. The header carries a chip saying *which* rule applied
("found because it contains trunk, branches and tags"), and every folder has an override both ways:
*Treat this folder as a project* / *This isn't a project*. Detection is per folder, so projects nest.

The same inference drives the version menu: `trunk` → "Current work", `branches/*` → "Work in
progress", `tags/*` → "Released". A project not using that layout simply gets no version menu.

### Wording: no longer a mode

Plain phrasing and technical fact are **both always shown**. Status reads `Edited M`, `Needs you C`,
`Replaced R`; the version button reads *Current work* with `trunk` beside it; paths, revisions and
sizes are always visible. Nothing is withheld from a non-technical user, and nothing is dumbed down
for a developer.

### Developer mode: code tools, not vocabulary

The switch now earns its name — it **promotes diff and blame** instead of changing words:

- A third pane appears alongside tree and contents, with **Diff / Blame / History** tabs.
- Selecting a changed file **opens its diff immediately** — no click, no dialog.
- Every file row grows **Diff** and **Blame** buttons on hover.
- `⌥D` and `⌥B` jump straight to either for the selected file; turning the switch on picks the first
  changed file so the pane is never empty.
- Blame marks your own uncommitted lines distinctly from committed ones.
- The contents list sheds its author and date columns when the diff pane takes the width.
- `svn` command hints appear under menu items and in the checkout dialog's per-subtree depth editor.

---

## Round 3 — the current pair

07 and 08 are **two tabs of one app**, not two products: `Changes` and `Browse`. They share a
token set, a rail, a status bar and a context-menu grammar.

### 08 · Atlas — navigating a company-wide monorepo

The scenario this one is built for: a single repository with `clients/` holding 51 clients, each
with nested projects, and `internal/` holding another tree of them. 2.1 TB, 512k paths, and almost
none of it on your disk. TortoiseSVN's repo browser is the starting point; four things change:

1. **Miller columns instead of one tree.** Depth runs horizontally, so
   `clients / acme-corp / website / trunk` is four glances rather than four expand-clicks. Each
   column has its own filter box and its own count ("3 of 51 shown"). Arrow keys walk it: `←` `→`
   between columns, `↑` `↓` within one. The view opens scrolled to the deepest column, like Finder.

2. **Your local slice is always visible.** Every node carries a dot: ● full checkout, ◐ sparse,
   ○ not fetched, amber = local modifications inside. The rail shows a disk meter — *18.4 GB of a
   2.1 TB repo* — split into full / sparse / not fetched. In a monorepo this is the fact you need
   most often and the one TortoiseSVN never shows you.

3. **Projects are a type, not a folder.** Any folder holding `trunk/branches/tags` is detected and
   rendered as a project: cube icon, bold, and an inspector with a branch switcher (14 branches,
   62 tags), recent commits, disk footprint and a checkout button. Your `clients/acme-corp/website`
   and `internal/tooling/shelly-svn` both read as projects, not as two more folders.

4. **You never type a path.** `⌘P` fuzzy-jumps the whole repo — "acm web" finds
   `clients/acme-corp/website` and its branches and tags, with match highlighting and the local-slice
   dot on each result. Bookmarks, recents and saved searches ("stale branches > 6mo", "my open
   locks") live in the rail. Breadcrumbs are dropdowns to siblings.

Two more monorepo-specific pieces:

- **Status roll-ups on folders.** `clients/` shows `12M 1C` at the repository root, so you can see
  where your uncommitted work is without expanding anything.
- **The checkout dialog is a working-set editor.** Per-subtree depth (`infinity` / `immediates` /
  `files` / `exclude`), size per subtree, and a plain consequence line: *"excluding vendor and
  media-raw saves 5.5 GB"*. This is the honest answer to "how do I work in a repo bigger than my
  laptop".

Context menu is repo-browser flavoured, grouped as **Get it locally** (check out, add sparsely,
export) / **Inspect** (log, compare with working copy, revision graph, search inside) /
**Repository actions** (branch or tag from here, new folder, copy/move, delete).

### 09 · Atlas Lite — a real file explorer, for both audiences

Three surfaces, one component doing the work:

1. **Find** — a searchable directory of every project, grouped by client.
2. **Explore** — a genuine file explorer.
3. **Project** — the same explorer with a project header bolted on (version menu, change counts,
   get/send buttons).

**The explorer is data-driven, so the navigation in the prototype actually works.** There's a small
repository model in the file (51 clients, nested projects, trunk/branches/tags, externals,
excluded subtrees) and everything renders from it:

- **Expandable tree** with twist chevrons, indentation, project/branch/tag icons, and a
  *"… 39 more — search instead"* affordance on folders too big to list. Unlisted folders show a
  spinner and *"listing 380 items…"* so the scale problem is visible rather than pretended away.
- **Contents pane** with sortable columns (click a header, click again to reverse), folders always
  first, multi-select checkboxes, and a footer that says *"Showing 14 of 1,240 — use search to
  narrow it down"*.
- **Navigation chrome**: back / forward / up / refresh, all wired to a real history stack.
- **Breadcrumb that's also an address bar** — click any segment to jump, or click the empty space
  (or `⌘L`) to type a path. In developer mode the field holds the full `svn://` URL; otherwise a
  friendly `/clients/acme-corp/website`.
- **Search this folder** filters the current listing live.
- **Keyboard**: `↑` `↓` move, `→` / `Enter` enter a folder, `←` / `Backspace` go up, and
  **type-ahead** — start typing and it jumps to the match, with the buffer shown on screen.
- **Status roll-ups everywhere** — `clients/` carries *11 changed · 1 needs a decision* at the
  repository root, so local work is findable from the top without expanding anything. Changes and
  conflicts are separate badges; neither masks the other.
- **Download state on every node** — ghosted rows and *"not downloaded"*, so you always know which
  slice you have.

### 09 · Atlas Lite — the simplification, in detail

08 is a specialist's tool. 09 keeps every capability but changes what you meet first, on the
observation that **nobody thinks in paths** — they think "the Acme website".

| | 08 Atlas | 09 Atlas Lite |
|---|---|---|
| Opens on | Miller columns at a path | A searchable **directory of projects**, grouped by client |
| Regions on screen | 4 (rail, columns, inspector, status) | 2 (rail, content) |
| Inside a project | more columns | folders-left / contents-right — the familiar model |
| trunk / branches / tags | shown as folders | one **“Version” menu**: Current work · Work in progress · Released |
| Download state | ● ◐ ○ dots | dots **plus plain words**: “On your computer”, “Not downloaded” |
| Depth / sparse | always visible | behind **Developer details** |
| Check out | depth radio group + subtree table | **“Get a copy”** with size and “about 3 minutes”; the subtree table appears only in developer mode |

The switch matters more here than anywhere else in the set: **Developer details** restores paths,
`svn://` URLs, revision numbers, depth, the per-subtree sparse editor, and the real command under
every context-menu item. A developer turns it on once and never sees the friendly version again;
a project manager never turns it on and never sees a revision number.

Some wording it settles on, all reversible:

- *Get a copy* rather than Check out · *Send changes* rather than Commit · *Get latest* rather than Update
- *Work in progress* for a branch · *Released* for a tag · *Current work* for trunk
- *Reserved by you* for a lock · *Needs a decision* for a conflict · *Not downloaded* for an excluded subtree
- *“You keep only the projects you work on. The rest stays on the server.”* for sparse checkout

### 07 · Console v2 — the refined changes workbench

01 with its real defects fixed and one new idea:

- **Paths truncate from the left** (`…/renderer/components/` **FileExplorer.tsx**) so the filename
  is never the part that disappears. Every column has a fixed budget — 01 let mono paths overflow
  into the rev and author columns at common window widths.
- **"Explain" checkbox** in the filter bar (or `E`): adds a plain-English line under every row, a
  summary above the diff, a plain label on each hunk, and the real `svn` command in the context
  menu. One control, no modes — the audience bridge without splitting the product in two.
- **Draggable list ↔ diff split**, sticky group headers with a *why* chip ("Blocks commit",
  "Excluded", "Read-only"), a **narrated activity log** with raw output per line, and **hold ⌘** to
  reveal every shortcut in the interface.

---

## The shared scenario

Every prototype renders the same moment, so they can be compared on structure rather than content:

| | |
|---|---|
| Working copy | `~/dev/atlas-core` at **r4821** |
| URL | `svn://svn.lineindustries.com/atlas/branches/feature/payments-v2` |
| Head | **r4838** — 17 incoming revisions |
| Local changes | 12 files, 9 staged |
| Statuses present | `M` modified · `A` added · `D` deleted · `C` conflicted · `R` replaced · `?` unversioned · `X` external |
| Changelists | `payments-ui` (3) · default (5) · `ignore-on-commit` (2) |
| Locks | 2 held by you, 1 held by devon |
| Policy | pre-commit hook requiring a `bugtraq` issue reference |

Interactions that work in all six: **right-click** a file row, **⌘K** command surface, commit dialog,
destructive-action confirm, row selection driving the detail pane.

---

## Round 2 — developer *and* non-technical

The brief: excellent for a developer, still usable by someone who has never heard the word
"revision". Each prototype takes a **different strategy**, built from 01's density and 02's voice.

### 04 · Studio — one dial, three audiences
**Simple / Standard / Expert** in the title bar (or press `1` `2` `3`). The dial is not a
show/hide toggle — it drives CSS custom properties and content visibility together:

| | Simple | Standard | Expert |
|---|---|---|---|
| Row height | 58px | 42px | 29px |
| Status shown as | `Edited` pill | `Edited` pill | `M` badge |
| Path shown as | `svn.ts` + "in src/main/ipc" | same | mono `src/main/ipc/svn.ts` |
| Columns | file, changed | + rev, author, Δ | + all, tighter |
| Inspector | plain "what changed" summary | summary, diff on request | unified diff |
| Operation log | hidden | hidden | docked |
| Sidebar | 6 items | 8 items | 10 items |
| Commit dialog | message + counted summary | + manifest | + options, hooks, bugtraq |

Also carries a light/dark switch. **Take from this:** the density variables, the plain-summary
inspector ("Added a check so linked folders are looked at separately"), and the idea that a mode
should change *vocabulary*, not just visibility.

**Risk:** it is two products to design, test and support. Screenshots in docs stop matching.

### 05 · Guide — plain by default, technical as a layer
The layout **never changes**. Everything is written plainly for everyone; a single
**"Developer details"** switch in the nav (or press `D`) layers technical truth on top —
revision numbers, file paths, the literal `svn` command beneath every action, and a command-log dock.

Task-first structure: the page answers *what should I do next?* before it shows a file list.
A status hero states the situation in a sentence, then cards for **needs you → your changes →
coming from the team → reserved files**. Detail always opens in a right-hand sheet, never a new screen.

The conflict is presented as two named people's edits side by side, with a recommendation
("they don't overlap — both changes can live together"), not as marker blocks.

**Take from this:** the dual-label button (plain verb + real command underneath — it teaches
without patronising), the "what should I do next" hero, and the undo dialog offering
*save to a file first* as a safer third option.

**Risk:** card density is generous; a power user scanning 200 changed files will want a table.

### 06 · Bench — no modes, teach the vocabulary
No dial, no switch, no second-class mode. Console's three-column density, made teachable:

- **Joined badges** — `Edited · M` in one pill. The plain word and the svn letter, always together,
  so the vocabulary is learned rather than hidden.
- **Dotted terms** — hover "conflict", "reserved", "borrowed folder", "replaced" for a plain
  explanation plus the underlying command.
- **Narrated activity** — "14 files updated cleanly", "client.ts needs your decision" — with
  raw `svn` output one click away per line.
- **Hold ⌘** — every shortcut in the UI fades in. Invisible until wanted.
- **Docked composer** — commit is a panel in the right column, not a modal. No context switch.

**Take from this:** the joined badge, the term tooltips, and the narrated log — all three are
additive and could be retrofitted onto any of the other directions.

**Risk:** still a dense three-column app on first contact. The teaching helps the second hour,
not the first minute.

---

## Terminology mapping used in round 2

Where a prototype speaks plainly, this is the mapping. It is deliberately consistent across 04–06
so the wording can be lifted straight into the product.

| Subversion | Plain language |
|---|---|
| working copy | your copy / your changes |
| repository | the team's copy / the project |
| commit | share changes / send to the team |
| update | get latest |
| revision (r4821) | version |
| HEAD | the team's latest |
| BASE | when you last synced |
| conflict | needs your decision |
| resolve | sort out |
| revert | undo my edits |
| changelist | group |
| lock | reserve |
| external | borrowed / linked folder |
| unversioned | not tracked |
| replaced | deleted then re-created |
| branch / tag | version of the project / release |
| patch | save my edits to a file |

Two rules the prototypes follow:

1. **Never invent a word for something the user will meet elsewhere.** The svn term is always
   reachable — in a badge, a tooltip, a command hint or the log — because they will see `M` in a
   terminal or `conflict` in a colleague's message eventually.
2. **Explain consequences, not mechanics.** "Will be removed for everyone when you share" beats
   "scheduled for deletion".

---

## Round 1 — the original spread

**01 · Console** — industrial flight deck. Rail → context panel → change list → diff, plus a
streaming operation log. Hairlines, tabular numerals, 26px rows, nested context menus.
*Round 2 inherits:* the four-zone workbench, the operation log, keyboard-first flow, the nested menu.

**02 · Ledger** — editorial. Paper stock, Fraunces display serif, wide measure, revision history as
the spine of the page, tools as drawers and sheets.
*Round 2 inherits:* the plain-spoken voice, the narrative conflict notice, generous rows, the
commit drawer, prose over jargon.

**03 · Carapace** — organic floating canvas, dock, radial context menu, revision graph as hero.
**Not pursued.** Kept in the folder for the record.

---

## Notes for implementation

- The prototypes are hand-written HTML/CSS/JS with inline styles per file — they are **not** meant to
  be ported directly. They are for deciding structure, hierarchy and language.
- Colours in 04 and 06 are expressed as CSS custom properties in the same shape as
  `src/renderer/src/styles/global.css`, so mapping to the real token set is mechanical.
- Status colours across all six keep the existing semantic assignments (modified amber, added green,
  deleted/conflict red, replaced violet, external cyan, unversioned grey).
- 04's dial and 05's switch would both persist per-user via the existing `store` IPC; 06 needs no
  persisted state.
