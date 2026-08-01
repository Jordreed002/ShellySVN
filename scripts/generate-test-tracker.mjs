#!/usr/bin/env node
/**
 * generate-test-tracker.mjs
 *
 * Scans the ShellySVN codebase for every test (unit / integration / real / perf / e2e)
 * and emits two living documents:
 *
 *   - docs/test-strategy/test-tracker.csv   (the "spreadsheet")
 *   - docs/test-strategy/test-tracker.md    (human-readable summary + gap list)
 *
 * Re-run after adding tests to keep the tracker in sync:
 *
 *   node scripts/generate-test-tracker.mjs
 *
 * Each test row is tagged with a user journey (J1..J14) and an area, using a
 * path-based classifier below. Tag with `gap` are planned-but-not-yet-written
 * tests enumerated from docs/test-strategy/user-journeys.md.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_CSV = join(ROOT, 'docs/test-strategy/test-tracker.csv');
const OUT_MD = join(ROOT, 'docs/test-strategy/test-tracker.md');

/* ------------------------------------------------------------------ *
 * Journey + area classifier (path-keyword -> {journey, area})
 * ------------------------------------------------------------------ */
function classify(relPath) {
  const p = relPath.replaceAll('\\', '/');
  const lower = p.toLowerCase();

  // Layer detection
  let layer = 'unit';
  if (p.includes('/tests/e2e/') || p.startsWith('tests/e2e/')) layer = 'e2e';
  else if (lower.endsWith('.real.test.ts') || lower.endsWith('.real.test.tsx'))
    layer = 'integration';
  else if (p.includes('/integration/__tests__/')) layer = 'integration';
  else if (
    lower.endsWith('.perf.test.ts') ||
    lower.endsWith('.perf.test.tsx') ||
    p.includes('/performance/')
  )
    layer = 'perf';

  // Journey + area detection (first match wins)
  const rules = [
    [
      /welcome|onboarding|app-launch|tutorial|launchnavigation/i,
      { journey: 'J1', area: 'Onboarding' },
    ],
    [/checkout|sparse|chooseitems|millercolumns/i, { journey: 'J2', area: 'Checkout' }],
    [/(repo-?browser|repobrowser)/i, { journey: 'J3', area: 'Repo Browser' }],
    [
      /commit|commitmessage|commitdialog|commithistory|committemplate|commitrules|commitwarning|commitautocomplete/i,
      { journey: 'J4', area: 'Commit' },
    ],
    [
      /fileexplorer|file-?operations|workingcopy|status-?service|status-?worker|incrementalstatus|mutation/i,
      { journey: 'J4', area: 'File Explorer' },
    ],
    [
      /update|incomingrevision|remoteupdatetarget|updater|update-?service/i,
      { journey: 'J5', area: 'Update' },
    ],
    [
      /conflict|resolve|merge|three-?way|twowaymerge|external-?merge/i,
      { journey: 'J6', area: 'Conflict Resolution' },
    ],
    [
      /history|logviewer|logcache|logfilter|log-?history|blame|revisiongraph|revgraph/i,
      { journey: 'J7', area: 'History' },
    ],
    [
      /branch|tag|switch|branchswitcher|branchtagcompare|branchdetection/i,
      { journey: 'J8', area: 'Branching' },
    ],
    [/lock|unlock/i, { journey: 'J9', area: 'Locking' }],
    [
      /settings|appearance|theme|notification|integration|openwith|external-?tool|code-?editors|approvedpaths|externaltoolvalidation|externaltooloverrides|shell/i,
      { journey: 'J11', area: 'Settings' },
    ],
    [
      /propert|propset|propget|proplist|propdel|revprop|svn-?metadata|svn-?ignor/i,
      { journey: 'J12', area: 'Properties' },
    ],
    [/diagnostic|cleanup|relocate|repodiagnostics/i, { journey: 'J13', area: 'Diagnostics' }],
    [
      /protocol-?handler|webhook|packaged-?app|compiled-?binary|release-?updater|process-?tree|safe-?renderer|redaction|preload-?boundary|cli-?parser|native-?auth|auth-?cache|auth-?session|lru-?cache/i,
      { journey: 'J14', area: 'Lifecycle/Auth' },
    ],
    [/auth|credential|encryption/i, { journey: 'J11', area: 'Authentication' }],
    [
      /(parser|xml|errors|paths|formatbytes|formattime|debug|types)\.test/i,
      { journey: 'J14', area: 'Shared/Core' },
    ],
  ];

  let journey = '—';
  let area = 'Uncategorized';
  for (const [re, tag] of rules) {
    if (re.test(lower)) {
      journey = tag.journey;
      area = tag.area;
      break;
    }
  }

  return { layer, journey, area };
}

/* ------------------------------------------------------------------ *
 * Test file discovery
 * ------------------------------------------------------------------ */
const TEST_DIRS = ['src', 'packages', 'tests/e2e'];

function walk(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === 'out' || name.startsWith('.'))
      continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, acc);
    } else if (/\.(test|spec)\.(ts|tsx)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

const files = [];
for (const d of TEST_DIRS) files.push(...walk(join(ROOT, d), []));

/* ------------------------------------------------------------------ *
 * Extract describe() / it() / test() titles with a forgiving regex.
 * Captures the first string literal argument. Handles .each/.skip/.only
 * and single/double/backtick quotes.
 * ------------------------------------------------------------------ */
const TITLE_RE =
  /\b(?:describe|test|it)(?:\.(?:each|skip|only|todo| concurrent))?\s*\(\s*(['"`])(?:[^'"`\\]|\\.)*?\1/g;

function extractTitles(content) {
  const suites = [];
  const tests = [];
  let m;
  while ((m = TITLE_RE.exec(content)) !== null) {
    const call = m[0];
    const rawQuote = m[1];
    // Extract the title string between the matched quotes
    const start = call.indexOf(rawQuote);
    const end = call.lastIndexOf(rawQuote);
    const title = call
      .slice(start + 1, end)
      .replace(/\\\$/g, '$')
      .trim();
    if (/^describe\b/.test(call)) suites.push(title);
    else tests.push(title);
  }
  return { suites, tests };
}

/* ------------------------------------------------------------------ *
 * Build rows
 * ------------------------------------------------------------------ */
const rows = [];
const stats = { unit: 0, integration: 0, perf: 0, e2e: 0 };
const byJourney = {};

for (const file of files) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  const content = readFileSync(file, 'utf8');
  const { suites, tests } = extractTitles(content);
  const { layer, journey, area } = classify(rel);
  stats[layer] = (stats[layer] || 0) + tests.length;
  byJourney[journey] = (byJourney[journey] || 0) + tests.length;

  const suiteLabel = suites[0] || '';
  if (tests.length === 0) {
    // File with describe but no leaf tests, or entirely structural
    rows.push({
      journey,
      layer,
      area,
      file: rel,
      suite: suiteLabel,
      test: '(file-level / no leaf tests)',
      status: 'existing',
    });
  }
  for (const t of tests) {
    rows.push({
      journey,
      layer,
      area,
      file: rel,
      suite: suiteLabel,
      test: t,
      status: 'existing',
    });
  }
}

/* ------------------------------------------------------------------ *
 * Planned / gap rows (from user-journeys.md "Gap" notes)
 * ------------------------------------------------------------------ */
const GAPS = [
  // J1 first-run stability E2E was written in tests/e2e/user-journeys.spec.ts.
  {
    journey: 'J2',
    area: 'Checkout',
    layer: 'e2e',
    test: 'E2E: mocked svn:checkout success -> repo appears in sidebar AND file explorer loads',
  },
  {
    journey: 'J3',
    area: 'Repo Browser',
    layer: 'e2e',
    test: 'E2E: browse -> cat (view file contents) -> log chained journey',
  },
  {
    journey: 'J4',
    area: 'Commit',
    layer: 'e2e',
    test: 'E2E: status -> add -> commit -> new revision appears in history',
  },
  {
    journey: 'J4',
    area: 'File Explorer',
    layer: 'unit',
    test: 'unit: status refresh invalidates working copy tree after add/commit',
  },
  {
    journey: 'J5',
    area: 'Update',
    layer: 'e2e',
    test: 'E2E: incoming-revisions badge clears after successful update',
  },
  {
    journey: 'J7',
    area: 'History',
    layer: 'e2e',
    test: 'E2E: select revision -> changed-files list -> diff renders',
  },
  {
    journey: 'J8',
    area: 'Branching',
    layer: 'e2e',
    test: 'E2E: create branch (svn:copy) -> switch -> working copy reflects branch',
  },
  {
    journey: 'J9',
    area: 'Locking',
    layer: 'e2e',
    test: 'E2E: lock file -> indicator shown -> unlock -> indicator clears',
  },
  {
    journey: 'J11',
    area: 'Settings',
    layer: 'e2e',
    test: 'E2E: change setting -> reload -> value persists across restart',
  },
  {
    journey: 'J12',
    area: 'Properties',
    layer: 'e2e',
    test: 'E2E: set svn:ignore -> file leaves untracked list',
  },
  {
    journey: 'J13',
    area: 'Diagnostics',
    layer: 'integration',
    test: 'integration: cleanup repairs working copy after interrupted commit',
  },
  {
    journey: 'J14',
    area: 'Lifecycle/Auth',
    layer: 'unit',
    test: 'unit: network-dependent .real tests are skipped when offline (env guard)',
  },
];
for (const g of GAPS) {
  rows.push({
    journey: g.journey,
    layer: g.layer,
    area: g.area,
    file: '(planned)',
    suite: '',
    test: g.test,
    status: 'gap',
  });
  byJourney[g.journey] = byJourney[g.journey] || 0;
}

rows.sort((a, b) => {
  if (a.journey !== b.journey) return a.journey.localeCompare(b.journey);
  if (a.layer !== b.layer) return a.layer.localeCompare(b.layer);
  return a.file.localeCompare(b.file);
});

/* ------------------------------------------------------------------ *
 * Write CSV
 * ------------------------------------------------------------------ */
const csvHeader = 'Journey,Layer,Area,File,Suite,Test,Status';
const csvEscape = (s) => {
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
};
const csvLines = [
  csvHeader,
  ...rows.map((r) =>
    [r.journey, r.layer, r.area, r.file, r.suite, r.test, r.status].map(csvEscape).join(',')
  ),
];
writeFileSync(OUT_CSV, csvLines.join('\n') + '\n');

/* ------------------------------------------------------------------ *
 * Write Markdown summary
 * ------------------------------------------------------------------ */
const journeyNames = {
  J1: 'First-run onboarding',
  J2: 'Repository checkout',
  J3: 'Repository browsing',
  J4: 'Daily edit & commit loop',
  J5: 'Update & stay in sync',
  J6: 'Conflict resolution',
  J7: 'History & investigation',
  J8: 'Branching & tagging',
  J9: 'File locking',
  J10: 'Sparse-checkout management',
  J11: 'Settings & configuration',
  J12: 'Properties & metadata',
  J13: 'Diagnostics & recovery',
  J14: 'App lifecycle & integrations',
  '—': 'Uncategorized',
};

const totalTests = Object.values(stats).reduce((a, b) => a + b, 0);
const gapCount = rows.filter((r) => r.status === 'gap').length;
const fileCount = files.length;

let md = `# ShellySVN — Test Tracker\n\n`;
md += `> Auto-generated by \`scripts/generate-test-tracker.mjs\`. Re-run after adding tests.\n`;
md += `> The full row-level spreadsheet is \`test-tracker.csv\` (open in Excel / Numbers / Google Sheets).\n\n`;
md += `## Snapshot\n\n`;
md += `| Layer | Test files | Test cases |\n|---|---|---|\n`;
md += `| Unit | — | ${stats.unit} |\n`;
md += `| Integration / real | — | ${stats.integration} |\n`;
md += `| Performance | — | ${stats.perf} |\n`;
md += `| E2E | ${files.filter((f) => f.includes('/e2e/')).length} | ${stats.e2e} |\n`;
md += `| **Total** | **${fileCount}** | **${totalTests}** |\n\n`;
md += `**Baseline:** \`${stats.unit + stats.integration + stats.perf}\` non-E2E tests (1 network-dependent \`.real\` test is inherently flaky offline). ${stats.e2e} E2E tests are mostly structural today.\n\n`;
md += `**Planned gaps to write:** ${gapCount} (see list below).\n\n`;
md += `## Coverage by user journey\n\n`;
md += `| Journey | Test cases |\n|---|---|\n`;
for (const j of Object.keys(journeyNames).sort()) {
  md += `| ${j} — ${journeyNames[j]} | ${byJourney[j] || 0} |\n`;
}
md += `\n## Planned gaps (highest-value missing journeys)\n\n`;
md += `| # | Journey | Layer | Planned test |\n|---|---|---|---|\n`;
GAPS.forEach((g, i) => {
  md += `| ${i + 1} | ${g.journey} | ${g.layer} | ${g.test} |\n`;
});
md += `\n## Layer / area breakdown (existing tests only)\n\n`;
const areaCounts = {};
for (const r of rows) {
  if (r.status !== 'existing') continue;
  const key = `${r.layer} / ${r.area}`;
  areaCounts[key] = (areaCounts[key] || 0) + 1;
}
md += `| Layer / Area | Tests |\n|---|---|\n`;
for (const k of Object.keys(areaCounts).sort((a, b) => areaCounts[b] - areaCounts[a])) {
  md += `| ${k} | ${areaCounts[k]} |\n`;
}
writeFileSync(OUT_MD, md);

console.log(`✓ Wrote ${rows.length} rows`);
console.log(`  ${OUT_CSV}`);
console.log(`  ${OUT_MD}`);
console.log(`  ${totalTests} test cases across ${fileCount} files`);
