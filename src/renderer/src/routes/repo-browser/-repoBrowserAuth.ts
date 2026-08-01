export interface RepoBrowserCredentials {
  id: string;
  username: string;
}

export interface RepoBrowserAuthApi {
  resumeSession(realm: string): Promise<RepoBrowserCredentials | null>;
}

export function getRepoBrowserRealm(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol && parsed.host) {
      return `${parsed.protocol}//${parsed.host}`;
    }
  } catch {
    // Fall back to the full URL for incomplete or non-standard inputs.
  }
  return url;
}

export async function loadRepoBrowserCredentials(
  repoUrl: string,
  authApi: RepoBrowserAuthApi
): Promise<{ realm: string; credentials: RepoBrowserCredentials | null }> {
  const realm = getRepoBrowserRealm(repoUrl);

  try {
    const storedCredentials = await authApi.resumeSession(realm);
    return {
      realm,
      credentials: storedCredentials,
    };
  } catch {
    return { realm, credentials: null };
  }
}

export function isRepoBrowserAuthError(error: unknown): boolean {
  const message = (error as Error)?.message || '';
  return (
    message.includes('credentials') ||
    message.includes('Authentication') ||
    message.includes('authorization') ||
    message.includes('E215004')
  );
}
