import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, mergeDeep, mergeSettings } from '@shared/settings-defaults';
import type { AppSettings } from '@shared/types';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K];
};

/**
 * Return type for useSettings hook
 * Provides explicit typing for the hook's public API
 */
export interface UseSettingsReturn {
  settings: AppSettings;
  isLoading: boolean;
  error: Error | null;
  updateSettings: (updates: DeepPartial<AppSettings>) => Promise<AppSettings>;
  addRecentRepo: (repoPath: string) => Promise<void>;
  removeRecentRepo: (repoPath: string) => Promise<void>;
  addRecentPath: (path: string) => Promise<void>;
  addBookmark: (path: string, name: string) => Promise<void>;
  removeBookmark: (path: string) => Promise<void>;
  isUpdating: boolean;
}

const MAX_RECENT_REPOS = 10;
const MAX_RECENT_PATHS = 20;
const MAX_BOOKMARKS = 50;

const SETTINGS_QUERY_KEY = ['settings'] as const;

async function loadStoredSettings(): Promise<AppSettings> {
  return mergeSettings(await window.api.store.get<AppSettings>('settings'));
}

export function useSettings(): UseSettingsReturn {
  const queryClient = useQueryClient();

  const {
    data: settings,
    isLoading,
    error,
  } = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: loadStoredSettings,
    staleTime: Infinity, // Settings don't change often
    refetchOnMount: false, // Don't refetch when component mounts if data exists
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });

  /**
   * The settings as they are actually stored — read from the cache when it is
   * warm, otherwise from disk.
   *
   * Never fall back to `DEFAULT_SETTINGS` here. Every writer below merges onto
   * this value and then persists the whole object, so defaulting would mean a
   * write that lands before the settings query resolves **erases** the user's
   * real recent repositories and bookmarks from disk. A route that records a
   * recent path on mount (`/files` does) loses that race easily on a cold start.
   */
  const readCurrentSettings = useCallback(
    (): Promise<AppSettings> =>
      queryClient.ensureQueryData({
        queryKey: SETTINGS_QUERY_KEY,
        queryFn: loadStoredSettings,
      }),
    [queryClient]
  );

  // Mutation for updating settings
  const updateMutation = useMutation({
    mutationFn: async (updates: DeepPartial<AppSettings>) => {
      const current = await readCurrentSettings();
      const updated = mergeDeep(
        current as unknown as Record<string, unknown>,
        updates as Partial<Record<string, unknown>>
      ) as unknown as AppSettings;
      await window.api.store.set('settings', updated);
      return updated;
    },
    onSuccess: (updated) => {
      // Update the cache immediately
      queryClient.setQueryData(SETTINGS_QUERY_KEY, updated);
    },
  });
  const { mutateAsync, isPending } = updateMutation;

  // Add a repository to recent list
  const addRecentRepo = useCallback(
    async (repoPath: string) => {
      // Read the latest cached value to avoid race conditions
      const current = await readCurrentSettings();
      const currentRecents = current.recentRepositories || [];

      // Remove if already exists (to move to top)
      const filtered = currentRecents.filter((p) => p !== repoPath);

      // Add to beginning, limit to max
      const updated = [repoPath, ...filtered].slice(0, MAX_RECENT_REPOS);

      await mutateAsync({ recentRepositories: updated });
    },
    [readCurrentSettings, mutateAsync]
  );

  // Remove a repository from recent list
  const removeRecentRepo = useCallback(
    async (repoPath: string) => {
      // Read the latest cached value to avoid race conditions
      const current = await readCurrentSettings();
      const updated = (current.recentRepositories || []).filter((p) => p !== repoPath);
      await mutateAsync({ recentRepositories: updated });
    },
    [readCurrentSettings, mutateAsync]
  );

  // Add a path to recent paths
  const addRecentPath = useCallback(
    async (path: string) => {
      const current = await readCurrentSettings();
      const currentPaths = current.recentPaths || [];
      const filtered = currentPaths.filter((p) => p !== path);
      const updated = [path, ...filtered].slice(0, MAX_RECENT_PATHS);
      await mutateAsync({ recentPaths: updated });
    },
    [readCurrentSettings, mutateAsync]
  );

  // Add a bookmark
  const addBookmark = useCallback(
    async (path: string, name: string) => {
      const current = await readCurrentSettings();
      const currentBookmarks = current.bookmarks || [];
      // Check if already bookmarked
      if (currentBookmarks.some((b) => b.path === path)) return;
      const newBookmark = { path, name, addedAt: Date.now() };
      const updated = [newBookmark, ...currentBookmarks].slice(0, MAX_BOOKMARKS);
      await mutateAsync({ bookmarks: updated });
    },
    [readCurrentSettings, mutateAsync]
  );

  // Remove a bookmark
  const removeBookmark = useCallback(
    async (path: string) => {
      const current = await readCurrentSettings();
      const updated = (current.bookmarks || []).filter((b) => b.path !== path);
      await mutateAsync({ bookmarks: updated });
    },
    [readCurrentSettings, mutateAsync]
  );

  // Update any setting
  const updateSettings = useCallback(
    async (updates: DeepPartial<AppSettings>) => {
      return mutateAsync(updates);
    },
    [mutateAsync]
  );

  return useMemo(
    () => ({
      settings: settings || DEFAULT_SETTINGS,
      isLoading,
      error,
      updateSettings,
      addRecentRepo,
      removeRecentRepo,
      addRecentPath,
      addBookmark,
      removeBookmark,
      isUpdating: isPending,
    }),
    [
      settings,
      isLoading,
      error,
      updateSettings,
      addRecentRepo,
      removeRecentRepo,
      addRecentPath,
      addBookmark,
      removeBookmark,
      isPending,
    ]
  );
}
