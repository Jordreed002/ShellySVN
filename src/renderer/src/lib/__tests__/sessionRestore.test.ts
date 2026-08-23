import { describe, expect, it } from 'vitest';

import {
  isRestorableOffer,
  planSessionRestore,
  sessionCoversPath,
} from '../sessionRestore';
import { DEFAULT_TAB_SESSION, type TabSession } from '../tabsStore';

const tab = (id: string, path: string): TabSession['tabs'][number] => ({
  id,
  workingCopyPath: path,
  route: { pathname: '/files', search: { path } },
});

const sessionWith = (...paths: string[]): TabSession => ({
  version: 1,
  tabs: paths.map((path, index) => tab(`t${index}`, path)),
  activeTabId: paths.length ? 't0' : null,
});

describe('planSessionRestore', () => {
  it("restores the saved session (tabs + active tab + its route) under 'lastRepo'", () => {
    const session = sessionWith('/wc/atlas', '/wc/nadir');
    const plan = planSessionRestore({ startupAction: 'lastRepo', session });
    expect(plan).toEqual({ action: 'restore', session, activeTab: session.tabs[0] });
  });

  it("falls back to the most recent repository under 'lastRepo' when no tabs were saved", () => {
    expect(
      planSessionRestore({
        startupAction: 'lastRepo',
        session: DEFAULT_TAB_SESSION,
        recentRepositories: ['/wc/atlas', '/wc/older'],
      })
    ).toEqual({ action: 'open-recent', path: '/wc/atlas' });
  });

  it("does nothing under 'lastRepo' when there is nothing to open", () => {
    expect(
      planSessionRestore({ startupAction: 'lastRepo', session: DEFAULT_TAB_SESSION })
    ).toEqual({ action: 'none' });
  });

  it("stays home under 'welcome' but carries the session so a CTA can offer it", () => {
    const session = sessionWith('/wc/atlas');
    const plan = planSessionRestore({ startupAction: 'welcome', session });
    expect(plan).toEqual({ action: 'home-restorable', session });
    expect(isRestorableOffer(plan)).toBe(true);
  });

  it("offers nothing under 'welcome' without a saved session", () => {
    const plan = planSessionRestore({
      startupAction: 'welcome',
      session: DEFAULT_TAB_SESSION,
    });
    expect(plan.action).toBe('none');
    expect(isRestorableOffer(plan)).toBe(false);
  });

  it("starts clean under 'empty' regardless of the saved session", () => {
    expect(
      planSessionRestore({ startupAction: 'empty', session: sessionWith('/wc/atlas') })
    ).toEqual({ action: 'none' });
  });

  it('treats a missing setting as the welcome default', () => {
    expect(
      planSessionRestore({ startupAction: undefined, session: sessionWith('/wc/a') }).action
    ).toBe('home-restorable');
  });

  it('skips blank recent repositories when choosing the fallback', () => {
    expect(
      planSessionRestore({
        startupAction: 'lastRepo',
        session: DEFAULT_TAB_SESSION,
        recentRepositories: ['  ', '', '/wc/real'],
      })
    ).toEqual({ action: 'open-recent', path: '/wc/real' });
  });
});

describe('sessionCoversPath', () => {
  it('matches a path at or under any saved tab working copy', () => {
    expect(sessionCoversPath(sessionWith('/wc/atlas'), '/wc/atlas/trunk')).toBe(true);
    expect(sessionCoversPath(sessionWith('/wc/atlas'), '/wc/elsewhere')).toBe(false);
    expect(sessionCoversPath(DEFAULT_TAB_SESSION, '/wc/atlas')).toBe(false);
  });
});
