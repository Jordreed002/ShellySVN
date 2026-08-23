/**
 * Central redaction helper for AI provider diagnostics.
 *
 * Every string that can reach logs, error messages, or the renderer through a
 * provider code path must pass through these helpers. Header names listed in
 * SENSITIVE_HEADER_NAMES and any supplied key material are replaced before a
 * value leaves this module's callers.
 */

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'x-api-key',
  'api-key',
  'cookie',
  'proxy-authorization',
]);

const SENSITIVE_HEADER_PATTERN =
  /\b(authorization|x-api-key|api-key|cookie|proxy-authorization)\s*[:=]\s*[^\s,;"']+/gi;

export const REDACTED_PLACEHOLDER = '[REDACTED]';

/** Mask the values of sensitive headers while keeping their names for debugging. */
export function redactSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    copy[name] = SENSITIVE_HEADER_NAMES.has(name.toLowerCase())
      ? REDACTED_PLACEHOLDER
      : value;
  }
  return copy;
}

/**
 * Remove credential material from free-form diagnostic text:
 * explicit `Authorization:`-style fragments, raw bearer/api-key tokens, and any
 * caller-supplied secret values (e.g. a stored API key that leaked into a URL).
 */
export function redactDiagnosticsText(text: string, secrets: readonly string[] = []): string {
  let output = text.replace(SENSITIVE_HEADER_PATTERN, (_match, name: string) => `${name}: ${REDACTED_PLACEHOLDER}`);
  output = output.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED_PLACEHOLDER}`);
  for (const secret of secrets) {
    if (secret && secret.length >= 8) {
      output = output.split(secret).join(REDACTED_PLACEHOLDER);
    }
  }
  return output;
}

/** Redact the query portion of a URL (keys sometimes travel as ?api-key=...). */
export function redactUrlCredentials(url: string): string {
  return url.replace(/([?&][A-Za-z0-9_-]*(?:key|token|secret|password)[A-Za-z0-9_-]*=)[^&]*/gi, `$1${REDACTED_PLACEHOLDER}`);
}

/**
 * Build a safe one-line description of a provider request for diagnostics.
 * Never includes header values, key material, or the prompt body.
 */
export function describeProviderRequestSafely(
  url: string,
  headers: Record<string, string>,
  secrets: readonly string[] = []
): string {
  const headerSummary = Object.entries(redactSensitiveHeaders(headers))
    .map(([name, value]) => `${name}=${value === REDACTED_PLACEHOLDER ? REDACTED_PLACEHOLDER : 'set'}`)
    .join(' ');
  return `${redactDiagnosticsText(redactUrlCredentials(url), secrets)} ${headerSummary}`.trim();
}
