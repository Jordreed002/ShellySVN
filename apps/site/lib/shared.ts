export const appName = 'ShellySVN';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';
export const gitConfig = {
  user: 'Jordreed002',
  repo: 'ShellySVN',
  branch: 'main',
};

export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://shellysvn.com';

export const previewLabel = 'Preview release';

export const appVersion = '1.1.0-beta.2';
export const bundledSvnVersion = '1.14.3';

/** Verifiable figures used in place of a testimonial. */
export const projectFacts = {
  unitTests: '2,170',
  e2eJourneys: '7',
  platforms: '3',
  trackers: '0',
  prerequisites: '0',
} as const;

/**
 * The repository has no LICENSE file and no `license` field in package.json.
 * Until one lands the site says the source is public rather than naming a
 * licence, and this flag keeps that wording in one place.
 */
export const licenceResolved = false;

export const marketingLinks = [
  { href: '/', label: 'Overview' },
  { href: '/features', label: 'Features' },
  { href: '/docs', label: 'Docs' },
  { href: '/download', label: 'Download' },
  { href: '/roadmap', label: 'Roadmap' },
] as const;

export const footerLinks = {
  product: [
    { href: '/', label: 'Overview' },
    { href: '/features', label: 'Features' },
    { href: '/download', label: 'Download' },
    { href: '/roadmap', label: 'Roadmap' },
    { href: '/changelog', label: 'Changelog' },
  ],
  learn: [
    { href: '/docs', label: 'Documentation' },
    { href: '/docs/getting-started/install', label: 'Install guide' },
    { href: '/docs/workflows/sparse-checkout', label: 'Sparse checkout' },
    { href: '/faq', label: 'FAQ' },
  ],
} as const;

export const appTagline =
  'A free, open-source Subversion client for teams that still need SVN to move fast. Bundles Subversion 1.14 — no external dependencies.';

export const siteDescription =
  'ShellySVN is a desktop Subversion client for macOS, Windows, and Linux with sparse checkout, repository browsing, diff tooling, and release-ready packaged binaries.';
