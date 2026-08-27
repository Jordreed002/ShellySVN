import { existsSync, statSync } from 'fs';
import { isAbsolute, join } from 'path';
import { app } from 'electron';
import type {
  NetworkSecurityDiagnostics,
  RepoDiagnostics,
  SvnExecutionContext,
} from '@shared/types';
import { getAuthCache } from '../auth-cache';
import {
  getSslTrustCache,
  parseSslCertFailure,
  trustableFailureKinds,
  type SslCertFailureInfo,
  type SslFailureKind,
  type SslTrustCache as SslTrustCacheInstance,
} from '../ssl-trust-cache';
import { getSettingsManager } from '../settings-manager';
import { parseSvnInfoXml } from '../svn/parsers';
import { debug } from '../utils/debug';
import { redactValue } from '../utils/redaction';
import { withSvnTargets } from '../utils/svn-targets';
import { runSvnMuccText, runSvnText } from './svn-executor';
import { isNativeShelvingSupported } from './svn-capabilities';
import {
  buildSvnSpawnNetworkConfig,
  getNetworkOptionsForUrl,
  type SvnSpawnNetworkConfig,
} from './svn-network-context';
import { getAuthSessionStats } from './auth-session-manager';

const MINIMUM_SVN_VERSION = '1.14';

function getCurrentBinaryTarget(): string {
  return `${process.platform}-${process.arch}`;
}

function getBinaryNames(): { engine: string; svn: string } {
  const executableExtension = process.platform === 'win32' ? '.exe' : '';
  return {
    engine: `shelly-engine${executableExtension}`,
    svn: `svn${executableExtension}`,
  };
}

function getFileStatus(
  name: string,
  filePath: string,
  source: RepoDiagnostics['resourceStatus'][number]['source']
): RepoDiagnostics['resourceStatus'][number] {
  try {
    if (!existsSync(filePath)) {
      return { name, path: filePath, source, exists: false, isFile: false };
    }

    const stats = statSync(filePath);
    return {
      name,
      path: filePath,
      source,
      exists: true,
      isFile: stats.isFile(),
      sizeBytes: stats.size,
    };
  } catch (error) {
    return {
      name,
      path: filePath,
      source,
      exists: false,
      isFile: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getDiagnosticResourceStatus(svnClientPath: string): RepoDiagnostics['resourceStatus'] {
  const names = getBinaryNames();
  const resourceBasePath = app.isPackaged
    ? join(process.resourcesPath, 'binaries')
    : join(process.cwd(), 'binaries', getCurrentBinaryTarget());

  const resourceSource = app.isPackaged ? 'packaged-resource' : 'workspace-resource';
  const statuses: RepoDiagnostics['resourceStatus'] = [
    getFileStatus('logic engine', join(resourceBasePath, names.engine), resourceSource),
    getFileStatus('bundled SVN client', join(resourceBasePath, names.svn), resourceSource),
  ];

  if (isAbsolute(svnClientPath)) {
    statuses.unshift(getFileStatus('configured SVN client', svnClientPath, 'configured-client'));
  }

  return statuses;
}

function isSvnVersionSupported(version: string | null): boolean | null {
  if (!version) return null;
  const match = version.match(/^(\d+)\.(\d+)/);
  if (!match) return null;

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  return major > 1 || (major === 1 && minor >= 14);
}

function isAuthenticationError(errorText: string): boolean {
  return (
    errorText.includes('authentication') ||
    errorText.includes('Authentication') ||
    errorText.includes('Authorization') ||
    errorText.includes('authorization') ||
    errorText.includes('403')
  );
}

// ---------------------------------------------------------------------------
// Network security diagnostics (backlog items #37 / #38)
// ---------------------------------------------------------------------------
//
// The NetworkSecuritySslFailure / NetworkSecurityDiagnostics shapes live in
// @shared/types (they cross IPC on RepoDiagnostics); re-exported here for
// compatibility with existing main-process imports.

export type { NetworkSecurityDiagnostics, NetworkSecuritySslFailure } from '@shared/types';

export type RepoDiagnosticsWithNetworkSecurity = RepoDiagnostics & {
  networkSecurity: NetworkSecurityDiagnostics;
};

async function buildNetworkSecurityDiagnostics(input: {
  context: SvnExecutionContext | null;
  repositoryRoot: string | null;
  sslFailureRaw: string | undefined;
}): Promise<NetworkSecurityDiagnostics> {
  const { context, repositoryRoot, sslFailureRaw } = input;
  const proxy = context?.proxySettings ?? null;
  const clientCertificatePath = context?.clientCertificatePath?.trim() || null;

  // Reuse the canonical spawn-config builder so "active" means "these
  // settings would actually reach spawned svn processes". Malformed values
  // (e.g. control characters) report as inactive instead of throwing.
  let spawnConfig: SvnSpawnNetworkConfig | null = null;
  try {
    spawnConfig = buildSvnSpawnNetworkConfig({
      proxySettings: proxy,
      clientCertificatePath,
    });
  } catch (error) {
    debug.warn('[diagnostics] Invalid proxy/client-certificate settings:', error);
  }

  let cache: SslTrustCacheInstance | null = null;
  try {
    cache = getSslTrustCache();
    await cache.ready();
  } catch (error) {
    debug.warn('[diagnostics] SSL trust cache unavailable:', error);
  }

  const ssl: NetworkSecurityDiagnostics['ssl'] = {
    verificationEnabled: context?.sslVerify !== false,
    trustedOrigins: cache ? cache.listTrustedOrigins() : [],
  };

  if (sslFailureRaw && repositoryRoot) {
    const failure = parseSslCertFailure(sslFailureRaw, repositoryRoot);
    if (failure) {
      const decision = cache?.findDecisionForUrl(repositoryRoot) ?? null;
      ssl.failure = {
        failureKind: failure.failureKind,
        failureKinds: failure.failureKinds,
        host: failure.host,
        ...(failure.fingerprint ? { fingerprint: failure.fingerprint } : {}),
        ...(failure.validUntil ? { validUntil: failure.validUntil } : {}),
        rawMessage: redactValue(failure.rawMessage) as string,
        trustState: decision ? decision.decision : 'untrusted',
        promptEligible:
          decision?.decision !== 'rejected' && !(cache?.hasPrompted(failure) ?? false),
      };
    }
  }

  return {
    proxy: {
      active: spawnConfig?.proxyActive ?? false,
      host: proxy?.host ? proxy.host : null,
      port:
        typeof proxy?.port === 'number' && proxy.port > 0 && proxy.port <= 65535
          ? proxy.port
          : null,
      authenticated: Boolean(proxy?.enabled && proxy?.username && proxy?.password),
      bypassesLocalAddresses: Boolean(proxy?.bypassForLocal),
    },
    clientCertificate: {
      configured: spawnConfig?.clientCertificateActive ?? false,
      path: clientCertificatePath,
    },
    ssl,
    authSessions: getAuthSessionStats(),
  };
}

// ---------------------------------------------------------------------------
// Certificate trust flow (backlog item #38)
// ---------------------------------------------------------------------------

export interface SslTrustOutcome {
  success: boolean;
  error?: string;
  failureKind?: SslFailureKind;
}

/**
 * Explicit, user-initiated trust of a server certificate. Prompts are
 * user-driven (renderer button); this records the outcome so:
 * - a cached acceptance short-circuits future prompts,
 * - a cached rejection fails fast here (no svn re-run, no retry loop),
 * - a verification that still fails on certificate grounds records a
 *   rejection, stopping click-retry loops,
 * - authentication failures after a successful trust still cache the trust
 *   (the certificate itself was accepted).
 */
export async function trustServerCertificate(
  url: string,
  errorText: string
): Promise<SslTrustOutcome> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return { success: false, error: 'Repository URL is required.' };
  }
  if (!/^https:\/\//i.test(trimmedUrl)) {
    return {
      success: false,
      error: 'Server-certificate trust is only available for HTTPS repository URLs.',
    };
  }

  // Classification first: an unclassifiable failure is never trusted (the
  // previous behavior defaulted to 'unknown-ca', over-trusting e.g. revoked
  // or handshake failures).
  const failure = parseSslCertFailure(errorText, trimmedUrl);
  if (!failure) {
    return {
      success: false,
      error: 'Unable to classify the certificate failure; refusing to trust it.',
    };
  }

  const cache = getSslTrustCache();
  await cache.ready();
  cache.markPrompted(failure);

  const existingDecision = cache.findDecisionForUrl(trimmedUrl);
  if (existingDecision?.decision === 'rejected') {
    return {
      success: false,
      error: `Server certificate for ${failure.host} was previously rejected (${
        existingDecision.failureKind ?? failure.failureKind
      }); trust was not re-attempted.`,
      failureKind: existingDecision.failureKind ?? failure.failureKind,
    };
  }

  const trustable = trustableFailureKinds(failure.failureKinds);
  if (trustable.length === 0) {
    // e.g. a revoked certificate: svn classifies it outside the four
    // trustable kinds, and it must never receive a blanket trust.
    return {
      success: false,
      error: `Certificate failure (${failure.failureKind}) cannot be trusted safely.`,
      failureKind: failure.failureKind,
    };
  }

  const authCache = getAuthCache();
  const credentialsMatch = authCache.findForUrl(trimmedUrl);
  const credentials = credentialsMatch
    ? { username: credentialsMatch.username, password: credentialsMatch.password }
    : undefined;

  try {
    await runSvnText(withSvnTargets(['info', '--xml', '--non-interactive'], [trimmedUrl]), {
      trustSslFailures: true,
      trustedSslFailures: trustable.join(','),
      credentials,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (parseSslCertFailure(message)) {
      // Verification still fails on certificate grounds — the classified
      // failures did not cover everything. Record a rejection so neither the
      // renderer nor a future call silently retries the same broken trust.
      cache.recordDecision(trimmedUrl, failure, 'rejected');
      return { success: false, error: message, failureKind: failure.failureKind };
    }
    if (!isAuthenticationError(message)) {
      return { success: false, error: message, failureKind: failure.failureKind };
    }
    // Authentication failed, but the certificate was accepted: fall through
    // and persist the trust.
  }

  cache.recordDecision(trimmedUrl, failure, 'accepted');
  return { success: true, failureKind: failure.failureKind };
}

/**
 * Explicit user rejection of a server certificate (renderer "don't trust"
 * action): records the decision so subsequent commands fail fast with the
 * typed failure and the prompt is not offered again for the same
 * (host, fingerprint, failureKind).
 */
export async function rejectServerCertificate(
  url: string,
  errorText: string
): Promise<SslTrustOutcome> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return { success: false, error: 'Repository URL is required.' };
  }
  if (!/^https:\/\//i.test(trimmedUrl)) {
    return {
      success: false,
      error: 'Server-certificate trust is only available for HTTPS repository URLs.',
    };
  }

  const failure = parseSslCertFailure(errorText, trimmedUrl);
  if (!failure) {
    return {
      success: false,
      error: 'Unable to classify the certificate failure; refusing to record a decision.',
    };
  }

  const cache = getSslTrustCache();
  await cache.ready();
  cache.markPrompted(failure);
  cache.recordDecision(trimmedUrl, failure, 'rejected');
  return { success: true, failureKind: failure.failureKind };
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export async function getDiagnostics(
  workingCopyPath: string
): Promise<RepoDiagnosticsWithNetworkSecurity> {
  const authCache = getAuthCache();
  const settingsManager = getSettingsManager();
  const svnClientPath = settingsManager.getSvnClientPath();

  let svnContext: SvnExecutionContext | null = null;
  try {
    svnContext = settingsManager.getSvnExecutionContext();
  } catch (error) {
    debug.warn('[diagnostics] Failed to read SVN execution context:', error);
  }

  const result: RepoDiagnosticsWithNetworkSecurity = {
    svnClientPath,
    svnVersion: null,
    svnVersionError: undefined,
    minimumSvnVersion: MINIMUM_SVN_VERSION,
    svnVersionSupported: null,
    svnVersionWarning: undefined,
    encryptionAvailable: authCache.isEncryptionAvailable(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath || null,
    resourceStatus: getDiagnosticResourceStatus(svnClientPath),
    isValidWorkingCopy: false,
    workingCopyRoot: null,
    repositoryRoot: null,
    repositoryUrl: null,
    repositoryUuid: null,
    hasCredentials: false,
    credentialRealm: null,
    credentialUsername: null,
    connectionStatus: 'unknown',
    connectionError: undefined,
    networkSecurity: {
      proxy: {
        active: false,
        host: null,
        port: null,
        authenticated: false,
        bypassesLocalAddresses: false,
      },
      clientCertificate: { configured: false, path: null },
      ssl: { verificationEnabled: true, trustedOrigins: [] },
      authSessions: { active: 0, persistent: 0 },
    },
  };

  try {
    result.svnVersion = (await runSvnText(['--version', '--quiet'])).trim() || null;
    result.svnVersionSupported = isSvnVersionSupported(result.svnVersion);
    if (result.svnVersionSupported === false) {
      result.svnVersionWarning = `SVN ${MINIMUM_SVN_VERSION}.x or newer is required for advanced workflows.`;
    }
  } catch (error) {
    result.svnVersionError = error instanceof Error ? error.message : String(error);
    debug.error('[diagnostics] Failed to get SVN version:', result.svnVersionError);
  }

  let sslFailureRaw: string | undefined;
  try {
    const infoOutput = await runSvnText(['info', '--xml'], { cwd: workingCopyPath });
    const info = parseSvnInfoXml(infoOutput);

    result.isValidWorkingCopy = true;
    result.workingCopyRoot = info.workingCopyRoot || workingCopyPath;
    result.repositoryRoot = info.repositoryRoot;
    result.repositoryUrl = info.url;
    result.repositoryUuid = info.repositoryUuid;

    if (result.repositoryRoot) {
      const credentialMatch = authCache.findForUrl(result.repositoryRoot);
      if (credentialMatch) {
        result.hasCredentials = true;
        result.credentialRealm = credentialMatch.realm;
        result.credentialUsername = credentialMatch.username;
      }

      try {
        await runSvnText(withSvnTargets(['list', '--xml'], [result.repositoryRoot]), {
          ...(await getNetworkOptionsForUrl(result.repositoryRoot)),
        });
        result.connectionStatus = 'ok';
      } catch (connError) {
        const errorMsg = (connError as Error)?.message || '';

        // Case-insensitive: svn reports "Authentication failed" with a
        // capital A, which a lowercase `includes('authentication')` missed
        // and mislabeled as an unknown failure.
        if (
          /auth/i.test(errorMsg) ||
          errorMsg.includes('Authorization') ||
          errorMsg.includes('403')
        ) {
          result.connectionStatus = 'auth-required';
          // Keep the secret in the main process. Length and edge-whitespace
          // metadata are sufficient to diagnose common storage mistakes.
          const edgeWhitespace = /^\s|\s$/.test(credentialMatch?.password ?? '');
          const attemptedDetails = credentialMatch
            ? [
                'Attempted with the saved credential:',
                `  username: ${credentialMatch.username}`,
                `  password: [hidden] (${credentialMatch.password.length} characters${edgeWhitespace ? ' — has leading/trailing whitespace' : ''})`,
              ].join('\n')
            : 'Attempted without saved credentials (Subversion falls back to its own client cache).';

          if (credentialMatch) {
            // The probe (and every repository operation) injects the stored
            // credential explicitly, which suppresses Subversion's own client
            // cache — a rejected stored password is therefore actionable.
            result.connectionError =
              `The stored credential for ${credentialMatch.username} was rejected by the server. ` +
              'Remove or update it in Settings → Security → Saved credentials — with no saved ' +
              'credential, Subversion falls back to its own client cache (the login TortoiseSVN uses). ' +
              `Server response: ${errorMsg}`;
          } else {
            result.connectionError = `Authentication required. Server response: ${errorMsg}`;
          }
          result.connectionError = `${result.connectionError}\n\n${attemptedDetails}`;
        } else if (errorMsg.includes('SSL') || errorMsg.includes('certificate')) {
          result.connectionStatus = 'ssl-error';
          result.connectionError = errorMsg;
          sslFailureRaw = errorMsg;
        } else if (
          errorMsg.includes('ECONNREFUSED') ||
          errorMsg.includes('ENOTFOUND') ||
          errorMsg.includes('network')
        ) {
          result.connectionStatus = 'network-error';
          result.connectionError = 'Unable to connect to server';
        } else {
          result.connectionStatus = 'unknown';
          result.connectionError = errorMsg;
        }
      }
    }
  } catch (error) {
    const errorMsg = (error as Error)?.message || '';
    debug.error('[diagnostics] Failed to get working copy info:', errorMsg);

    result.isValidWorkingCopy = false;
    result.connectionStatus = 'unknown';
    result.connectionError =
      errorMsg.includes('not a working copy') || errorMsg.includes('E155007')
        ? 'Not a valid SVN working copy'
        : errorMsg;
  }

  result.networkSecurity = await buildNetworkSecurityDiagnostics({
    context: svnContext,
    repositoryRoot: result.repositoryRoot,
    sslFailureRaw,
  });

  return result;
}

export async function getSvnCapabilities(): Promise<{
  shelving: boolean;
  nativeShelving: boolean;
  remoteProperties: boolean;
}> {
  // `isNativeShelvingSupported` recognizes every client-specific way of
  // missing shelving (including TortoiseSVN's option-before-subcommand
  // "invalid option" failure), while svnmucc is probed directly.
  const [shelving, remoteProperties] = await Promise.allSettled([
    isNativeShelvingSupported(),
    runSvnMuccText(['--version', '--quiet']),
  ]);
  return {
    shelving: true,
    nativeShelving: shelving.status === 'fulfilled' && shelving.value,
    remoteProperties: remoteProperties.status === 'fulfilled',
  };
}

export type { SslCertFailureInfo, SslFailureKind };
