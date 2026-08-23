import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_TAB_SESSION,
  MAX_TABS,
  TAB_SESSION_KEY,
  activateTab,
  closeOtherTabs,
  closeTab,
  clearPendingRoute,
  defaultRouteForWorkingCopy,
  getPendingRoute,
  getTabSession,
  openTab,
  parseTabSession,
  pathIdentity,
  pathIsUnder,
  recordActiveTabRoute,
  resetTabSessionForTests,
  routeBelongsToTab,
  routeEquals,
  subscribeTabSession,
  ensureTabSessionHydrated,
  type ShellTab,
} from '../tabsStore';

function mockStore(initial: unknown = undefined) {
  const stored = new Map<string, unknown>();
  if (initial !== undefined) stored.set(TAB_SESSION_KEY, initial);
  const set = vi.fn(async (key: string, value: unknown) => {
    stored.set(key, value);
  });
  const get = vi.fn(async (key: string) => stored.get(key));
  window.api = { store: { get, set } } as unknown as Window['api'];
  return { set, get, stored };
}

const filesRoute = (path: string) => ({ pathname: '/files', search: { path } });

describe('tabsStore pure helpers', () => {
  it('normalises path identity across separators, case and trailing slashes', () => {
    expect(pathIdentity('/wc/atlas/')).toBe('/wc/atlas');
    expect(pathIdentity('C:\\Repos\\Atlas')).toBe('c:/repos/atlas');
    expect(pathIdentity('/WC/Atlas')).toBe('/WC/Atlas');
  });

  it('detects paths at or under a working copy root', () => {
    expect(pathIsUnder('/wc/atlas/trunk', '/wc/atlas')).toBe(true);
    expect(pathIsUnder('/wc/atlas', '/wc/atlas')).toBe(true);
    expect(pathIsUnder('/wc/atlas-plus', '/wc/atlas')).toBe(false);
    expect(pathIsUnder('/elsewhere', '/wc/atlas')).toBe(false);
  });

  it('compares routes by pathname and search contents regardless of key order', () => {
    expect(
      routeEquals(
        { pathname: '/files', search: { path: '/a', dialog: 'problems' } },
        { pathname: '/files', search: { dialog: 'problems', path: '/a' } }
      )
    ).toBe(true);
    expect(routeEquals(filesRoute('/a'), filesRoute('/b'))).toBe(false);
    expect(routeEquals(filesRoute('/a'), { pathname: '/history', search: { path: '/a' } })).toBe(
      false
    );
  });

  it('only records routes that still describe the tab working copy', () => {
    const tab: ShellTab = {
      id: 't1',
      workingCopyPath: '/wc/atlas',
      route: filesRoute('/wc/atlas'),
    };
    expect(routeBelongsToTab(tab, filesRoute('/wc/atlas/trunk'))).toBe(true);
    expect(routeBelongsToTab(tab, filesRoute('/wc/other'))).toBe(false);
    expect(routeBelongsToTab(tab, { pathname: '/', search: {} })).toBe(false);
    // Repo browser locations count via localPath.
    expect(
      routeBelongsToTab(tab, { pathname: '/repo-browser', search: { localPath: '/wc/atlas' } })
    ).toBe(true);
    // Same repository URL the tab already shows counts.
    expect(
      routeBelongsToTab(
        { ...tab, route: { pathname: '/repo-browser', search: { url: 'https://s/x' } } },
        { pathname: '/repo-browser', search: { url: 'https://s/x' } }
      )
    ).toBe(true);
  });

  it('parses persisted sessions strictly and drops malformed tabs', () => {
    const parsed = parseTabSession({
      version: 1,
      tabs: [
        { id: 'a', workingCopyPath: '/wc/a', route: filesRoute('/wc/a') },
        { id: 'a', workingCopyPath: '/dup-id', route: filesRoute('/dup') },
        { id: '', workingCopyPath: '/no-id', route: filesRoute('/x') },
        { id: 'b', workingCopyPath: '/wc/b', route: { pathname: 'not-a-path', search: {} } },
        null,
        { id: 'c', workingCopyPath: '/wc/c', route: filesRoute('/wc/c') },
      ],
      activeTabId: 'c',
    });
    expect(parsed.tabs.map((tab) => tab.id)).toEqual(['a', 'c']);
    expect(parsed.activeTabId).toBe('c');

    expect(parseTabSession(null)).toEqual(DEFAULT_TAB_SESSION);
    expect(parseTabSession('nonsense')).toEqual(DEFAULT_TAB_SESSION);
    // An activeTabId that points nowhere falls back to the first tab.
    expect(parseTabSession({ tabs: [{ id: 'a', workingCopyPath: '/w', route: filesRoute('/w') }], activeTabId: 'zzz' }).activeTabId).toBe('a');
  });
});

describe('tabsStore module store', () => {
  beforeEach(() => {
    resetTabSessionForTests();
    mockStore();
  });

  it('opens a tab with a default /files route, activates it and persists', () => {
    const id = openTab('/wc/atlas');
    expect(id).toBeTruthy();
    const session = getTabSession();
    expect(session.tabs).toHaveLength(1);
    expect(session.tabs[0].route).toEqual(defaultRouteForWorkingCopy('/wc/atlas'));
    expect(session.activeTabId).toBe(id);
    expect(window.api.store.set).toHaveBeenCalledWith(TAB_SESSION_KEY, session);
  });

  it('reuses an existing tab for the same working copy by default, and creates a second view on demand', () => {
    const first = openTab('/wc/atlas');
    const second = openTab('/wc/atlas', { pathname: '/history', search: { path: '/wc/atlas' } });
    expect(second).toBe(first);
    expect(getTabSession().tabs).toHaveLength(1);
    expect(getTabSession().tabs[0].route.pathname).toBe('/history');

    // Tabs are views: the picker may open the same working copy twice.
    const third = openTab('/wc/atlas', undefined, { reuseExisting: false });
    expect(third).not.toBe(first);
    expect(getTabSession().tabs).toHaveLength(2);
    // The newest tab stays active; both views share one working copy.
    expect(getTabSession().activeTabId).toBe(third);
  });

  it('caps the strip at MAX_TABS by dropping the oldest tab', () => {
    for (let index = 0; index < MAX_TABS + 3; index += 1) {
      openTab(`/wc/repo-${index}`, undefined, { reuseExisting: false });
    }
    const session = getTabSession();
    expect(session.tabs).toHaveLength(MAX_TABS);
    expect(session.tabs[0].workingCopyPath).toBe('/wc/repo-3');
    expect(session.activeTabId).toBe(session.tabs[session.tabs.length - 1].id);
  });

  it('activating a tab sets the pending route the router must land on', () => {
    openTab('/wc/a', undefined, { reuseExisting: false });
    const second = openTab('/wc/b', undefined, { reuseExisting: false });
    const route = { pathname: '/files', search: { path: '/wc/a/sub' } };
    activateTab(getTabSession().tabs[0].id, route);
    expect(getPendingRoute()).toEqual(route);
    expect(getTabSession().activeTabId).toBe(getTabSession().tabs[0].id);
    expect(second).toBeTruthy();
  });

  it('closing the active tab hands the active slot to a neighbour and clears when empty', () => {
    const a = openTab('/wc/a', undefined, { reuseExisting: false });
    openTab('/wc/b', undefined, { reuseExisting: false });
    closeTab(a);
    expect(getTabSession().tabs).toHaveLength(1);
    expect(getTabSession().activeTabId).toBe(getTabSession().tabs[0].id);

    closeTab(getTabSession().activeTabId!);
    expect(getTabSession().tabs).toHaveLength(0);
    expect(getTabSession().activeTabId).toBeNull();
  });

  it('closeOthers keeps exactly the requested tab and activates it', () => {
    openTab('/wc/a', undefined, { reuseExisting: false });
    openTab('/wc/b', undefined, { reuseExisting: false });
    const keeper = openTab('/wc/c', undefined, { reuseExisting: false, activate: false });
    closeOtherTabs(keeper!);
    const session = getTabSession();
    expect(session.tabs).toHaveLength(1);
    expect(session.tabs[0].id).toBe(keeper);
    expect(session.activeTabId).toBe(keeper);
  });

  it('records the active tab route, muted during pending switches and for foreign routes', () => {
    openTab('/wc/a', undefined, { reuseExisting: false });
    openTab('/wc/b', undefined, { reuseExisting: false });
    const [tabA] = getTabSession().tabs;

    // Landing on the opening navigation clears its pending route.
    expect(recordActiveTabRoute(filesRoute('/wc/b'))).toBe(false);
    expect(getPendingRoute()).toBeNull();

    // Normal recording: navigate within the active tab's working copy.
    expect(recordActiveTabRoute(filesRoute('/wc/b/sub'))).toBe(true);
    expect(getTabSession().tabs[1].route).toEqual(filesRoute('/wc/b/sub'));
    expect(getTabSession().tabs[0].route).toEqual(defaultRouteForWorkingCopy('/wc/a'));

    // A route outside the working copy (e.g. home) never overwrites the tab.
    expect(recordActiveTabRoute({ pathname: '/', search: {} })).toBe(false);
    expect(getTabSession().tabs[1].route.pathname).toBe('/files');

    // Switching to tab A mutes recording until the router lands there.
    activateTab(tabA.id);
    expect(recordActiveTabRoute(filesRoute('/wc/b/again'))).toBe(false);
    expect(getTabSession().tabs[1].route.pathname).toBe('/files');
    expect(recordActiveTabRoute(filesRoute('/wc/a'))).toBe(false); // pending cleared on match
    expect(getPendingRoute()).toBeNull();
    // Recording resumes after landing.
    expect(recordActiveTabRoute(filesRoute('/wc/a/deep'))).toBe(true);
    expect(getTabSession().tabs[0].route).toEqual(filesRoute('/wc/a/deep'));

    clearPendingRoute();
  });

  it('hydrates from the persisted session once and notifies subscribers', async () => {
    const persisted = {
      version: 1,
      tabs: [{ id: 'saved', workingCopyPath: '/wc/saved', route: filesRoute('/wc/saved') }],
      activeTabId: 'saved',
    };
    resetTabSessionForTests();
    mockStore(persisted);

    const seen: number[] = [];
    const unsubscribe = subscribeTabSession(() => seen.push(getTabSession().tabs.length));
    await ensureTabSessionHydrated();
    expect(getTabSession().tabs[0].workingCopyPath).toBe('/wc/saved');
    expect(getTabSession().activeTabId).toBe('saved');
    expect(seen.length).toBeGreaterThan(0);

    // A second call reuses the same hydration promise.
    await ensureTabSessionHydrated();
    unsubscribe();
  });

  it('degrades to an empty session when the persisted payload is unreadable', async () => {
    resetTabSessionForTests();
    window.api = {
      store: { get: vi.fn().mockRejectedValue(new Error('store down')), set: vi.fn() },
    } as unknown as Window['api'];
    await ensureTabSessionHydrated();
    expect(getTabSession()).toEqual(DEFAULT_TAB_SESSION);
    resetTabSessionForTests();
  });
});
