import type { AuthSession } from '@shared/types';

type SvnListScope = 'online' | 'remote';

export function getAuthPresenceKey(
  credentials: AuthSession | null | undefined
): 'stored' | 'anonymous' {
  return credentials ? 'stored' : 'anonymous';
}

export function createSvnListQueryKey(
  scope: SvnListScope,
  url: string,
  authPresenceKey: ReturnType<typeof getAuthPresenceKey>
) {
  return [`svn:list:${scope}`, url, authPresenceKey] as const;
}
