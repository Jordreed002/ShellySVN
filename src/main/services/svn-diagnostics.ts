import { existsSync, statSync } from 'fs';
import { isAbsolute, join } from 'path';
import { app } from 'electron';
import type { RepoDiagnostics } from '@shared/types';
import { getAuthCache } from '../auth-cache';
import { getSslTrustCache } from '../ssl-trust-cache';
import { getSettingsManager } from '../settings-manager';
import { parseSvnInfoXml } from '../svn/parsers';
import { debug } from '../utils/debug';
import { withSvnTargets } from '../utils/svn-targets';
import { runSvnMuccText, runSvnText } from './svn-executor';
import { getNetworkOptionsForUrl } from './svn-network-context';

const MINIMUM_SVN_VERSION = '1.14';
const ALLOWED_SSL_FAILURES = ['unknown-ca', 'cn-mismatch', 'expired', 'not-yet-valid'] as const;

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
    getFileStatus('bundled SVN client', join(resourceBasePath, 'svn', names.svn), resourceSource),
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

function parseTrustedSslFailures(errorText: string): string {
  const failures = new Set<(typeof ALLOWED_SSL_FAILURES)[number]>();
  if (errorText.match(/not issued by a trusted authority|issuer is not trusted/i)) {
    failures.add('unknown-ca');
  }
  if (errorText.match(/hostname does not match|certificate issued for a different hostname/i)) {
    failures.add('cn-mismatch');
  }
  if (errorText.match(/has expired|certificate.*expired/i)) {
    failures.add('expired');
  }
  if (errorText.match(/not yet valid/i)) {
    failures.add('not-yet-valid');
  }

  return failures.size > 0 ? Array.from(failures).join(',') : 'unknown-ca';
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

export async function trustServerCertificate(
  url: string,
  errorText: string
): Promise<{ success: boolean; error?: string }> {
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

  const trustedSslFailures = parseTrustedSslFailures(errorText);
  const authCache = getAuthCache();
  const credentialsMatch = authCache.findForUrl(trimmedUrl);
  const credentials = credentialsMatch
    ? { username: credentialsMatch.username, password: credentialsMatch.password }
    : undefined;

  try {
    await runSvnText(withSvnTargets(['info', '--xml', '--non-interactive'], [trimmedUrl]), {
      trustSslFailures: true,
      trustedSslFailures,
      credentials,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('SSL') || message.includes('certificate') || message.includes('E230001')) {
      return { success: false, error: message };
    }
    if (!isAuthenticationError(message)) {
      return { success: false, error: message };
    }
  }

  const cache = getSslTrustCache();
  await cache.ready();
  cache.set(trimmedUrl, trustedSslFailures);
  return { success: true };
}

export async function getDiagnostics(workingCopyPath: string): Promise<RepoDiagnostics> {
  const authCache = getAuthCache();
  const settingsManager = getSettingsManager();
  const svnClientPath = settingsManager.getSvnClientPath();

  const result: RepoDiagnostics = {
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

        if (
          errorMsg.includes('authentication') ||
          errorMsg.includes('Authorization') ||
          errorMsg.includes('403')
        ) {
          result.connectionStatus = 'auth-required';
          result.connectionError = 'Authentication required';
        } else if (errorMsg.includes('SSL') || errorMsg.includes('certificate')) {
          result.connectionStatus = 'ssl-error';
          result.connectionError = errorMsg;
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

  return result;
}

export async function getSvnCapabilities(): Promise<{
  shelving: boolean;
  nativeShelving: boolean;
  remoteProperties: boolean;
}> {
  const [shelving, remoteProperties] = await Promise.allSettled([
    runSvnText(['help', 'shelve']),
    runSvnMuccText(['--version', '--quiet']),
  ]);
  return {
    shelving: true,
    nativeShelving: shelving.status === 'fulfilled',
    remoteProperties: remoteProperties.status === 'fulfilled',
  };
}
