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

export const marketingLinks = [
  { href: '/', label: 'Overview' },
  { href: '/features', label: 'Features' },
  { href: '/download', label: 'Download' },
  { href: '/roadmap', label: 'Roadmap' },
  { href: '/faq', label: 'FAQ' },
  { href: '/docs', label: 'Docs' },
] as const;

export const appTagline = 'Modern Subversion workflows for teams that still need SVN to move fast.';

export const siteDescription =
  'ShellySVN is a desktop Subversion client for macOS, Windows, and Linux with sparse checkout, repository browsing, diff tooling, and release-ready packaged binaries.';
