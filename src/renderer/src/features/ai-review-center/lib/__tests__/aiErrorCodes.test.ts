import { describe, expect, it } from 'vitest';
import {
  aiErrorMessage,
  isAiConsentErrorCode,
  isAiPrivacyErrorCode,
  isAiSecretErrorCode,
  parseAiErrorCode,
} from '../aiErrorCodes';

describe('parseAiErrorCode', () => {
  it('extracts bracketed codes from Error objects and strings', () => {
    expect(parseAiErrorCode(new Error('[timeout] Provider did not respond'))).toBe('timeout');
    expect(parseAiErrorCode('[cli_not_found] The configured AI CLI was not found.')).toBe(
      'cli_not_found'
    );
    expect(parseAiErrorCode(new Error('[WORKING_COPY_CONSENT_REQUIRED] Consent missing'))).toBe(
      'working_copy_consent_required'
    );
    expect(parseAiErrorCode(new Error('  \n[secrets_detected] looks like a token'))).toBe(
      'secrets_detected'
    );
  });

  it('returns null for plain messages, missing messages, and non-errors', () => {
    expect(parseAiErrorCode(new Error('just a sentence'))).toBeNull();
    expect(parseAiErrorCode(new Error(''))).toBeNull();
    expect(parseAiErrorCode(undefined)).toBeNull();
    expect(parseAiErrorCode({ message: 42 })).toBeNull();
    expect(parseAiErrorCode(null)).toBeNull();
  });
});

describe('privacy/consent classification (#18)', () => {
  it('recognizes consent codes, including ones the backend has not shipped yet', () => {
    expect(isAiConsentErrorCode('consent_required')).toBe(true);
    expect(isAiConsentErrorCode('working_copy_consent_required')).toBe(true);
    expect(isAiConsentErrorCode(parseAiErrorCode(new Error('[ai_consent_denied] nope')))).toBe(true);
    expect(isAiConsentErrorCode('timeout')).toBe(false);
    expect(isAiConsentErrorCode(null)).toBe(false);
  });

  it('recognizes secret/privacy scanner codes', () => {
    expect(isAiSecretErrorCode('secrets_detected')).toBe(true);
    expect(isAiSecretErrorCode('privacy_scan_blocked')).toBe(true);
    expect(isAiSecretErrorCode('redaction_failed')).toBe(true);
    expect(isAiSecretErrorCode('quota_exceeded')).toBe(false);
    expect(isAiSecretErrorCode(null)).toBe(false);
  });

  it('treats either family as privacy-actionable', () => {
    expect(isAiPrivacyErrorCode('consent_required')).toBe(true);
    expect(isAiPrivacyErrorCode('secret_in_diff')).toBe(true);
    expect(isAiPrivacyErrorCode('unknown')).toBe(false);
  });
});

describe('aiErrorMessage', () => {
  it('strips the code prefix and keeps the human sentence', () => {
    expect(aiErrorMessage(new Error('[timeout] Provider did not respond'))).toBe(
      'Provider did not respond'
    );
    expect(aiErrorMessage(new Error('plain failure'))).toBe('plain failure');
    expect(aiErrorMessage(undefined, 'fallback')).toBe('fallback');
    expect(aiErrorMessage(new Error('[cancelled] '), 'fallback')).toBe('fallback');
  });
});
