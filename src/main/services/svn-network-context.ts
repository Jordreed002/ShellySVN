import { getAuthCache } from '../auth-cache';
import { getSslTrustCache } from '../ssl-trust-cache';
import { debug } from '../utils/debug';
import { getWorkingCopyContext } from './svn-working-copy';

export interface SvnCachedCredentials {
  username: string;
  password: string;
}

export interface SvnNetworkOptions {
  credentials?: SvnCachedCredentials;
  trustSslFailures: boolean;
  trustedSslFailures?: string;
}

export async function getCachedCredentialsForUrl(
  url: string
): Promise<SvnCachedCredentials | undefined> {
  try {
    const cache = getAuthCache();
    await cache.ready();
    const match = cache.findForUrl(url);
    return match ? { username: match.username, password: match.password } : undefined;
  } catch (error) {
    debug.warn('[SVN] Failed to look up cached credentials for URL:', error);
    return undefined;
  }
}

export async function getCachedTrustedSslFailuresForUrl(
  url: string
): Promise<string | undefined> {
  try {
    const cache = getSslTrustCache();
    await cache.ready();
    return cache.findForUrl(url)?.failures;
  } catch (error) {
    debug.warn('[SSL] Failed to look up cached SSL trust for URL:', error);
    return undefined;
  }
}

export async function getNetworkOptionsForUrl(url: string): Promise<SvnNetworkOptions> {
  const [credentials, trustedSslFailures] = await Promise.all([
    getCachedCredentialsForUrl(url),
    getCachedTrustedSslFailuresForUrl(url),
  ]);

  return {
    credentials,
    trustSslFailures: trustedSslFailures !== undefined,
    trustedSslFailures,
  };
}

export async function getNetworkOptionsForWorkingCopyPath(
  path: string
): Promise<SvnNetworkOptions> {
  try {
    const context = await getWorkingCopyContext(path);
    if (!context?.url) {
      return { trustSslFailures: false };
    }
    return getNetworkOptionsForUrl(context.url);
  } catch (error) {
    debug.warn('[SVN] Failed to resolve network options for working copy path:', error);
    return { trustSslFailures: false };
  }
}
