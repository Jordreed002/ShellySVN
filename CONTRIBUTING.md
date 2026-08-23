# Contributing to ShellySVN

ShellySVN is a cross-platform Electron SVN client (renderer / preload / main)
with a shared types package, a Bun-compiled logic engine, and a Next.js docs
site. Read [`CLAUDE.md`](./CLAUDE.md) for the condensed project map and
[`docs/architecture.md`](./docs/architecture.md) for the layered view before
diving in.

## Setup

Requirements: [Bun](https://bun.sh), and an `svn` client binary on your PATH
(the app shells out to it; the packaged builds bundle one).

```bash
bun install        # installs workspaces + electron-builder app deps
bun run dev        # electron-vite dev (renderer HMR, main/preload rebuild)
```

Useful neighbors:

```bash
bun run site:dev   # docs site (apps/site) at localhost
bun run cli:dev    # CLI entrypoint in dev mode
bun run engine:dev # logic engine directly
```

## Verification workflow

`bun run verify` is the full gate — run it before considering any change done.
It chains typecheck, lint, boundary/dead-code/CSP/remote-asset checks, skipped-
test detection, the unit suite, and a production build:

```bash
bun run verify                       # everything (see package.json "verify")
bun run typecheck                    # route tree generation + tsc -b --noEmit
bun run test:unit                    # vitest run
bunx vitest run path/to/file.test.ts # a single test file
bun run test:e2e                     # Playwright (tests/playwright.config.ts)
bun run test:e2e:ui                  # Playwright interactive UI
bun run verify:svn-workflows         # IPC contract + workflow scripts + "real" vitest config
```

### SVN test infrastructure

Tests that need a real server run against the docker lab:

```bash
bun run svn:lab:up      # docker compose lab (tests/fixtures/svn-compat-server)
bun run svn:lab:verify  # lab health check
bun run svn:lab:logs    # tail server logs
bun run svn:lab:reset   # tear down + remove volumes
```

There is also a local test server (`svn:test-server:start|stop|status|reset`)
and a probe (`svn:work-server:probe`). Background on the lab design lives in
[`docs/svn-compatibility-lab.md`](./docs/svn-compatibility-lab.md).

## Code conventions

- **Lint & format**: `oxlint` (`.oxlintrc.json`) and `oxfmt` (`.oxfmtrc.json`).
  `bun run lint` / `bun run format`; CI-grade checks are part of `verify`.
- **Styling**: Tailwind with semantic tokens only (`bg-bg`, `text-text`,
  `border-border`, `text-accent`, `bg-surface-elevated`, …) — never raw hex or
  ad-hoc grays; themes and density controls depend on the token names.
- **Dialogs**: build on `DialogBase` (`src/renderer/src/components/ui/DialogBase.tsx`)
  so focus trapping, geometry persistence, and Esc/overlay behavior stay
  consistent.
- **Server state**: TanStack Query. Register keys in the shared registry
  (`src/renderer/src/lib/queryKeys.ts`) or the feature-local registry, and
  invalidate through the registry after mutations rather than ad-hoc strings.
- **Client state**: module-level external stores consumed with
  `useSyncExternalStore`, persisted through the `store` IPC bridge with strict
  parse-on-hydrate (see `src/renderer/src/lib/tabsStore.ts` for the pattern).
  Do not add a new state-management dependency.
- **IPC surface**: renderer never touches Electron APIs directly — extend
  `window.api` via `src/preload/api/*` with types from `packages/shared`.
  Changes there are **additive-only** (see the coordination section).
- **Errors**: classify through `src/main/utils/svn-errors.ts` categories;
  renderer surfaces consume the category, they do not re-parse stderr.

## Documentation

- User-facing docs: MDX under `apps/site/content/docs/` (fumadocs; frontmatter
  carries `title`, `description`, `category`, `status`, `lastReviewed`). Keep
  new pages listed in the folder's `meta.json`.
- Contributor/engineering docs: plain markdown under `docs/`.
- `CHANGELOG.md` is append-only.

## Release flow

Releases are script-gated; see `scripts/` for the implementations
(`verify-binaries.mjs`, `validate-release-version.mjs`,
`validate-release-channel.mjs`, `validate-release-assets.mjs`,
`create-release-checksums.mjs`, `fuses.mjs`). Platform builds
(`build:mac`, `build:win`, `build:linux`, `build:all`) each verify their
binaries before packaging, and `bun run verify:release` runs the full verify
plus the bundle-budget analysis. Append an entry to `CHANGELOG.md` for
user-visible changes — never rewrite history in it.

## Two-track coordination (summary)

Work is organized in two parallel tracks (full protocol in
[`docs/beta-plan.md`](./docs/beta-plan.md)):

- **Track A — Platform & Trust**: security foundation, robustness, SVN
  backends, release engineering.
- **Track B — Product & Experience**: renderer UX, the AI vertical, product
  depth.

Key rules that affect every contribution:

- `packages/shared/src/types.ts` and `src/preload/api/*.ts` are
  **additive-only**; A owns merges, B rebases.
- `package.json`, build configs, and CI workflows are A-exclusive; B files
  script-change requests instead.
- Branches live in `a/*` and `b/*` namespaces with cross-review on every PR.
- At phase boundaries, merged main must pass `bun run verify`,
  `bun run test:e2e`, and `bun run verify:svn-workflows` together.
- Disputes: platform/architecture calls resolve to A; product/UX calls to B.
