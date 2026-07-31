import { useQuery } from '@tanstack/react-query';
import type { CodeEditorInfo } from '@shared/types';

import { useSettings } from './useSettings';

const NO_EDITORS: readonly CodeEditorInfo[] = [];

/**
 * Applications for the "Open in" menu: the editors ShellySVN found on `PATH`,
 * plus whatever the user added in Settings.
 *
 * Detection is a `PATH` scan in the main process, so it is cheap but not free:
 * held for the session rather than repeated per right-click. The user's own
 * entries are part of the query key, so editing that list in Settings refreshes
 * the menu straight away rather than after a restart.
 */
export function useCodeEditors(): readonly CodeEditorInfo[] {
  const { settings } = useSettings();
  const customFingerprint = (settings?.customOpenWithTools ?? [])
    .map((tool) => `${tool.id}:${tool.name}:${tool.command}:${tool.arguments ?? ''}:${tool.appliesTo ?? 'both'}`)
    .join('|');

  const { data } = useQuery({
    queryKey: ['external:editors', customFingerprint],
    queryFn: () => window.api.external.listEditors(),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  return data ?? NO_EDITORS;
}
