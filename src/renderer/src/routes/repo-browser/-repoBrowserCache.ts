import type { RepoBrowserCredentials } from './-repoBrowserAuth';

export const REPO_BROWSER_LIST_STALE_TIME_MS = 60_000;

const credentialSessions = new WeakMap<RepoBrowserCredentials, number>();
let nextCredentialSession = 1;

function getCredentialSession(credentials: RepoBrowserCredentials): number {
  const existing = credentialSessions.get(credentials);
  if (existing !== undefined) return existing;

  const session = nextCredentialSession++;
  credentialSessions.set(credentials, session);
  return session;
}

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
          session: getCredentialSession(credentials),
        }
      : null,
  ] as const;
}
