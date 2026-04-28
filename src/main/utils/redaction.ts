const SECRET_ARG_NAMES = new Set([
  '--password',
  '--username',
  '--password-from-stdin',
  '--config-option',
  '--client-cert-password',
]);

const SECRET_KEY_PATTERN =
  /(password|passwd|pwd|secret|token|credential|authorization|username|http-proxy-password)/i;

const INLINE_SECRET_PATTERN =
  /\b(password|passwd|pwd|secret|token|authorization|http-proxy-password)=([^\s&]+)/gi;

const REDACTED = '[REDACTED]';

export function redactValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  return value.replace(INLINE_SECRET_PATTERN, (_match, key) => `${key}=${REDACTED}`);
}

export function redactArgs(args: string[]): string[] {
  const redacted: string[] = [];
  let redactNext = false;

  for (const arg of args) {
    const [name, inlineValue] = arg.split('=', 2);
    const normalizedName = name.toLowerCase();

    if (redactNext) {
      redacted.push(REDACTED);
      redactNext = false;
      continue;
    }

    if (SECRET_ARG_NAMES.has(normalizedName)) {
      redacted.push(inlineValue === undefined ? arg : `${name}=${REDACTED}`);
      redactNext = inlineValue === undefined;
      continue;
    }

    if (inlineValue !== undefined && SECRET_KEY_PATTERN.test(name)) {
      redacted.push(`${name}=${REDACTED}`);
      continue;
    }

    redacted.push(redactValue(arg) as string);
  }

  return redacted;
}

export function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactForLog);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? REDACTED : redactForLog(nestedValue),
      ])
    );
  }

  return redactValue(value);
}
