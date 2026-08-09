# Renderer preview — seeing the UI without Electron

`src/renderer/src/features/repo-browser/SPEC.md` says a UI change is not done until it has been
_looked at_. This is the tool for that.

```bash
bun run preview                     # build, stage, serve on http://127.0.0.1:8940
bun run preview -- --no-build       # reuse the existing out/renderer
bun run preview:shot -- --out /tmp/a.png --path '/repo-browser?url=svn://demo/atlas'
```

Compare what you get against **`prototypes/12-browser.html`** — open it directly in a browser; it is
interactive and authoritative for layout, spacing and wording.

## Why it exists

Two things stop you simply opening the built renderer:

- `window.api` is Electron's contextBridge surface. Without it every route throws on its first IPC
  call. `stub-api.js` supplies a small, self-consistent demo repository instead.
- TanStack Router uses history routing, so `/repo-browser` has to serve `index.html`. A plain static
  server 404s.

The stub deliberately models the _interesting_ states, because those are what the design is about:
a monorepo with 51 clients, one checkout with 10 local changes, a conflict that blocks commit, a
locked file, mixed revisions r4744–r4838, and a floating external.

## Gotchas that have cost time before

- `store.get('onboarding')` must report the tutorial as seen, or the overlay covers everything.
- `store.get('settings')` supplies `recentRepositories`; without it the sidebar is empty **and** the
  repository browser cannot bind a checkout, so it reports "nothing checked out here".
- `fs.getDirectoryMetadata` drives `isVersioned`, which gates the whole version-control toolbar
  group. Omit it and Update/Commit vanish — which looks exactly like a regression.
- `svn.diff` resolves to `{ files: [{ hunks }] }`, **not** `{ hunks }`.
- Playwright defaults to the light colour scheme. Pass `--dark` to check the other theme.
- A component that never receives data renders nothing while every test still passes. That is the
  failure mode this tool exists to catch.

## Not a test

Nothing here runs in CI and nothing asserts. It is a way to look at the real pixels; the stub is a
convenience for humans, so if a route needs data it does not model, add it to `stub-api.js`.
