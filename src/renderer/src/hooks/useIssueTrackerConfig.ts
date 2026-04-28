import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_ISSUE_TRACKER_CONFIG,
  normalizeIssueTrackerConfig,
  type IssueTrackerConfig,
} from '@renderer/utils/issueTracker';
import debug from '@shared/utils/debug';

const STORAGE_KEY = 'shellysvn:issue-trackers';

type IssueTrackerStore = Record<string, IssueTrackerConfig>;

export function useIssueTrackerConfig(workingCopyPath: string) {
  const [config, setConfig] = useState<IssueTrackerConfig>(DEFAULT_ISSUE_TRACKER_CONFIG);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      if (!workingCopyPath) {
        setConfig(DEFAULT_ISSUE_TRACKER_CONFIG);
        return;
      }

      setIsLoading(true);
      try {
        const stored = (await window.api.store.get<IssueTrackerStore>(STORAGE_KEY)) || {};
        if (!cancelled) {
          setConfig(normalizeIssueTrackerConfig(stored[workingCopyPath]));
        }
      } catch (error) {
        debug.error('Failed to load issue tracker config:', error);
        if (!cancelled) {
          setConfig(DEFAULT_ISSUE_TRACKER_CONFIG);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadConfig();

    return () => {
      cancelled = true;
    };
  }, [workingCopyPath]);

  const updateConfig = useCallback(
    async (updates: Partial<IssueTrackerConfig>) => {
      const nextConfig = normalizeIssueTrackerConfig({ ...config, ...updates });
      setConfig(nextConfig);

      try {
        const stored = (await window.api.store.get<IssueTrackerStore>(STORAGE_KEY)) || {};
        stored[workingCopyPath] = nextConfig;
        await window.api.store.set(STORAGE_KEY, stored);
      } catch (error) {
        debug.error('Failed to save issue tracker config:', error);
      }
    },
    [config, workingCopyPath]
  );

  return { config, updateConfig, isLoading };
}
