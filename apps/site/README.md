# ShellySVN Site

This workspace contains the public marketing and documentation site for ShellySVN.

## Stack

- `Next.js` app router
- `Fumadocs` and `Fumadocs MDX`
- static export output for CDN or Vercel deployment

## Commands

From the repo root:

```bash
bun run site:dev
bun run site:build
bun run site:start
```

From this workspace directly:

```bash
bun run dev
bun run build
bun run typecheck
```

## Structure

- `app/(home)`: marketing pages
- `app/docs`: Fumadocs layout and content routes
- `content/docs`: end-user and evaluator documentation
- `lib/releases.ts`: GitHub release fetch and fallback normalization
- `data/releases.snapshot.json`: checked-in fallback release data for static export

## Deployment

The site is built as a static export. GitHub workflows include:

- `.github/workflows/site.yml` for typecheck and build verification
- `.github/workflows/site-deploy.yml` for Vercel preview and production deploys when the required secrets are configured
