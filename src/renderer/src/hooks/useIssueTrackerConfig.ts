import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_ISSUE_TRACKER_CONFIG,
  getInheritedPropertyLookupPaths,
  issueTrackerConfigFromBugtraqProperties,
  normalizeIssueTrackerConfig,
  type IssueTrackerConfig,
} from '@renderer/utils/issueTracker';
import debug from '@shared/utils/debug';

const STORAGE_KEY = 'shellysvn:issue-trackers';

type IssueTrackerStore = Record<string, IssueTrackerConfig>;

export function useIssueTrackerConfig(workingCopyPath: string, lookupPath = workingCopyPath) {
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
        if (cancelled) return;

        if (Object.prototype.hasOwnProperty.call(stored, workingCopyPath)) {
          setConfig(normalizeIssueTrackerConfig(stored[workingCopyPath]));
          return;
        }

        const bugtraqConfig = await loadInheritedBugtraqConfig(lookupPath, workingCopyPath, () =>
          cancelled
        );
        if (cancelled) return;
        setConfig(bugtraqConfig || DEFAULT_ISSUE_TRACKER_CONFIG);
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
  }, [workingCopyPath, lookupPath]);

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

async function loadInheritedBugtraqConfig(
  lookupPath: string,
  workingCopyPath: string,
  isCancelled: () => boolean
): Promise<IssueTrackerConfig | null> {
  for (const propertyPath of getInheritedPropertyLookupPaths(lookupPath, workingCopyPath)) {
    if (isCancelled()) return null;

    try {
      const properties = await window.api.svn.proplist(propertyPath);
      const bugtraqConfig = issueTrackerConfigFromBugtraqProperties(properties);
      if (bugtraqConfig) {
        return bugtraqConfig;
      }
    } catch (error) {
      debug.log('Skipping inherited bugtraq property lookup:', propertyPath, error);
    }
  }

  return null;
}
