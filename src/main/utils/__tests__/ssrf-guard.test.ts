import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDnsLookup = vi.hoisted(() => vi.fn());

vi.mock('dns/promises', () => ({
  default: {
    lookup: mockDnsLookup,
  },
  lookup: mockDnsLookup,
}));

import {
  createPinnedLookup,
  isBlockedIpAddress,
  validateOutboundUrl,
} from '../ssrf-guard';

const PUBLIC_ANSWER = [{ address: '93.184.216.34', family: 4 }];

beforeEach(() => {
  mockDnsLookup.mockReset();
  mockDnsLookup.mockResolvedValue(PUBLIC_ANSWER);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('isBlockedIpAddress', () => {
  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '100.64.0.1',
    '100.127.255.254',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.254',
    '192.0.0.9',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.1.10',
    '198.18.0.1',
    '198.19.255.254',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '239.255.255.254',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks reserved IPv4 address %s', (address) => {
    expect(isBlockedIpAddress(address)).toBe(true);
  });

  it.each([
    '::',
    '::1',
    '100::',
    '2001:db8::1',
    '2002:4860:4860::8888',
    'fc00::1',
    'fd12:3456:789a::1',
    'fe80::1',
    'ff02::1',
  ])('blocks reserved IPv6 address %s', (address) => {
    expect(isBlockedIpAddress(address)).toBe(true);
  });

  it('unwraps IPv4-mapped IPv6 addresses (dotted and hex forms)', () => {
    expect(isBlockedIpAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIpAddress('::ffff:7f00:1')).toBe(true);
    expect(isBlockedIpAddress('::FFFF:10.1.2.3')).toBe(true);
    expect(isBlockedIpAddress('::ffff:192.168.0.1')).toBe(true);
  });

  it('unwraps well-known NAT64 addresses to their embedded IPv4 target', () => {
    expect(isBlockedIpAddress('64:ff9b::7f00:1')).toBe(true);
    expect(isBlockedIpAddress('64:ff9b::a00:1')).toBe(true);
  });

  it.each([
    '93.184.216.34',
    '1.1.1.1',
    '8.8.8.8',
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
  ])('allows public address %s', (address) => {
    expect(isBlockedIpAddress(address)).toBe(false);
  });

  it('allows an IPv4-mapped public address once unwrapped', () => {
    expect(isBlockedIpAddress('::ffff:93.184.216.34')).toBe(false);
  });

  it.each(['localhost', 'example.test', '', '2130706433', '0x7f.0.0.1'])(
    'rejects non-IP inputs instead of guessing: %s',
    (address) => {
      expect(isBlockedIpAddress(address)).toBe(true);
    }
  );
});

describe('validateOutboundUrl', () => {
  it('allows a public https URL and returns the pinned target', async () => {
    await expect(validateOutboundUrl('https://example.test/hook?x=1')).resolves.toMatchObject({
      hostname: 'example.test',
      address: '93.184.216.34',
      family: 4,
      port: 443,
    });
  });

  it('rejects non-http(s) schemes', async () => {
    await expect(validateOutboundUrl('file:///etc/passwd')).rejects.toThrow(
      'URL must use http or https.'
    );
    await expect(validateOutboundUrl('ftp://example.test/x')).rejects.toThrow(
      'URL must use http or https.'
    );
  });

  it('honors a stricter scheme allowlist', async () => {
    await expect(
      validateOutboundUrl('http://example.test/hook', {
        allowedSchemes: ['https:'],
        label: 'Webhook URL',
      })
    ).rejects.toThrow('Webhook URL must use https.');

    await expect(
      validateOutboundUrl('https://example.test/hook', {
        allowedSchemes: ['https:'],
        label: 'Webhook URL',
      })
    ).resolves.toMatchObject({ port: 443 });
  });

  it('rejects URLs with embedded credentials', async () => {
    await expect(validateOutboundUrl('https://user:pass@example.test/hook')).rejects.toThrow(
      'URL must not include credentials.'
    );
  });

  it('caps ports to the allowlist (explicit and scheme defaults)', async () => {
    await expect(validateOutboundUrl('https://example.test:22/hook')).rejects.toThrow(
      'URL port must be one of: 80, 443, 8080, 8443.'
    );
    await expect(validateOutboundUrl('http://example.test:6379/hook')).rejects.toThrow(
      'URL port must be one of: 80, 443, 8080, 8443.'
    );
    await expect(validateOutboundUrl('https://example.test:8443/hook')).resolves.toMatchObject({
      port: 8443,
    });
    await expect(validateOutboundUrl('http://example.test:8080/hook')).resolves.toMatchObject({
      port: 8080,
    });
  });

  it('supports a custom port allowlist', async () => {
    await expect(
      validateOutboundUrl('https://example.test/hook', { allowedPorts: [8443] })
    ).rejects.toThrow('URL port must be one of: 8443.');
    await expect(
      validateOutboundUrl('https://example.test:8443/hook', { allowedPorts: [8443] })
    ).resolves.toMatchObject({ port: 8443 });
  });

  it('blocks localhost-style names in every spelling, without hitting DNS', async () => {
    for (const url of [
      'https://localhost/hook',
      'https://LOCALHOST/hook',
      'https://localhost./hook',
      'https://api.localhost/hook',
      'https://printer.local/hook',
    ]) {
      await expect(validateOutboundUrl(url)).rejects.toThrow(
        'URL must not target local or private network addresses.'
      );
    }
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it('blocks canonical private IP literals without hitting DNS', async () => {
    for (const url of [
      'https://127.0.0.1/hook',
      'https://10.0.0.5/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/hook',
      'https://[fe80::1]/hook',
      'https://[fd12::1]/hook',
      'https://224.0.0.1/hook',
      'https://240.0.0.1/hook',
      'https://100.64.0.1/hook',
    ]) {
      await expect(validateOutboundUrl(url)).rejects.toThrow(
        'URL must not target local or private network addresses.'
      );
    }
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it('rejects non-canonical IPv4 encodings before resolution', async () => {
    // The WHATWG URL parser itself normalizes these spellings into canonical
    // dotted-quads (e.g. 2130706433 -> 127.0.0.1), so they are blocked by the
    // IP-literal rules; anything that slips past normalization as a numeric
    // hostname is rejected by the non-canonical-format rules. Either way the
    // resolver is never consulted.
    for (const url of [
      'https://2130706433/hook', // decimal 127.0.0.1
      'https://0x7f000001/hook', // hex dword
      'https://0x7f.0.0.1/hook', // hex octets
      'https://0177.0.0.1/hook', // octal octets
      'https://127.1/hook', // partial dotted-quad
    ]) {
      await expect(validateOutboundUrl(url)).rejects.toThrow(
        /local or private network addresses|non-canonical IP address formats/
      );
    }
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it('rejects IPv4-in-IPv6 bypass encodings', async () => {
    for (const url of [
      'https://[::ffff:127.0.0.1]/hook',
      'https://[::ffff:7f00:1]/hook',
      'https://[::ffff:10.0.0.1]/hook',
      'https://[64:ff9b::7f00:1]/hook',
    ]) {
      await expect(validateOutboundUrl(url)).rejects.toThrow(
        'URL must not target local or private network addresses.'
      );
    }
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it('allows a public IP literal directly', async () => {
    await expect(validateOutboundUrl('https://93.184.216.34/hook')).resolves.toMatchObject({
      address: '93.184.216.34',
      family: 4,
    });
    expect(mockDnsLookup).not.toHaveBeenCalled();
  });

  it('rejects hostnames whose DNS answers include a private address', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(validateOutboundUrl('https://internal.example.test/hook')).rejects.toThrow(
      'URL must not target local or private network addresses.'
    );
  });

  it('rejects mixed public/private DNS answers', async () => {
    mockDnsLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    await expect(validateOutboundUrl('https://example.test/hook')).rejects.toThrow(
      'URL must not target local or private network addresses.'
    );
  });

  it('rejects hostnames that cannot be resolved', async () => {
    mockDnsLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(validateOutboundUrl('https://no-such-host.example.test/hook')).rejects.toThrow(
      'URL hostname could not be resolved.'
    );
  });

  it('rejects empty DNS answers', async () => {
    mockDnsLookup.mockResolvedValue([]);
    await expect(validateOutboundUrl('https://example.test/hook')).rejects.toThrow(
      'URL must not target local or private network addresses.'
    );
  });

  it('pins to the IPv6 address when only v6 answers exist', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '2606:4700:4700::1111', family: 6 }]);
    await expect(validateOutboundUrl('https://example.test/hook')).resolves.toMatchObject({
      address: '2606:4700:4700::1111',
      family: 6,
    });
  });
});

describe('createPinnedLookup', () => {
  it('answers legacy lookups with the validated address', () => {
    const lookup = createPinnedLookup('93.184.216.34', 4);
    const callback = vi.fn();
    lookup('rebind.attacker.test', { all: false }, callback);

    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  });

  it('answers all:true lookups with a single-entry address list', () => {
    const lookup = createPinnedLookup('2606:4700:4700::1111', 6);
    const callback = vi.fn();
    lookup('rebind.attacker.test', { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, [{ address: '2606:4700:4700::1111', family: 6 }]);
  });
});
