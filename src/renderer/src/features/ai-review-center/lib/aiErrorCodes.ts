/**
 * Runtime classification of AI failures (#18, UI half).
 *
 * Main-process AI services prefix thrown error messages with a bracketed
 * machine code (`[timeout] …`, and — once the backend lands them —
 * consent/privacy codes such as `[working_copy_consent_required]` or
 * `[secrets_detected]`). This parser is deliberately string-based so the UI
 * degrades gracefully when a code does not exist yet in the shared union.
 */

const ERROR_CODE_PATTERN = /^\[([a-z0-9_]+)\]/i;

/** Extract the bracketed machine code from an AI error, or null. */
export function parseAiErrorCode(error: unknown): string | null {
  return codeFromMessage(errorMessageValue(error));
}

function errorMessageValue(error: unknown): string | null {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' ? message : null;
}

/** Consent-gate failures: the request never ran for this working copy. */
export function isAiConsentErrorCode(code: string | null): boolean {
  return code !== null && code.includes('consent');
}

/** Privacy-scanner failures: a potential secret was about to leave the machine. */
export function isAiSecretErrorCode(code: string | null): boolean {
  return (
    code !== null && (code.includes('secret') || code.includes('privacy') || code.includes('redact'))
  );
}

/** Either family — render the actionable privacy/consent panel instead of a plain error. */
export function isAiPrivacyErrorCode(code: string | null): boolean {
  return isAiConsentErrorCode(code) || isAiSecretErrorCode(code);
}

function codeFromMessage(message: string | null): string | null {
  if (!message) return null;
  const match = ERROR_CODE_PATTERN.exec(message.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/** Strip the leading `[code]` marker for display, so users see the human sentence. */
export function aiErrorMessage(error: unknown, fallback = 'The AI request failed.'): string {
  const message = errorMessageValue(error);
  if (!message) return fallback;
  return message.trim().replace(ERROR_CODE_PATTERN, '').trim() || fallback;
}
