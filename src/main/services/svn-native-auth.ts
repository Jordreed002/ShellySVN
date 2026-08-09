import type { SvnNativeAuthEntry } from '@shared/types';
import { runSvnText } from './svn-executor';

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
