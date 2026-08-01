import { useEffect, useState } from 'react';

/**
 * Resolves the user's home location for "go home" affordances:
 * the home directory on macOS/Linux, Documents on Windows.
 *
 * Home-directory access is no longer granted implicitly. Users enter the
 * filesystem through a native directory picker, so this legacy shortcut stays
 * hidden until it is replaced by an explicitly authorized location.
 */
export function useHomePath(): string {
  const [homePath, setHomePath] = useState('');

  useEffect(() => setHomePath(''), []);

  return homePath;
}
