const SECRET_KEY_PATTERN =
  /(password|passwd|pwd|secret|token|credential|authorization|username|http-proxy-password)/gi;

const WINDOWS_HOME_PATTERN = /[A-Z]:\\Users\\[^\\\s]+/gi;
const POSIX_HOME_PATTERN = /\/Users\/[^/\s]+|\/home\/[^/\s]+/g;
const URL_CREDENTIAL_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/gi;

const REDACTED = '[REDACTED]';

export function redactDiagnosticText(text: string): string {
  return text
    .replace(URL_CREDENTIAL_PATTERN, `$1${REDACTED}:${REDACTED}@`)
    .replace(/\b(password|passwd|pwd|secret|token|authorization)=([^\s&]+)/gi, `$1=${REDACTED}`)
    .replace(SECRET_KEY_PATTERN, REDACTED)
    .replace(WINDOWS_HOME_PATTERN, `C:\\Users\\${REDACTED}`)
    .replace(POSIX_HOME_PATTERN, `/Users/${REDACTED}`);
}
