import type { RepoBrowserCredentials } from './-repoBrowserAuth';

export const REPO_BROWSER_LIST_STALE_TIME_MS = 60_000;

export function getRepoBrowserListQueryKey(
  url: string,
  revision: string,
  credentials: RepoBrowserCredentials | null
) {
  return [
    'repo-browser',
    url,
    revision,
    credentials
      ? {
          username: credentials.username,
          password: credentials.password,
        }
      : null,
  ] as const;
}
