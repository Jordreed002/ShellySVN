import { describe, expect, it } from 'vitest';
import {
  AI_CONSENT_STORE_KEY,
  assertAiConsentForPath,
  findConsentForPath,
  guardOutboundPrompt,
  scanOutboundPrompt,
  setAiConsentReaderForTests,
} from '../ai-privacy-scanner';

describe('outbound prompt secret scanner', () => {
  it('blocks AWS access keys, GitHub tokens, private keys, and JWTs', () => {
    const jwt = `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.${'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV'.slice(0, 20)}adQssw5c`;
    for (const [kind, sample] of [
      ['aws-access-key', 'aws_key_id = AKIAIOSFODNN7EXAMPLE'],
      ['github-token', 'token: ghp_16C7e42F292c6912E7710c838347Ae178B4a'],
      ['private-key', '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----'],
      ['jwt', `id_token = ${jwt}`],
    ] as const) {
      const outcome = scanOutboundPrompt(`Index: a\n+${sample}\n`);
      expect(outcome.blocked).toBe(true);
      expect(outcome.findings.some((finding) => finding.kind === kind)).toBe(true);
      expect(outcome.findings.map((f) => f.excerpt).join(' ')).not.toContain('AKIAIOSFODNN7EXAMPLE');
    }
  });

  it('redacts secret-named assignments instead of blocking them', () => {
    const outcome = scanOutboundPrompt('+DATABASE_URL=postgres://host/db\n+API_TOKEN="abcdef1234567890"\n');
    expect(outcome.blocked).toBe(false);
    expect(outcome.redacted).toBe(true);
    expect(outcome.text).not.toContain('abcdef1234567890');
    expect(outcome.text).toContain('[REDACTED]');
  });

  it('redacts generic high-entropy assignments but keeps hashes and numbers', () => {
    const highEntropy = 'hK7#zP2@vQ9!mX4$wL1&';
    const sha256 = 'a'.repeat(64);
    const outcome = scanOutboundPrompt(`+SESSION_KEY=${highEntropy}\n+CONTENT_HASH=${sha256}\n+PORT=5432\n`);
    expect(outcome.blocked).toBe(false);
    expect(outcome.text).not.toContain(highEntropy);
    expect(outcome.text).toContain(sha256);
    expect(outcome.text).toContain('PORT=5432');
  });

  it('guardOutboundPrompt throws a typed secret_detected error before any provider call', () => {
    expect(() => guardOutboundPrompt('review this: AKIAIOSFODNN7EXAMPLE')).toThrow(
      /\[secret_detected\].*aws-access-key/
    );
  });

  it('passes clean diffs through unchanged', () => {
    const clean = 'Index: src/app.ts\n+const ready = true;\n';
    const outcome = guardOutboundPrompt(clean);
    expect(outcome.blocked).toBe(false);
    expect(outcome.text).toBe(clean);
    expect(outcome.findings).toEqual([]);
  });
});

describe('per-working-copy consent gate', () => {
  it('refuses disabled working copies with a typed consent_required error', async () => {
    setAiConsentReaderForTests(async () => ({
      '/repo': { aiEnabled: false, updatedAt: '2026-01-01T00:00:00.000Z' },
    }));
    try {
      await expect(assertAiConsentForPath('/repo')).rejects.toThrow(
        /\[consent_required\]/
      );
      await expect(assertAiConsentForPath('/repo/src')).rejects.toThrow(
        /\[consent_required\]/
      );
      // Sibling working copies stay allowed.
      await expect(assertAiConsentForPath('/other')).resolves.toBeUndefined();
    } finally {
      setAiConsentReaderForTests(undefined);
    }
  });

  it('allows working copies without an explicit entry and honors explicit opt-in', async () => {
    setAiConsentReaderForTests(async () => ({
      '/enabled-repo': { aiEnabled: true, updatedAt: '2026-01-01T00:00:00.000Z' },
    }));
    try {
      await expect(assertAiConsentForPath('/enabled-repo')).resolves.toBeUndefined();
      await expect(assertAiConsentForPath('/never-configured')).resolves.toBeUndefined();
      await expect(findConsentForPath(undefined)).resolves.toBeNull();
    } finally {
      setAiConsentReaderForTests(undefined);
    }
  });

  it('uses the shellysvn:ai-consent:v1 store key contract', () => {
    expect(AI_CONSENT_STORE_KEY).toBe('shellysvn:ai-consent:v1');
  });
});
