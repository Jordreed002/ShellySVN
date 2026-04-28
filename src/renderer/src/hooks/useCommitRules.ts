import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_COMMIT_RULES,
  normalizeCommitRules,
  type CommitRules,
} from '@renderer/utils/commitRules';
import debug from '@shared/utils/debug';

const STORAGE_KEY = 'shellysvn:commit-rules';

type CommitRuleStore = Record<string, CommitRules>;

export function useCommitRules(workingCopyPath: string) {
  const [rules, setRules] = useState<CommitRules>(DEFAULT_COMMIT_RULES);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadRules() {
      if (!workingCopyPath) {
        setRules(DEFAULT_COMMIT_RULES);
        return;
      }

      setIsLoading(true);
      try {
        const stored = (await window.api.store.get<CommitRuleStore>(STORAGE_KEY)) || {};
        if (!cancelled) {
          setRules(normalizeCommitRules(stored[workingCopyPath]));
        }
      } catch (error) {
        debug.error('Failed to load commit rules:', error);
        if (!cancelled) {
          setRules(DEFAULT_COMMIT_RULES);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadRules();

    return () => {
      cancelled = true;
    };
  }, [workingCopyPath]);

  const updateRules = useCallback(
    async (updates: Partial<CommitRules>) => {
      const nextRules = normalizeCommitRules({ ...rules, ...updates });
      setRules(nextRules);

      try {
        const stored = (await window.api.store.get<CommitRuleStore>(STORAGE_KEY)) || {};
        stored[workingCopyPath] = nextRules;
        await window.api.store.set(STORAGE_KEY, stored);
      } catch (error) {
        debug.error('Failed to save commit rules:', error);
      }
    },
    [rules, workingCopyPath]
  );

  return { rules, updateRules, isLoading };
}
