/**
 * Session restore planning (#84).
 *
 * Pure decision logic: given the startup action the user configured and the
 * persisted tab session, what should the first rendered location be?
 *
 *  - `'lastRepo'` restores the session (tabs + active tab + its last route),
 *    falling back to the most recent repository when no tabs were saved.
 *  - `'welcome'` shows home, with the session restorable from a call to
 *    action — the plan carries the session so the CTA knows what it offers.
 *  - `'empty'` starts clean; nothing is restored or offered.
 *
 * The default when the setting is missing is `'welcome'` (see
 * `packages/shared/src/settings-defaults.ts`), which matches the hook's
 * default and keeps first launches on home.
 */

import type { StartupAction } from '@shared/types';
import { pathIsUnder, type ShellTab, type TabSession } from './tabsStore';

export type SessionRestorePlan =
  | { action: 'restore'; session: TabSession; activeTab: ShellTab | null }
  | { action: 'home-restorable'; session: TabSession }
  | { action: 'open-recent'; path: string }
  | { action: 'none' };

export interface SessionRestoreInput {
  startupAction: StartupAction | undefined;
  session: TabSession;
  recentRepositories?: readonly string[];
}

function activeTabOf(session: TabSession): ShellTab | null {
  return (
    session.tabs.find((tab) => tab.id === session.activeTabId) ?? session.tabs[0] ?? null
  );
}

/** True when a dropped/typed path matches a saved tab's working copy. */
export function sessionCoversPath(session: TabSession, path: string): boolean {
  return session.tabs.some((tab) => pathIsUnder(path, tab.workingCopyPath));
}

export function planSessionRestore({
  startupAction,
  session,
  recentRepositories = [],
}: SessionRestoreInput): SessionRestorePlan {
  // A missing setting means the defaults (`settings-defaults.ts`): welcome.
  const action = startupAction ?? 'welcome';
  const hasTabs = session.tabs.length > 0;

  if (action === 'lastRepo') {
    if (hasTabs) return { action: 'restore', session, activeTab: activeTabOf(session) };
    const recent = recentRepositories.find((candidate) => !!candidate && candidate.trim() !== '');
    if (recent) return { action: 'open-recent', path: recent };
    return { action: 'none' };
  }

  if (action === 'welcome' && hasTabs) {
    return { action: 'home-restorable', session };
  }

  return { action: 'none' };
}

/** Whether a "Restore last session" affordance should be offered at all. */
export function isRestorableOffer(plan: SessionRestorePlan): boolean {
  return plan.action === 'home-restorable' && plan.session.tabs.length > 0;
}
