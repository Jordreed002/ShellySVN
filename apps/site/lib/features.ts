import type { FeatureEntry } from './types';

export const featureEntries: FeatureEntry[] = [
  {
    slug: 'sparse-checkout',
    title: 'Sparse checkout that stays practical',
    summary:
      'Select only the paths you need, expand a working copy later, and browse remote-only items without forcing a full checkout.',
    status: 'available',
    audience: 'Large monorepos, asset repos, and enterprise codebases',
  },
  {
    slug: 'repo-browser',
    title: 'Repository browsing without ceremony',
    summary:
      'Inspect branches, paths, history context, and remote structure from the desktop app before you mutate a working copy.',
    status: 'available',
    audience: 'Evaluators replacing TortoiseSVN-style browsing workflows',
  },
  {
    slug: 'diff-history',
    title: 'Diff, history, and review surfaces',
    summary:
      'Move between commit history, unified diffs, blame views, and revision visualizations without leaving the app shell.',
    status: 'available',
    audience: 'Developers reviewing changes and release coordinators',
  },
  {
    slug: 'desktop-packaging',
    title: 'Portable packaged binaries',
    summary:
      'Release artifacts bundle the required SVN toolchain so teams do not need to hand-assemble client prerequisites.',
    status: 'available',
    audience: 'IT teams and developers who need predictable installs',
  },
  {
    slug: 'shell-integration',
    title: 'Explorer and Finder integration path',
    summary:
      'Native shell helpers are part of the direction, but they remain explicitly release-gated until the packaged flow is complete.',
    status: 'preview',
    audience: 'Teams evaluating replacement readiness against incumbent SVN tools',
  },
  {
    slug: 'release-readiness',
    title: 'Production hardening still in progress',
    summary:
      'Public messaging stays preview-oriented while signing, notarization, and final release-candidate verification continue.',
    status: 'planned',
    audience: 'Decision makers who need clear rollout expectations',
  },
];
