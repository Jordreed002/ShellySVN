import { lookup } from 'dns/promises';
import { BlockList, isIP, type LookupFunction } from 'net';

/**
 * SSRF guard for outbound HTTP(S) requests to user-supplied URLs.
 *
 * Threat model: a webhook target (or any configurable outbound URL) is attacker
 * influenced. Without validation the request can be steered at loopback,
 * link-local (cloud metadata), RFC1918, or other non-public addresses — either
 * via an IP literal, a DNS name that resolves to one, or a DNS rebinding
 * between validation and connection.
 *
 * Strategy:
 * 1. Reject non-http(s) schemes, embedded credentials, and non-allowlisted ports.
 * 2. Reject hostnames that are non-canonical IPv4 encodings (decimal, hex,
 *    octal, or partial dotted-quads such as `2130706433`, `0x7f.0.0.1`,
 *    `0177.0.0.1`, `127.1`) before they ever reach the resolver — `getaddrinfo`
 *    happily parses those into loopback/private addresses and the guard must
 *    not depend on post-resolution normalization for them.
 * 3. Resolve the hostname at request time and reject the target if *any* DNS
 *    answer is a blocked address (mixed public/private answers are rejected).
 * 4. Pin the connection to the validated address via a custom `lookup`
 *    (`createPinnedLookup`) so no second, rebindable resolution happens between
 *    validation and connect. Redirects must be disabled or re-validated by the
 *    caller (the pinned lookup keeps any redirect on a validated IP only if the
 *    client re-uses it; refusing redirects is the simpler safe default).
 */

const DEFAULT_ALLOWED_SCHEMES: readonly string[] = ['http:', 'https:'];
const DEFAULT_ALLOWED_PORTS: readonly number[] = [80, 443, 8080, 8443];

const BLOCKED_SUBNETS: ReadonlyArray<{ address: string; prefix: number; family: 'ipv4' | 'ipv6' }> = [
  // IPv4: "this" network, RFC1918 private, CGNAT shared, loopback, link-local
  // (incl. cloud metadata), IETF assignments, documentation/benchmark ranges,
  // multicast, and the reserved/broadcast tail. 240.0.0.0/4 covers
  // 255.255.255.255.
  { address: '0.0.0.0', prefix: 8, family: 'ipv4' },
  { address: '10.0.0.0', prefix: 8, family: 'ipv4' },
  { address: '100.64.0.0', prefix: 10, family: 'ipv4' },
  { address: '127.0.0.0', prefix: 8, family: 'ipv4' },
  { address: '169.254.0.0', prefix: 16, family: 'ipv4' },
  { address: '172.16.0.0', prefix: 12, family: 'ipv4' },
  { address: '192.0.0.0', prefix: 24, family: 'ipv4' },
  { address: '192.0.2.0', prefix: 24, family: 'ipv4' },
  { address: '192.88.99.0', prefix: 24, family: 'ipv4' },
  { address: '192.168.0.0', prefix: 16, family: 'ipv4' },
  { address: '198.18.0.0', prefix: 15, family: 'ipv4' },
  { address: '198.51.100.0', prefix: 24, family: 'ipv4' },
  { address: '203.0.113.0', prefix: 24, family: 'ipv4' },
  { address: '224.0.0.0', prefix: 4, family: 'ipv4' },
  { address: '240.0.0.0', prefix: 4, family: 'ipv4' },
  // IPv6: discard-only, documentation, deprecated 6to4, unique local,
  // link-local, multicast. Unspecified (`::`) and loopback (`::1`) are listed
  // as exact addresses below. IPv4-mapped (::ffff:0:0/96) and well-known NAT64
  // (64:ff9b::/96) ranges are unwrapped to their embedded IPv4 address and
  // checked against the IPv4 rules in `isBlockedIpAddress`.
  { address: '100::', prefix: 64, family: 'ipv6' },
  { address: '2001:db8::', prefix: 32, family: 'ipv6' },
  { address: '2002::', prefix: 16, family: 'ipv6' },
  { address: 'fc00::', prefix: 7, family: 'ipv6' },
  { address: 'fe80::', prefix: 10, family: 'ipv6' },
  { address: 'ff00::', prefix: 8, family: 'ipv6' },
];

const BLOCKED_ADDRESSES: ReadonlyArray<{ address: string; family: 'ipv4' | 'ipv6' }> = [
  { address: '::', family: 'ipv6' },
  { address: '::1', family: 'ipv6' },
];

const BLOCK_LIST = new BlockList();
for (const subnet of BLOCKED_SUBNETS) {
  BLOCK_LIST.addSubnet(subnet.address, subnet.prefix, subnet.family);
}
for (const entry of BLOCKED_ADDRESSES) {
  BLOCK_LIST.addAddress(entry.address, entry.family);
}

/**
 * Hostnames that must never be treated as outbound targets regardless of what
 * they resolve to: the resolver itself (and mDNS) is local trust territory.
 */
const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.local'];

/**
 * Matches "numeric-looking" hostnames: decimal (`2130706433`, `127.1`),
 * hexadecimal (`0x7f000001`), and dotted mixes (`0x7f.0.0.1`, `0177.0.0.1`).
 * Canonical dotted-quads are matched too but are handled by `isIP` first.
 */
const NON_CANONICAL_NUMERIC_HOSTNAME =
  /^(?:0x[0-9a-f]+|\d+)(?:\.(?:0x[0-9a-f]+|\d+))*$/i;

export interface OutboundUrlGuardOptions {
  /** Error-message label, e.g. `'Webhook URL'`. Defaults to `'URL'`. */
  label?: string;
  /** Allowed URL schemes. Defaults to `http:` and `https:`. */
  allowedSchemes?: readonly string[];
  /**
   * Allowed destination ports (the scheme's default port counts when the URL
   * omits one). Defaults to 80, 443, 8080, 8443.
   */
  allowedPorts?: readonly number[];
}

/** A URL that passed SSRF validation, pinned to the resolved address. */
export interface SafeOutboundTarget {
  url: URL;
  hostname: string;
  address: string;
  family: 4 | 6;
  port: number;
}

function formatSchemes(schemes: readonly string[]): string {
  const names = schemes.map((scheme) => scheme.replace(/:$/, ''));
  return names.join(' or ');
}

/** True when the address is loopback/private/link-local/reserved/non-routable. */
export function isBlockedIpAddress(address: string): boolean {
  // Unwrap IPv4-mapped IPv6 (`::ffff:127.0.0.1` / `::ffff:7f00:1`) and
  // well-known-prefix NAT64 (`64:ff9b::7f00:1`) so the embedded IPv4 address is
  // checked against the IPv4 rules. Modern Node/Bun BlockLists do the mapped
  // case natively; this keeps the guarantee explicit and version-independent.
  const unwrapped = unwrapEmbeddedIpv4(address);
  if (unwrapped !== null && unwrapped !== address) {
    return isBlockedIpAddress(unwrapped);
  }

  const family = isIP(address);
  if (family !== 4 && family !== 6) {
    // Anything that is not a canonical, classifiable IP literal is rejected:
    // the caller must resolve names separately and re-check the answers.
    return true;
  }

  return BLOCK_LIST.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function unwrapEmbeddedIpv4(address: string): string | null {
  const dottedMapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1];
  if (dottedMapped) {
    return dottedMapped;
  }

  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (hexMapped) {
    return hexPairToDottedQuad(hexMapped[1], hexMapped[2]);
  }

  const nat64 = /^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (nat64) {
    return hexPairToDottedQuad(nat64[1], nat64[2]);
  }

  return null;
}

function hexPairToDottedQuad(high: string, low: string): string {
  const highValue = parseInt(high, 16);
  const lowValue = parseInt(low, 16);
  return `${highValue >> 8}.${highValue & 0xff}.${lowValue >> 8}.${lowValue & 0xff}`;
}

function extractHostname(url: URL): string {
  return url.hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '');
}

/**
 * Validate a user-supplied URL for an outbound request: scheme, credentials,
 * port, hostname shape, and every resolved DNS answer must all pass. Returns
 * the validated target with the resolved address the request must be pinned to.
 *
 * DNS is resolved *here*, at request-preparation time — call this immediately
 * before issuing the request, then connect through `createPinnedLookup` so a
 * rebinding between check and connect is impossible.
 */
export async function validateOutboundUrl(
  rawUrl: string,
  options: OutboundUrlGuardOptions = {}
): Promise<SafeOutboundTarget> {
  const label = options.label ?? 'URL';
  const allowedSchemes = options.allowedSchemes ?? DEFAULT_ALLOWED_SCHEMES;
  const allowedPorts =
    options.allowedPorts === undefined ? DEFAULT_ALLOWED_PORTS : options.allowedPorts;

  const parsed = new URL(rawUrl);
  if (!allowedSchemes.includes(parsed.protocol)) {
    throw new Error(`${label} must use ${formatSchemes(allowedSchemes)}.`);
  }
  if (!parsed.hostname) {
    throw new Error(`${label} must include a hostname.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not include credentials.`);
  }

  const port = parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port);
  if (!allowedPorts.includes(port)) {
    throw new Error(`${label} port must be one of: ${allowedPorts.join(', ')}.`);
  }

  const hostname = extractHostname(parsed);
  if (hostname === 'localhost' || BLOCKED_HOSTNAME_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw new Error(`${label} must not target local or private network addresses.`);
  }

  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    if (isBlockedIpAddress(hostname)) {
      throw new Error(`${label} must not target local or private network addresses.`);
    }
    return { url: parsed, hostname, address: hostname, family: literalFamily as 4 | 6, port };
  }

  // Non-canonical numeric encodings (decimal/hex/octal IPv4) never reach the
  // resolver: `getaddrinfo` normalizes them into IP literals and the guard must
  // not depend on that behavior to classify them.
  if (NON_CANONICAL_NUMERIC_HOSTNAME.test(hostname)) {
    throw new Error(`${label} must not use non-canonical IP address formats.`);
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`${label} hostname could not be resolved.`);
  }

  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedIpAddress(address))) {
    throw new Error(`${label} must not target local or private network addresses.`);
  }

  const selected = addresses.find(
    (entry): entry is { address: string; family: 4 | 6 } => entry.family === 4 || entry.family === 6
  );
  if (!selected) {
    throw new Error(`${label} hostname could not be resolved.`);
  }

  return { url: parsed, hostname, address: selected.address, family: selected.family, port };
}

/**
 * Custom `lookup` that pins every connection attempt to the address that
 * passed validation. Using it as the `lookup` option of `http(s).request`
 * removes the resolver from the connection path entirely, so DNS rebinding
 * between validation and connect has no effect. TLS verification still uses
 * the original hostname (SNI/cert checking), only routing is pinned.
 */
export function createPinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return ((_hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
    if (typeof options === 'object' && options !== null && 'all' in options && options.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  }) as LookupFunction;
}
