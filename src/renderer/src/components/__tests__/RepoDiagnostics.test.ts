import { describe, expect, it } from 'vitest';
import type { RepoDiagnostics } from '@shared/types';
import { buildDiagnosticsReport } from '../RepoDiagnostics';

function diagnostics(overrides: Partial<RepoDiagnostics> = {}): RepoDiagnostics {
  return {
    svnClientPath: 'C:\\Users\\alice\\bin\\svn.exe',
    svnVersion: '1.14.2',
    minimumSvnVersion: '1.14',
    svnVersionSupported: true,
    encryptionAvailable: true,
    isPackaged: false,
    resourcesPath: 'C:\\Users\\alice\\AppData\\Local\\ShellySVN',
    resourceStatus: [],
    isValidWorkingCopy: true,
    workingCopyRoot: 'C:\\Users\\alice\\work\\repo',
    repositoryRoot: 'https://alice:secret@example.test/svn/repo?token=abc123',
    repositoryUrl: 'https://alice:secret@example.test/svn/repo/trunk?token=abc123',
    repositoryUuid: 'uuid',
    hasCredentials: true,
    credentialRealm: 'https://example.test/svn/repo',
    credentialUsername: 'alice',
    connectionStatus: 'ok',
    ...overrides,
  };
}

describe('buildDiagnosticsReport', () => {
  it('redacts support-export credentials, tokens, and local usernames', () => {
    const report = buildDiagnosticsReport(
      diagnostics({
        connectionError: 'authorization token=abc123 password=hunter2',
      }),
      'C:\\Users\\alice\\work\\repo'
    );

    expect(report).not.toContain('hunter2');
    expect(report).not.toContain('abc123');
    expect(report).not.toContain('alice');
    expect(report).toContain('[REDACTED]');
    expect(report).toContain('svnVersionSupported');
  });
});
