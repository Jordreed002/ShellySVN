import { describe, expect, it } from 'vitest';

import { redactDiagnosticText } from '../redaction';

/**
 * Anything an end user copies out of the ErrorBoundary / diagnostics view and
 * pastes into a bug report must not carry secrets. `redactDiagnosticText` is the
 * last line of defense, so each redaction class needs a pinned test.
 */
describe('redactDiagnosticText', () => {
  it('leaves non-sensitive diagnostic text untouched', () => {
    expect(redactDiagnosticText('svn: E155007 not a working copy, revision 42')).toBe(
      'svn: E155007 not a working copy, revision 42'
    );
  });

  it('redacts credentials embedded in a URL', () => {
    expect(redactDiagnosticText('svn: E170013 https://alice:hunter2@host.example.com/repo')).toBe(
      'svn: E170013 https://[REDACTED]:[REDACTED]@host.example.com/repo'
    );
  });

  it('redacts key=value style secrets and then the key word itself', () => {
    // Step 1 replaces the value; the broad secret-key pass then also masks the
    // bare key token, so neither the word nor the value survives.
    expect(redactDiagnosticText('password=secret')).toBe('[REDACTED]=[REDACTED]');
    expect(redactDiagnosticText('token=abc123')).toBe('[REDACTED]=[REDACTED]');
  });

  it('redacts bare secret-key words anywhere in the text', () => {
    expect(redactDiagnosticText('the authorization header was missing')).toBe(
      'the [REDACTED] header was missing'
    );
  });

  it('redacts POSIX home directory paths', () => {
    expect(redactDiagnosticText('failed to read /Users/jordan/dev/repo/.svn')).toBe(
      'failed to read /Users/[REDACTED]/dev/repo/.svn'
    );
    // /home paths are normalized to the /Users form by the same replacement.
    expect(redactDiagnosticText('home is /home/bob/project')).toBe(
      'home is /Users/[REDACTED]/project'
    );
  });

  it('redacts Windows home directory paths', () => {
    expect(redactDiagnosticText(String.raw`path C:\Users\Bob\project\src`)).toBe(
      String.raw`path C:\Users\[REDACTED]\project\src`
    );
  });

  it('handles a mixed real-world diagnostic string', () => {
    const input =
      'Error fetching https://alice:s3cr3t@svn.example.com/repo in /Users/alice/repo (authorization=abc)';
    const out = redactDiagnosticText(input);

    expect(out).not.toContain('s3cr3t');
    expect(out).not.toContain('alice'); // both URL user and home path
    expect(out).not.toContain('abc');
    expect(out).toContain('[REDACTED]');
  });
});
