import { getAuthCache } from '../auth-cache';
import {
  getSslTrustCache,
  type SslTrustDecisionEntry,
  type SslFailureKind,
} from '../ssl-trust-cache';
import { debug } from '../utils/debug';
import { getWorkingCopyContext } from './svn-working-copy';

// Pure spawn-config builder (proxy + client certificate). Lives in
// `utils/svn-spawn-network-config` because `svn-runner` — which is bundled
// into worker threads — imports it without Electron; re-exported here so
// main-process callers keep a single service-facing entry point.
export {
  buildSvnSpawnNetworkConfig,
  type SvnSpawnNetworkConfig,
  type SvnSpawnNetworkConfigInput,
} from '../utils/svn-spawn-network-config';

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

export async function getCachedTrustedSslFailuresForUrl(url: string): Promise<string | undefined> {
  if (!/^https:\/\//i.test(url)) return undefined;
  try {
    const cache = getSslTrustCache();
    await cache.ready();
    return cache.findForUrl(url)?.failures;
  } catch (error) {
    debug.warn('[SSL] Failed to look up cached SSL trust for URL:', error);
    return undefined;
  }
}

/**
 * Full trust-decision state for a URL (backlog item #38): a cached rejection
 * must fail fast with the typed failure instead of re-prompting, while a
 * cached acceptance short-circuits the prompt entirely.
 */
export async function getSslTrustDecisionForUrl(
  url: string
): Promise<SslTrustDecisionEntry | null> {
  if (!/^https:\/\//i.test(url)) return null;
  try {
    const cache = getSslTrustCache();
    await cache.ready();
    return cache.findDecisionForUrl(url);
  } catch (error) {
    debug.warn('[SSL] Failed to look up SSL trust decision for URL:', error);
    return null;
  }
}

export type { SslFailureKind, SslTrustDecisionEntry };

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
