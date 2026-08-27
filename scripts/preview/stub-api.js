/**
 * A fake `window.api` so the renderer can be opened in a plain browser.
 *
 * The renderer is an Electron app: `window.api` is the contextBridge surface and
 * without it every route dies on its first IPC call. This stub answers with a
 * small, self-consistent demo repository — a monorepo with clients and internal
 * folders, one checkout with local changes, a conflict, a lock and a floating
 * external — so the states the design is *about* are all on screen at once.
 *
 * It is injected as an inline `<script>` in `<head>`, before the bundle runs.
 * Unknown calls resolve to `undefined` rather than throwing, so a route that
 * reaches for something not modelled here degrades instead of white-screening.
 *
 * See `scripts/preview/README.md`.
 */
(function () {
  const ROOT = 'svn://demo/atlas';
  const WC_REPO = 'clients/acme-corp/website/trunk';
  const WC_LOCAL = '/Users/demo/wc/acme-website';
  const WC_LOCAL_2 = '/Users/demo/wc/globex-portal';

  const dir = (name, path, rev, who, date) => ({
    name,
    path,
    url: `${ROOT}/${path}`,
    kind: 'dir',
    revision: rev,
    author: who,
    date,
  });
  const file = (name, path, rev, who, date, size) => ({
    name,
    path,
    url: `${ROOT}/${path}`,
    kind: 'file',
    revision: rev,
    author: who,
    date,
    size,
  });

  const LISTINGS = {
    '': [
      dir('clients', 'clients', 4838, 'mira.k', '2026-07-26T14:00:00Z'),
      dir('internal', 'internal', 4831, 'tao.n', '2026-07-24T09:00:00Z'),
      dir('shared', 'shared', 4790, 'devon', '2026-07-20T09:00:00Z'),
      dir('archive', 'archive', 4102, 'jordan', '2026-04-02T09:00:00Z'),
    ],
    clients: [
      dir('acme-corp', 'clients/acme-corp', 4838, 'mira.k', '2026-07-26T14:00:00Z'),
      dir('globex', 'clients/globex', 4700, 'devon', '2026-07-10T09:00:00Z'),
      dir('initech', 'clients/initech', 4620, 'tao.n', '2026-06-28T09:00:00Z'),
      dir('umbrella-health', 'clients/umbrella-health', 4590, 'mira.k', '2026-06-20T09:00:00Z'),
    ],
    'clients/acme-corp': [
      dir('website', 'clients/acme-corp/website', 4838, 'mira.k', '2026-07-26T14:00:00Z'),
      dir('mobile-app', 'clients/acme-corp/mobile-app', 4712, 'devon', '2026-07-05T09:00:00Z'),
      dir('brand-assets', 'clients/acme-corp/brand-assets', 4400, 'tao.n', '2026-05-11T09:00:00Z'),
    ],
    'clients/acme-corp/website': [
      dir('trunk', WC_REPO, 4838, 'mira.k', '2026-07-26T14:00:00Z'),
      dir('branches', 'clients/acme-corp/website/branches', 4838, 'mira.k', '2026-07-26T14:00:00Z'),
      dir('tags', 'clients/acme-corp/website/tags', 4826, 'jordan', '2026-07-23T09:00:00Z'),
    ],
    [WC_REPO]: [
      /* In the repository, never fetched into the checkout below — the entry the
         Files view marks as "not checked out" and offers to add. */
      dir('reports', `${WC_REPO}/reports`, 4780, 'devon', '2026-07-18T09:00:00Z'),
      dir('src', `${WC_REPO}/src`, 4802, 'jordan', '2026-07-26T18:38:00Z'),
      dir('packages', `${WC_REPO}/packages`, 4838, 'mira.k', '2026-07-26T14:00:00Z'),
      dir('docs', `${WC_REPO}/docs`, 4835, 'jordan', '2026-07-25T16:04:00Z'),
      dir('tests', `${WC_REPO}/tests`, 4744, 'tao.n', '2026-07-19T09:00:00Z'),
      dir('vendor', `${WC_REPO}/vendor`, 4831, 'tao.n', '2026-07-24T09:00:00Z'),
      file('package.json', `${WC_REPO}/package.json`, 4838, 'mira.k', '2026-07-26T09:12:00Z', 4100),
      file(
        'tailwind.config.js',
        `${WC_REPO}/tailwind.config.js`,
        4811,
        'jordan',
        '2026-07-25T09:00:00Z',
        3200
      ),
      file('README.md', `${WC_REPO}/README.md`, 4790, 'jordan', '2026-07-20T09:00:00Z', 8800),
    ],
  };

  function listFor(url) {
    const rel = String(url)
      .replace(ROOT, '')
      .replace(/^\/+|\/+$/g, '');
    return LISTINGS[rel] || [];
  }

  /** One conflict, one replace, one add, one lock — the interesting states. */
  const STATUS_ENTRIES = [
    {
      path: `${WC_LOCAL}/src`,
      status: 'normal',
      isDirectory: true,
      childChangeCount: 6,
      revision: 4802,
    },
    { path: `${WC_LOCAL}/src/main/svn.ts`, status: 'M', isDirectory: false, revision: 4802 },
    { path: `${WC_LOCAL}/src/main/client.ts`, status: 'C', isDirectory: false, revision: 4802 },
    { path: `${WC_LOCAL}/src/main/auth.ts`, status: 'R', isDirectory: false, revision: 4790 },
    { path: `${WC_LOCAL}/src/renderer/MergePreview.tsx`, status: 'A', isDirectory: false },
    {
      path: `${WC_LOCAL}/packages`,
      status: 'normal',
      isDirectory: true,
      childChangeCount: 1,
      revision: 4838,
    },
    {
      path: `${WC_LOCAL}/docs`,
      status: 'normal',
      isDirectory: true,
      childChangeCount: 1,
      revision: 4835,
    },
    {
      path: `${WC_LOCAL}/tests`,
      status: 'normal',
      isDirectory: true,
      childChangeCount: 1,
      revision: 4744,
    },
    {
      path: `${WC_LOCAL}/package.json`,
      status: 'M',
      isDirectory: false,
      revision: 4838,
      lock: { owner: 'jordan', comment: '', date: '2026-07-26T09:12:00Z' },
    },
    { path: `${WC_LOCAL}/tailwind.config.js`, status: 'M', isDirectory: false, revision: 4811 },
  ];

  const LOG = [
    {
      revision: 4838,
      author: 'mira.k',
      date: '2026-07-26T14:00:00Z',
      message: 'Fix lock retention when releasing stale locks',
      paths: [
        { action: 'M', path: '/trunk/src/main/svn.ts' },
        { action: 'M', path: '/trunk/package.json' },
      ],
    },
    {
      revision: 4837,
      author: 'devon',
      date: '2026-07-26T11:00:00Z',
      message: 'Add merge preview scaffolding',
      paths: [{ action: 'A', path: '/trunk/src/renderer/MergePreview.tsx' }],
    },
    {
      revision: 4836,
      author: 'tao.n',
      date: '2026-07-26T08:00:00Z',
      message: 'Bump oxlint to 1.4.0',
      paths: [{ action: 'M', path: '/trunk/package.json' }],
    },
    {
      revision: 4835,
      author: 'jordan',
      date: '2026-07-25T16:04:00Z',
      message: 'Harden SVN operations and compatibility coverage',
      paths: [{ action: 'M', path: '/trunk/docs/CHANGELOG.md' }],
    },
  ];

  const mkFile = (base) => (name, isDirectory, size) => ({
    name,
    path: `${base.replace(/\/$/, '')}/${name}`,
    isDirectory,
    size: size || 0,
    modifiedTime: '2026-07-26T14:00:00Z',
  });

  function directoryTree(target) {
    const mk = mkFile(target);
    const TREE = {
      '/Users': [mk('demo', true)],
      '/Users/demo': [mk('wc', true), mk('Documents', true), mk('Downloads', true)],
      '/Users/demo/wc': [mk('acme-website', true), mk('globex-portal', true)],
      [WC_LOCAL]: [
        mk('src', true),
        mk('packages', true),
        mk('docs', true),
        mk('tests', true),
        mk('vendor', true),
        mk('package.json', false, 4100),
        mk('tailwind.config.js', false, 3200),
        mk('README.md', false, 8800),
      ],
      [`${WC_LOCAL}/src`]: [mk('main', true), mk('preload', true), mk('renderer', true)],
      [`${WC_LOCAL}/src/main`]: [
        mk('svn.ts', false, 12000),
        mk('client.ts', false, 19000),
        mk('auth.ts', false, 8000),
      ],
      [`${WC_LOCAL}/src/renderer`]: [mk('components', true), mk('routes', true)],
      [`${WC_LOCAL}/packages`]: [mk('shared', true)],
      [`${WC_LOCAL}/docs`]: [mk('CHANGELOG.md', false, 11000)],
      [`${WC_LOCAL}/tests`]: [mk('setup.ts', false, 900)],
      [`${WC_LOCAL}/vendor`]: [],
      [WC_LOCAL_2]: [mk('src', true), mk('README.md', false, 400)],
    };
    return TREE[target.replace(/\/$/, '')] || [];
  }

  const info = (path) => ({
    path,
    url: `${ROOT}/${WC_REPO}`,
    repositoryRoot: ROOT,
    repositoryUuid: 'demo',
    revision: 4821,
    nodeKind: 'dir',
    lastChangedAuthor: 'mira.k',
    lastChangedRevision: 4838,
    lastChangedDate: '2026-07-26T14:00:00Z',
    workingCopyRoot: String(path).startsWith(WC_LOCAL_2) ? WC_LOCAL_2 : WC_LOCAL,
  });

  const fsStatus = (target) => {
    const base = String(target).replace(/\/$/, '');
    const directStatus = {};
    const allEntries = [];
    for (const entry of STATUS_ENTRIES) {
      const status = entry.status === 'normal' ? ' ' : entry.status;
      allEntries.push({ status, fullPath: entry.path, revision: entry.revision, author: 'jordan' });
      const parent = entry.path.slice(0, entry.path.lastIndexOf('/'));
      if (parent === base) {
        directStatus[entry.path.slice(entry.path.lastIndexOf('/') + 1)] = {
          status,
          revision: entry.revision,
          author: 'jordan',
          isDirectory: Boolean(entry.isDirectory),
          childChangeCount: entry.childChangeCount,
        };
      }
    }
    return { directStatus, allEntries };
  };

  const known = {
    'app.getPath': async () => '/Users/demo',
    'app.getVersion': async () => '0.0.0-preview',
    'app.window.isMaximized': async () => false,

    'auth.get': async () => null,
    'auth.list': async () => [{ username: 'jordan', realm: ROOT }],

    /* Onboarding must report "already seen" or the tutorial covers everything. */
    'store.get': async (key) => {
      /* A populated AI Review Center: two open findings across severities, one
         already triaged, a file explanation, questions and run history. */
      if (String(key).startsWith('shellysvn:ai-review-center:v1:')) {
        return {
          version: 1,
          workingCopyPath: WC_LOCAL,
          currentChecksum: 'c-4838',
          findings: [
            {
              id: 'f-1',
              severity: 'danger',
              category: 'correctness',
              title: 'Scope resolution now matches sibling client folders',
              detail:
                '`containsPath` treats `clients/acme` as a prefix of `clients/acme-corp`, so a checkout under the sibling folder resolves to the wrong working copy root.',
              filePath: `${WC_LOCAL}/src/main/svn.ts`,
              line: 13,
              confidence: 0.86,
              evidence: [],
              state: 'open',
            },
            {
              id: 'f-2',
              severity: 'warning',
              category: 'error-handling',
              title: 'Replaced auth path drops the cached realm',
              detail:
                'The realm is read before the replace and never re-read afterwards, so the next prompt asks for credentials that were already stored.',
              filePath: `${WC_LOCAL}/src/main/auth.ts`,
              line: 88,
              confidence: 0.62,
              evidence: [],
              state: 'open',
            },
            {
              id: 'f-3',
              severity: 'info',
              category: 'style',
              title: 'Tailwind glob could be narrowed to *.tsx',
              detail: 'Scanning every file lengthens rebuilds for no extra coverage.',
              filePath: `${WC_LOCAL}/tailwind.config.js`,
              line: 4,
              confidence: 0.4,
              evidence: [],
              state: 'accepted',
            },
          ],
          explanations: [
            {
              id: 'e-1',
              filePath: `${WC_LOCAL}/tailwind.config.js`,
              checksum: 'c-4838',
              createdAt: '2026-08-24T09:12:00.000Z',
              provider: 'codex',
              model: 'gpt-5.6-luna',
              durationMs: 1840,
              truncated: false,
              redacted: false,
              mode: 'summary',
              cached: false,
              summary:
                'Adds a `content` glob for the new renderer feature folder and widens the accent scale so the teal ramp has a 700 step.',
              rationale: '',
              risks: ['Longer Tailwind rebuilds', 'Existing accent-700 usage shifts'],
              reviewQuestions: [],
            },
          ],
          groups: [],
          questions: [
            'Should `containsPath` compare path segments instead of string prefixes?',
            'Does the new accent step keep 4.5:1 contrast on the sunk surface?',
          ],
          runs: [
            {
              id: 'r-1',
              kind: 'review',
              createdAt: '2026-08-24T09:14:00.000Z',
              checksum: 'c-4838',
              provider: 'codex',
              model: 'gpt-5.6-luna',
              durationMs: 8420,
              summary: '3 findings across 5 selected paths',
            },
            {
              id: 'r-2',
              kind: 'explanation',
              createdAt: '2026-08-24T09:12:00.000Z',
              checksum: 'c-4838',
              provider: 'codex',
              model: 'gpt-5.6-luna',
              durationMs: 1840,
              summary: 'tailwind.config.js — summarize file',
            },
            {
              id: 'r-3',
              kind: 'plan',
              createdAt: '2026-08-23T17:40:00.000Z',
              checksum: 'c-4811',
              provider: 'codex',
              durationMs: 6100,
              summary: '2 logical commits proposed',
            },
          ],
          updatedAt: '2026-08-24T09:14:00.000Z',
        };
      }
      if (key === 'onboarding') {
        return {
          hasCompletedTutorial: true,
          hasSkippedTutorial: true,
          currentStep: 0,
          completedSteps: [],
        };
      }
      if (key === 'hasLaunchedBefore') return true;
      if (key === 'settings') {
        return {
          /* AI on and pre-consented, so the commit dialog shows the live
             assistant row rather than "configure a provider". */
          aiCommit: {
            enabled: true,
            provider: 'auto',
            codexModel: 'gpt-5.6-luna',
            style: 'conventional',
            includeRecentHistory: false,
            historyLimit: 10,
            maxDiffBytes: 262_144,
            confirmBeforeSending: false,
            providerTimeoutMs: 60_000,
            maxSessionInvocations: 100,
            usageRetentionDays: 30,
            usageMaxEntries: 200,
          },
          recentRepositories: [WC_LOCAL, WC_LOCAL_2],
          recentPaths: [WC_LOCAL],
          bookmarks: [{ path: `${WC_LOCAL}/src`, name: 'website src', addedAt: 0 }],
          showFolderSizes: false,
          showStatusBar: true,
          // One application added by hand, so Settings shows a populated row.
          customOpenWithTools: [
            {
              id: 'bc',
              name: 'Beyond Compare',
              command: '/usr/local/bin/bcomp',
              arguments: '{path}',
              appliesTo: 'both',
            },
          ],
        };
      }
      if (key === 'shellysvn:sidebar-collapsed') return false;
      return undefined;
    },

    'fs.listDirectory': async (target) => directoryTree(String(target)),
    'fs.getStatus': async (target) => fsStatus(target),
    'fs.getDeepStatus': async (target) => fsStatus(target),
    /* Drives `isVersioned`, which gates the whole version-control toolbar group. */
    'fs.getDirectoryMetadata': async (target) => ({
      parentPath: String(target).replace(/\/[^/]+$/, '') || '/',
      isVersioned: String(target).startsWith(WC_LOCAL) || String(target).startsWith(WC_LOCAL_2),
      statusData: fsStatus(target),
      svnInfo: info(target),
      workingCopyUpgradeStatus: null,
      workingCopyContext: {
        workingCopyRoot: WC_LOCAL,
        repositoryRoot: ROOT,
        repositoryUuid: 'demo',
        workingCopyUrl: `${ROOT}/${WC_REPO}`,
        mappingLocalPath: WC_LOCAL,
      },
    }),
    'fs.exists': async () => true,

    'svn.list': async (url) => ({ path: url, entries: listFor(url) }),
    'svn.log': async () => ({ entries: LOG, startRevision: 4835, endRevision: 4838 }),
    'svn.status': async () => ({ path: WC_LOCAL, entries: STATUS_ENTRIES, revision: 4821 }),
    'svn.info': async (path) => info(path),
    'svn.infoUrl': async () => ({
      path: '/',
      url: ROOT,
      repositoryRoot: ROOT,
      repositoryUuid: 'demo',
      revision: 4838,
      nodeKind: 'dir',
      lastChangedAuthor: 'mira.k',
      lastChangedRevision: 4838,
      lastChangedDate: '2026-07-26T14:00:00Z',
    }),
    'svn.getWorkingCopyContext': async () => ({
      workingCopyRoot: WC_LOCAL,
      repositoryRoot: ROOT,
      repositoryUuid: 'demo',
      workingCopyUrl: `${ROOT}/${WC_REPO}`,
      mappingLocalPath: WC_LOCAL,
    }),

    /* `svn:diff` returns { files: [...] } — NOT { hunks }. Getting this wrong
       is the single easiest way to make the detail pane look broken. */
    /* `hasChanges` gates the viewers' empty state — without it the diff pane
       reports "No Changes" for a file that plainly has some. */
    'svn.diff': async (path) => ({
      hasChanges: true,
      isBinary: false,
      files: [
        {
          oldPath: path,
          newPath: path,
          hunks: [
            {
              oldStart: 12,
              oldLines: 7,
              newStart: 12,
              newLines: 9,
              lines: [
                {
                  type: 'context',
                  content: 'export function resolveScope(repoPath, roots) {',
                  oldLineNumber: 12,
                  newLineNumber: 12,
                },
                {
                  type: 'removed',
                  content: '  return roots.some((root) => repoPath.startsWith(root))',
                  oldLineNumber: 13,
                },
                {
                  type: 'added',
                  content: '  // A prefix test matches clients/acme against clients/acme-corp.',
                  newLineNumber: 13,
                },
                {
                  type: 'added',
                  content: '  return roots.some((root) => containsPath(root, repoPath))',
                  newLineNumber: 14,
                },
                {
                  type: 'context',
                  content: "    ? 'working-copy'",
                  oldLineNumber: 14,
                  newLineNumber: 15,
                },
                {
                  type: 'context',
                  content: "    : 'repository';",
                  oldLineNumber: 15,
                  newLineNumber: 16,
                },
                { type: 'context', content: '}', oldLineNumber: 16, newLineNumber: 17 },
              ],
            },
          ],
        },
      ],
    }),
    'svn.diffUrls': async (left) => known['svn.diff'](left),

    'svn.blame': async () => ({
      lines: [
        {
          revision: 4802,
          author: 'jordan',
          date: '2026-07-26T18:38:00Z',
          lineNumber: 1,
          content: "import { resolveScope } from './adapters';",
        },
        {
          revision: 4802,
          author: 'jordan',
          date: '2026-07-26T18:38:00Z',
          lineNumber: 2,
          content: '',
        },
        {
          revision: 4790,
          author: 'mira.k',
          date: '2026-07-20T09:00:00Z',
          lineNumber: 3,
          content: 'export function listing(entries) {',
        },
        {
          revision: null,
          author: 'jordan',
          date: '',
          lineNumber: 4,
          content: '  // uncommitted local edit',
        },
        {
          revision: 4838,
          author: 'devon',
          date: '2026-07-26T14:00:00Z',
          lineNumber: 5,
          content: '  return entries.map(toRow);',
        },
        {
          revision: 4790,
          author: 'mira.k',
          date: '2026-07-20T09:00:00Z',
          lineNumber: 6,
          content: '}',
        },
      ],
    }),

    'svn.mergeInfo': async () => ({
      source: '',
      target: '',
      kind: 'eligible',
      revisions: [4831, 4835, 4836, 4838],
      properties: [],
      rawOutput: '',
    }),
    'svn.proplist': async () => ({
      properties: [
        { name: 'svn:externals', value: '^/vendor/plex-fonts vendor' },
        { name: 'bugtraq:url', value: 'https://jira.example.com/%BUGID%' },
      ],
    }),
    'svn.externals.list': async () => ({
      externals: [{ name: 'plex-fonts', url: '^/vendor/plex-fonts', path: `${WC_REPO}/vendor` }],
    }),
    'svn.shelve.list': async () => ({
      shelves: [{ name: 'nav-refresh', message: 'nav refresh', date: '2026-07-26T10:00:00Z' }],
    }),
    // Two editors "on PATH", so the context menu's submenu has something to show.
    'external.listEditors': async () => [
      { id: 'vscode', label: 'VS Code', command: 'code' },
      { id: 'cursor', label: 'Cursor', command: 'cursor' },
      // One the "user" added in Settings, to show both kinds together.
      {
        id: 'custom:bc',
        label: 'Beyond Compare',
        command: 'bcomp',
        appliesTo: 'both',
        custom: true,
      },
    ],
    'external.openInEditor': async () => ({ success: true }),

    /* One available CLI provider, and a canned answer for every AI task the
       commit dialog can ask for. */
    'ai.providers': async () => [
      {
        provider: 'codex',
        available: true,
        authenticated: true,
        cliLoggedIn: true,
        version: '1.4.2',
        kind: 'cli',
      },
    ],
    'ai.repositoryProfile': async () => null,
    'ai.preparePrompt': async () => ({
      provider: 'codex',
      model: 'gpt-5.6-luna',
      prompt: '# Diff\n--- a/tailwind.config.js\n+++ b/tailwind.config.js\n@@ …',
      inputBytes: 2048,
      truncated: false,
      redacted: false,
      includedHistoryMessages: 0,
    }),
    'ai.explainDiff': async (request) => ({
      provider: 'codex',
      model: 'gpt-5.6-luna',
      durationMs: 1840,
      truncated: false,
      redacted: false,
      mode: request?.mode ?? 'summary',
      cached: false,
      summary:
        'Adds a `content` glob for the new renderer feature folder and widens the accent scale so the teal ramp has a 700 step.',
      rationale:
        'The new folder was not being scanned, so its utility classes were dropped from the production build.',
      risks: [
        'The wider glob lengthens every Tailwind rebuild; watch dev-server start times.',
        'A 700 step changes any existing `accent-700` usage that relied on the fallback.',
      ],
      reviewQuestions: [
        'Should the glob be scoped to `**/*.tsx` rather than every file?',
        'Does the new accent step meet contrast on the sunk surface?',
      ],
    }),
  };

  /**
   * Any `window.api.a.b.c(...)` resolves to `known['a.b.c']` when modelled and
   * to `undefined` otherwise, so an unmodelled call degrades rather than throws.
   */
  function node(prefix) {
    return new Proxy(function () {}, {
      get(_target, property) {
        if (typeof property !== 'string' || property === 'then') return undefined;
        return node(prefix ? `${prefix}.${property}` : property);
      },
      apply(_target, _thisArg, args) {
        const handler = known[prefix];
        if (handler) return handler(...args);
        // `onSomething(cb)` subscriptions must hand back an unsubscribe.
        if (/^on[A-Z]/.test(prefix.split('.').pop() || '')) return () => {};
        return Promise.resolve(undefined);
      },
    });
  }

  window.api = node('');
  window.__SHELLY_PREVIEW__ = { ROOT, WC_REPO, WC_LOCAL };
})();
