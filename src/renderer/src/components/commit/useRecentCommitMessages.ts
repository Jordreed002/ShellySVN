import { useCallback, useEffect, useState } from 'react';
import {
  addRecentMessageToStore,
  loadRecentMessages,
  parseRecentMessageStore,
  pruneWorkingCopies,
  RECENT_COMMIT_MESSAGES_KEY,
  saveRecentMessageStore,
  trimRecentMessages,
  type RecentCommitMessageEntry,
} from './recentCommitMessages';

function normalizeWorkingCopyKey(workingCopyPath: string): string {
  return workingCopyPath.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Recall list of recently committed messages for one working copy (#73a).
 *
 * Complementary to the global `useCommitMessageHistory` — that one feeds the
 * autocomplete and the all-repositories History section; this one powers the
 * "This working copy" section at the top of the same dropdown.
 */
export function useRecentCommitMessages(workingCopyPath: string) {
  const [entries, setEntries] = useState<RecentCommitMessageEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!workingCopyPath) {
      setEntries([]);
      return;
    }

    void loadRecentMessages(workingCopyPath).then((loaded) => {
      if (!cancelled) setEntries(loaded);
    });

    return () => {
      cancelled = true;
    };
  }, [workingCopyPath]);

  const addRecentMessage = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || !workingCopyPath) return;

      const optimistic = trimRecentMessages([
        { message: trimmed, timestamp: Date.now() },
        ...entries,
      ]);
      setEntries(optimistic);

      try {
        const stored = await window.api?.store?.get<unknown>(RECENT_COMMIT_MESSAGES_KEY);
        const next = addRecentMessageToStore(
          parseRecentMessageStore(stored),
          workingCopyPath,
          trimmed
        );
        await saveRecentMessageStore(next);
        const reloaded = await loadRecentMessages(workingCopyPath);
        setEntries(reloaded);
      } catch {
        // Keep the optimistic list; persistence failures degrade silently.
      }
    },
    [entries, workingCopyPath]
  );

  const removeRecentMessage = useCallback(
    async (timestamp: number) => {
      if (!workingCopyPath) return;
      const next = entries.filter((entry) => entry.timestamp !== timestamp);
      setEntries(next);
      try {
        const stored = await window.api?.store?.get<unknown>(RECENT_COMMIT_MESSAGES_KEY);
        const store = parseRecentMessageStore(stored);
        store[normalizeWorkingCopyKey(workingCopyPath)] = next;
        await saveRecentMessageStore(pruneWorkingCopies(store));
      } catch {
        // Degrade silently.
      }
    },
    [entries, workingCopyPath]
  );

  return { recentMessages: entries, addRecentMessage, removeRecentMessage };
}
