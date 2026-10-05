import { useQuery } from '@tanstack/react-query';
import { appHomePath } from '@renderer/lib/queryKeys';

/**
 * Resolves the user's home location for "go home" affordances:
 * the home directory on macOS/Linux, Documents on Windows.
 *
 * The main process returns and authorizes only the operating-system home path.
 * React Query deduplicates the Sidebar and File Explorer requests.
 */
export function useHomePath(): string {
  const { data } = useQuery({
    queryKey: appHomePath(),
    queryFn: () => window.api.app.getHomePath(),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  return data ?? '';
}
