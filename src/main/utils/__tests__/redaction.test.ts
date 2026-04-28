import { describe, expect, it } from 'vitest';

import { redactArgs, redactForLog, redactValue } from '../redaction';

describe('redaction utilities', () => {
  it('redacts values after secret command flags', () => {
    expect(redactArgs(['checkout', '--username', 'alice', '--password', 'secret', 'url'])).toEqual([
      'checkout',
      '--username',
      '[REDACTED]',
      '--password',
      '[REDACTED]',
      'url',
    ]);
  });

  it('redacts inline secret key-value strings', () => {
    expect(redactValue('http-proxy-password=hunter2 token=abc123')).toBe(
      'http-proxy-password=[REDACTED] token=[REDACTED]'
    );
  });

  it('redacts nested secret object fields', () => {
    expect(
      redactForLog({
        username: 'alice',
        nested: {
          password: 'secret',
          url: 'https://example.com/repo?token=abc123',
        },
      })
    ).toEqual({
      username: '[REDACTED]',
      nested: {
        password: '[REDACTED]',
        url: 'https://example.com/repo?token=[REDACTED]',
      },
    });
  });
});
