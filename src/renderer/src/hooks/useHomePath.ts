import { useEffect, useState } from 'react';

/**
 * Resolves the user's home location for "go home" affordances:
 * the home directory on macOS/Linux, Documents on Windows.
 *
 * Fetching it via app.getPath also approves the path for IPC, so the resulting
 * directory listing works. Returns '' until resolved.
 */
export function useHomePath(): string {
  const [homePath, setHomePath] = useState('');

  useEffect(() => {
    const isWindows = navigator.platform.toLowerCase().startsWith('win');
    let cancelled = false;
    window.api.app
      .getPath(isWindows ? 'documents' : 'home')
      .then((p) => {
        if (!cancelled && p) setHomePath(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return homePath;
}
