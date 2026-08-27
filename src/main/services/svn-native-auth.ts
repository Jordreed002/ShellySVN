import type { SvnCredentialVerifyResult, SvnNativeAuthEntry } from '@shared/types';
import { runSvnText } from './svn-executor';

/** Upper bounds keeping the probe inputs from turning into oversized argv blobs. */
const MAX_URL_LENGTH = 2048;
const MAX_USERNAME_LENGTH = 512;
const MAX_PASSWORD_LENGTH = 16_384;

/**
 * Classify an SVN failure excerpt for the credential-verification probe so the
 * settings UI can explain *why* saved credentials did not work (bad password
 * vs unreachable server vs certificate distrust) without dumping raw stderr.
 */
export function classifySvnAuthFailure(text: string): SvnCredentialVerifyResult['reason'] {
  if (/\bE170001\b|\bE215007\b|authorization failed|authentication failed|not authorized|password for/i.test(text)) {
    return 'auth';
  }
  if (/certificate|\bSSL\b|secure connection|E230001/i.test(text)) {
    return 'ssl';
  }
  if (
    /timed? ?out|unable to connect|connection refused|could not resolve|unreachable|\bE730060\b|\bE170013\b|\bE175013\b|\bE175002\b/i.test(
      text
    )
  ) {
    return 'network';
  }
  return 'unknown';
}

function validatePatterns(patterns: string[]): void {
  for (const pattern of patterns) {
    if (!pattern.trim()) throw new Error('Authentication pattern must not be empty');
    if (/\p{Cc}/u.test(pattern))
      throw new Error('Authentication pattern contains control characters');
    if (pattern.startsWith('-'))
      throw new Error('Authentication pattern must not begin with an option prefix');
  }
}

export function parseNativeAuthList(output: string): SvnNativeAuthEntry[] {
  const entries: SvnNativeAuthEntry[] = [];
  let current: Partial<SvnNativeAuthEntry> = {};
  const flush = () => {
    if (current.kind || current.realm) {
      entries.push({
        kind: current.kind || 'unknown',
        realm: current.realm || 'unknown',
        ...(current.username ? { username: current.username } : {}),
        ...(current.certificate ? { certificate: current.certificate } : {}),
      });
    }
    current = {};
  };
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'credential kind') current.kind = value;
    else if (key === 'authentication realm') current.realm = value;
    else if (key === 'username') current.username = value;
    else if (key.includes('certificate') && !key.includes('passphrase'))
      current.certificate = value;
  }
  flush();
  return entries;
}

export async function listNativeAuth(patterns: string[] = []): Promise<SvnNativeAuthEntry[]> {
  validatePatterns(patterns);
  // Deliberately omit --show-passwords: secrets must never enter process output or IPC.
  return parseNativeAuthList(await runSvnText(['auth', ...patterns]));
}

export async function removeNativeAuth(
  patterns: string[]
): Promise<{ success: boolean; output?: string }> {
  validatePatterns(patterns);
  if (patterns.length === 0) throw new Error('At least one authentication pattern is required');
  const output = await runSvnText(['auth', '--remove', ...patterns]);
  return { success: true, output };
}

/**
 * Probe a repository URL with explicit credentials via `svn info`, so the
 * settings UI can confirm a freshly entered username/password pair actually
 * authenticates before the user relies on it for a commit. Credentials are
 * passed through the executor's credential channel (never persisted here),
 * and any failure text is scrubbed of the password before it reaches IPC.
 */
export async function verifyRepositoryCredentials(
  url: string,
  username: string,
  password: string
): Promise<SvnCredentialVerifyResult> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) throw new Error('Repository URL is required');
  if (trimmedUrl.length > MAX_URL_LENGTH || /\p{Cc}/u.test(trimmedUrl)) {
    throw new Error('Invalid repository URL');
  }
  if (!username.trim() || username.trim().length > MAX_USERNAME_LENGTH || /\p{Cc}/u.test(username)) {
    throw new Error('Invalid username');
  }
  if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error('Invalid password');
  }

  try {
    await runSvnText(['info', '--non-interactive', trimmedUrl], {
      credentials: { username, password },
    });
    return { ok: true };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error ?? '');
    const sanitized =
      password.length > 0 && rawMessage.includes(password)
        ? rawMessage.replaceAll(password, '••••••')
        : rawMessage;
    const excerpt = sanitized.length > 500 ? `${sanitized.slice(0, 500)}…` : sanitized;
    return {
      ok: false,
      reason: classifySvnAuthFailure(sanitized),
      message: excerpt,
    };
  }
}
