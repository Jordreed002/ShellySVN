/**
 * Canonical handling for SVN repository URLs (svn, svn+ssh, http, https, file).
 *
 * SVN URLs reach the app from three sources with three different encodings:
 * user input (usually raw unicode), `svn list --xml` output (decoded names
 * such as `Répo Dir` or a literal `a%20b.txt`), and previously stored
 * canonical URLs. Every URL that crosses a service boundary must be
 * normalized through {@link normalizeRepoUrl} so that comparisons, cache
 * keys, and child-URL construction are byte-stable.
 *
 * Normalization rules (verified against SVN 1.14 client behavior):
 * - Scheme and host are lowercased; the host is canonicalized to ASCII
 *   (IDN → punycode via WHATWG URL, IPv6 literals compressed to `::1` form).
 * - The svn:// default port 3690 is elided; WHATWG URL elides http/80 and
 *   https/443 on its own.
 * - Path segments are decoded, Unicode NFC-normalized, and re-encoded once.
 *   `%2F` inside a segment stays encoded, a literal `%` in a name becomes
 *   `%25`, and existing escapes are never encoded twice. SVN clients decode
 *   percent-escapes, so `a%2520b.txt` is the correct URL for a file literally
 *   named `a%20b.txt` (passing the name through unchanged would resolve to
 *   `a b.txt` and fail with E160013).
 * - Trailing slashes are stripped and duplicate slashes collapsed.
 * - Values that are not SVN URLs (working-copy paths such as `C:\wc` or
 *   `/home/u/wc`) are returned unchanged so callers can normalize targets
 *   without first knowing whether they are paths or URLs.
 *
 * Segment inputs to {@link joinRepoUrl} are DECODED names (as emitted by
 * `svn list --xml` and typed by users); encoding happens exactly once here.
 */

const SVN_URL_PROTOCOLS = new Set(['svn:', 'svn+ssh:', 'http:', 'https:', 'file:']);

/** Registered SVN protocol default ports that WHATWG URL does not know. */
const PROTOCOL_DEFAULT_PORTS: Record<string, string> = { 'svn:': '3690' };

/** Characters kept verbatim when (re-)encoding a path segment. */
const SEGMENT_SAFE = /[A-Za-z0-9\-._~!$&'()*+,;=:@]/;
const HEX_DIGITS = '0123456789ABCDEF'.split('');

function percentEncodeByte(byte: number): string {
  return `%${HEX_DIGITS[byte >> 4]}${HEX_DIGITS[byte & 0xf]}`;
}

/** Encode a decoded segment value for URL emission (input must already be decoded). */
function encodeRepoSegment(segment: string): string {
  let encoded = '';
  for (const byte of new TextEncoder().encode(segment.normalize('NFC'))) {
    const character = String.fromCharCode(byte);
    encoded += SEGMENT_SAFE.test(character) ? character : percentEncodeByte(byte);
  }
  return encoded;
}

/** Tolerant segment decode: invalid escapes are preserved verbatim. */
function decodeRepoSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isIpv6Literal(host: string): boolean {
  return host.startsWith('[') || host.includes(':');
}

/** Canonicalize an IPv6 literal (brackets optional) using WHATWG semantics. */
function canonicalIpv6Literal(host: string): string {
  const bracketed = host.startsWith('[') ? host : `[${host}]`;
  try {
    return new URL(`http://${bracketed}/`).hostname;
  } catch {
    return host.replaceAll(/[\[\]]/g, '');
  }
}

/**
 * Canonicalize a URL hostname to lowercase ASCII: punycode for IDN hosts,
 * compressed bracketed form for IPv6 literals (matching `url.hostname`).
 * WHATWG URL only applies IDNA to special schemes (http/https/...), so
 * non-special `svn:` hosts — which arrive percent-encoded — are decoded and
 * routed through an `http://` URL to reuse the platform IDNA implementation
 * instead of hand-rolling punycode.
 */
function canonicalHost(hostname: string): string {
  if (!hostname) return '';
  const decoded = decodeRepoSegment(hostname);
  if (!decoded) return '';
  if (isIpv6Literal(decoded)) return canonicalIpv6Literal(decoded);
  if (/[^\x00-\x7F]/.test(decoded)) {
    try {
      return new URL(`http://${decoded}/`).hostname;
    } catch {
      // Fall through with the unicode host rather than rejecting the URL.
    }
  }
  return decoded.toLowerCase();
}

export interface SvnRepoUrlIdentity {
  /** Lowercase protocol including the trailing colon, e.g. `svn:`. */
  protocol: string;
  /** Canonical ASCII host: punycode for IDN, bracketed compressed IPv6, '' for file://. */
  host: string;
  isIpv6: boolean;
  /** Effective port (explicit or protocol default); null when the protocol has none. */
  port: number | null;
  /** Port the canonical form emits (explicit, non-default); null to omit. */
  emittedPort: number | null;
  /** ssh userinfo without the `@`, percent-encoded as WHATWG produced it; '' when absent. */
  userinfo: string;
  /** Decoded, NFC-normalized path segments (no empty segments). */
  segments: string[];
  /** Decoded, NFC-normalized path with a leading slash ('' when the URL has no path). */
  path: string;
}

/** Returns true when the value parses as an SVN-supported repository URL. */
export function isSvnRepoUrl(value: string): boolean {
  return parseRepoUrl(value) !== null;
}

function parseRepoUrl(value: string): SvnRepoUrlIdentity | null {
  if (!value || value.includes('\0') || value !== value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!SVN_URL_PROTOCOLS.has(url.protocol)) return null;

  const protocolDefault = PROTOCOL_DEFAULT_PORTS[url.protocol];
  const explicitPort = url.port !== '' ? Number(url.port) : null;
  const emittedPort = explicitPort !== null && String(explicitPort) !== protocolDefault ? explicitPort : null;
  const effectivePort =
    explicitPort ?? (protocolDefault !== undefined ? Number(protocolDefault) : null);

  const host = canonicalHost(url.hostname);
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeRepoSegment(segment).normalize('NFC'));

  return {
    protocol: url.protocol,
    host,
    isIpv6: isIpv6Literal(host),
    emittedPort,
    port: effectivePort !== null && Number.isFinite(effectivePort) ? effectivePort : null,
    userinfo: url.username || url.password ? `${url.username}${url.password ? `:${url.password}` : ''}` : '',
    segments,
    path: segments.length > 0 ? `/${segments.join('/')}` : '',
  };
}

/** Parse an SVN URL into its canonical identity; null for paths and non-SVN URLs. */
export function parseRepoUrlIdentity(value: string): SvnRepoUrlIdentity | null {
  return parseRepoUrl(value);
}

/** Re-emit a canonical URL string from a parsed identity. */
function identityToUrl(identity: SvnRepoUrlIdentity): string {
  const path =
    identity.segments.length > 0 ? `/${identity.segments.map(encodeRepoSegment).join('/')}` : '';
  const authority = `${identity.userinfo ? `${identity.userinfo}@` : ''}${identity.host}${
    identity.emittedPort !== null ? `:${identity.emittedPort}` : ''
  }`;
  return `${identity.protocol}//${authority}${path}`;
}

/**
 * Canonicalize an SVN repository URL. Working-copy paths and unparseable
 * values are returned unchanged, so callers can pipe any target through.
 */
export function normalizeRepoUrl(value: string): string {
  const identity = parseRepoUrl(value);
  return identity ? identityToUrl(identity) : value;
}

function sameAuthority(left: SvnRepoUrlIdentity, right: SvnRepoUrlIdentity): boolean {
  // ssh userinfo selects a login, not a repository; ignore it for identity.
  return left.protocol === right.protocol && left.host === right.host && left.port === right.port;
}

/** Encoding- and case-normalized URL equality (segment-aware, NFC-normalized). */
export function repoUrlEquals(left: string, right: string): boolean {
  const leftIdentity = parseRepoUrlIdentity(left);
  const rightIdentity = parseRepoUrlIdentity(right);
  if (!leftIdentity || !rightIdentity) return normalizeRepoUrl(left) === normalizeRepoUrl(right);
  return (
    sameAuthority(leftIdentity, rightIdentity) &&
    leftIdentity.segments.length === rightIdentity.segments.length &&
    leftIdentity.segments.every((segment, index) => segment === rightIdentity.segments[index])
  );
}

/** True when `child` is a strict descendant of `parent` (same repository authority). */
export function isChildUrl(parent: string, child: string): boolean {
  const parentIdentity = parseRepoUrlIdentity(parent);
  const childIdentity = parseRepoUrlIdentity(child);
  if (!parentIdentity || !childIdentity) return false;
  if (!sameAuthority(parentIdentity, childIdentity)) return false;
  if (parentIdentity.segments.length >= childIdentity.segments.length) return false;
  return parentIdentity.segments.every((segment, index) => segment === childIdentity.segments[index]);
}

/**
 * Append a decoded segment (or `/`-separated segments, e.g. `branches/x`) to a
 * repository URL, percent-encoding the new segments exactly once.
 */
export function joinRepoUrl(base: string, segment: string): string {
  const identity = parseRepoUrlIdentity(base);
  if (!identity) {
    return `${base.replaceAll(/\/+$/, '')}/${segment.replaceAll(/^\/+|\/+$/g, '')}`;
  }
  const parts = segment
    .split('/')
    .filter(Boolean)
    .map((part) => part.normalize('NFC'));
  if (parts.length === 0) return identityToUrl(identity);
  return identityToUrl({ ...identity, segments: [...identity.segments, ...parts] });
}

/** Canonical parent URL (last path segment removed; the URL itself when already at the root). */
export function parentRepoUrl(value: string): string {
  const identity = parseRepoUrl(value);
  if (!identity || identity.segments.length === 0) return normalizeRepoUrl(value);
  return identityToUrl({ ...identity, segments: identity.segments.slice(0, -1) });
}
