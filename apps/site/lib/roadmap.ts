/**
 * The release arc, mirroring docs/roadmap.html.
 *
 * Each minor carries one theme and one exit gate — the single thing that has
 * to be true before it ships. Dates after the in-flight release are intentions;
 * the gates are the part that does not move.
 */
export type RoadmapStatus = 'shipped' | 'beta' | 'planned' | 'exploratory';

export interface RoadmapEntry {
  version: string;
  theme: string;
  target: string;
  status: RoadmapStatus;
  gate: string;
  body: string;
}

export const roadmap: RoadmapEntry[] = [
  {
    version: '0.2.0',
    theme: 'Sparse checkout',
    target: '2026-02',
    status: 'shipped',
    gate: 'Sparse checkout + remote-item workflows',
    body: 'The release that made large repositories tractable: pick a depth at checkout, expand path by path afterwards, and browse remote-only items without forcing a full checkout.',
  },
  {
    version: '1.0.0',
    theme: 'First stable',
    target: '2026-05',
    status: 'shipped',
    gate: 'Cross-platform packaged binaries',
    body: 'One codebase producing packaged builds for macOS, Windows and Linux, each with Subversion bundled so no machine needs a separate toolchain install.',
  },
  {
    version: '1.1.0',
    theme: 'Update infrastructure',
    target: '2026 Q3',
    status: 'beta',
    gate: 'Auto-update GA; signed artifacts enforced',
    body: 'The current line. Auto-update reaching general availability, and signed, notarised artifacts becoming a hard requirement rather than a to-do — which is why the preview you can download today still asks macOS for permission on first launch.',
  },
  {
    version: '1.2.0',
    theme: 'Security & hardening',
    target: 'Q4 2026',
    status: 'planned',
    gate: 'Security re-review clean; zero P0; current Electron',
    body: 'A full security re-review with no outstanding P0 findings, and the Electron base kept current rather than pinned. Nothing user-facing, and the most important release on this list for anyone whose IT department has to sign it off.',
  },
  {
    version: '1.3.0',
    theme: 'Accessibility & polish',
    target: 'Q1 2027',
    status: 'planned',
    gate: 'WCAG 2.1 AA on core flows; one modal mechanism',
    body: 'WCAG 2.1 AA across the core flows — checkout, update, commit, resolve — plus consolidating on a single modal mechanism instead of the several the app has accumulated.',
  },
  {
    version: '1.4.0',
    theme: 'Performance & scale',
    target: 'Q2 2027',
    status: 'planned',
    gate: 'Smooth on 100k-file working copies',
    body: 'The honest ceiling today is untested. This is the release that sets and holds a number: a 100,000-file working copy that stays responsive during status, update and diff.',
  },
  {
    version: '1.5.0',
    theme: 'Subversion completeness',
    target: 'H2 2027',
    status: 'planned',
    gate: 'TortoiseSVN parity checklist green',
    body: 'Closing the remaining gaps against TortoiseSVN feature by feature, against a published checklist rather than a vague claim of parity.',
  },
  {
    version: '2.0.0',
    theme: 'Growth & vision',
    target: '2028+',
    status: 'exploratory',
    gate: 'Validated 1.x prototypes only',
    body: 'Deliberately vague, and it stays that way. Nothing enters 2.0 that has not first been prototyped and validated inside the 1.x line.',
  },
];

export const roadmapRisks = [
  {
    title: 'Signing is the current risk',
    body: '1.1 cannot close until artifacts are signed and notarised on all three platforms. Certificate and notarisation logistics are the most likely cause of slip on this page.',
    kind: 'live risk',
  },
  {
    title: 'Scale is unproven',
    body: 'The 100,000-file target in 1.4 is a goal, not a measurement. If the current architecture cannot reach it, that is a larger change than one release usually contains.',
    kind: 'live risk',
  },
  {
    title: 'The licence has to land first',
    body: 'No LICENSE file exists in the repository. Until one does, external contribution and redistribution are legally unclear, which constrains everything after 1.1.',
    kind: 'blocker',
  },
] as const;
