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

export function useSettings(): UseSettingsReturn {
  const queryClient = useQueryClient();

  const {
    data: settings,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const stored = await window.api.store.get<AppSettings>('settings');
      return mergeSettings(stored);
    },
    staleTime: Infinity, // Settings don't change often
    refetchOnMount: false, // Don't refetch when component mounts if data exists
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });

  // Mutation for updating settings
  const updateMutation = useMutation({
    mutationFn: async (updates: DeepPartial<AppSettings>) => {
      // Read the LATEST cached value directly from queryClient to avoid stale closures
      const current = queryClient.getQueryData<AppSettings>(['settings']) || DEFAULT_SETTINGS;
      const updated = mergeDeep(
        current as unknown as Record<string, unknown>,
        updates as Partial<Record<string, unknown>>
      ) as unknown as AppSettings;
      await window.api.store.set('settings', updated);
      return updated;
    },
    onSuccess: (updated) => {
      // Update the cache immediately
      queryClient.setQueryData(['settings'], updated);
    },
  });
  const { mutateAsync, isPending } = updateMutation;

  // Add a repository to recent list
  const addRecentRepo = useCallback(
    async (repoPath: string) => {
      // Read the latest cached value to avoid race conditions
      const current = queryClient.getQueryData<AppSettings>(['settings']) || DEFAULT_SETTINGS;
      const currentRecents = current.recentRepositories || [];

      // Remove if already exists (to move to top)
      const filtered = currentRecents.filter((p) => p !== repoPath);

      // Add to beginning, limit to max
      const updated = [repoPath, ...filtered].slice(0, MAX_RECENT_REPOS);

      await mutateAsync({ recentRepositories: updated });
    },
    [queryClient, mutateAsync]
  );

  // Remove a repository from recent list
  const removeRecentRepo = useCallback(
    async (repoPath: string) => {
      // Read the latest cached value to avoid race conditions
      const current = queryClient.getQueryData<AppSettings>(['settings']) || DEFAULT_SETTINGS;
      const updated = (current.recentRepositories || []).filter((p) => p !== repoPath);
      await mutateAsync({ recentRepositories: updated });
    },
    [queryClient, mutateAsync]
  );

  // Add a path to recent paths
  const addRecentPath = useCallback(
    async (path: string) => {
      const current = queryClient.getQueryData<AppSettings>(['settings']) || DEFAULT_SETTINGS;
      const currentPaths = current.recentPaths || [];
      const filtered = currentPaths.filter((p) => p !== path);
      const updated = [path, ...filtered].slice(0, MAX_RECENT_PATHS);
      await mutateAsync({ recentPaths: updated });
    },
    [queryClient, mutateAsync]
  );

  // Add a bookmark
  const addBookmark = useCallback(
    async (path: string, name: string) => {
      const current = queryClient.getQueryData<AppSettings>(['settings']) || DEFAULT_SETTINGS;
      const currentBookmarks = current.bookmarks || [];
      // Check if already bookmarked
      if (currentBookmarks.some((b) => b.path === path)) return;
      const newBookmark = { path, name, addedAt: Date.now() };
      const updated = [newBookmark, ...currentBookmarks].slice(0, MAX_BOOKMARKS);
      await mutateAsync({ bookmarks: updated });
    },
    [queryClient, mutateAsync]
  );

  // Remove a bookmark
  const removeBookmark = useCallback(
    async (path: string) => {
      const current = queryClient.getQueryData<AppSettings>(['settings']) || DEFAULT_SETTINGS;
      const updated = (current.bookmarks || []).filter((b) => b.path !== path);
      await mutateAsync({ bookmarks: updated });
    },
    [queryClient, mutateAsync]
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
