/**
 * Locale-independent parsing and validation for user-supplied SVN revisions.
 *
 * Every revision that crosses the renderer -> main boundary is validated here
 * (or by the service-side `assertRevision` twin) before it reaches a `-r`/`-c`
 * argument. The checks are deliberately regex-based instead of
 * `parseInt`/`Number()` coercions:
 *
 * - `Number('１２３')` and friends happily convert non-ASCII decimal digits
 *   (fullwidth, Arabic-Indic, …) that the `svn` CLI then rejects, turning a
 *   validation error into a confusing command failure. JavaScript `\d` only
 *   matches ASCII `0-9`, so the patterns below are locale-independent by
 *   construction.
 * - Coercions also accept `1e3`, `0x10`, `1.5`, `+5`, leading/trailing junk
 *   and whitespace-inside forms that either change meaning or are invalid as
 *   revision specifiers.
 *
 * Accepted single-revision grammar (mirrors what `svn` itself parses):
 * `DIGIT+ | HEAD | BASE | COMMITTED | PREV | {DATE}` (keywords
 * case-insensitive, dates bounded and control-character free).
 */

/** Maximum digits for a numeric revision (well under Number.MAX_SAFE_INTEGER). */
const MAX_NUMERIC_REVISION_DIGITS = 15;
/** Maximum inner length for a `{DATE}` revision. */
const MAX_DATE_REVISION_LENGTH = 64;

const NUMERIC_REVISION = /^\d+$/;
const REVISION_KEYWORDS = new Set(['HEAD', 'BASE', 'COMMITTED', 'PREV']);
// Built via RegExp so MAX_DATE_REVISION_LENGTH interpolates into the quantifier.
const DATE_REVISION = new RegExp(
  `^\\{[^{}\\u0000-\\u001f\\u007f]{1,${MAX_DATE_REVISION_LENGTH}}\\}$`
);

export class SvnRevisionError extends Error {
  constructor(
    message: string,
    public readonly field: string
  ) {
    super(message);
    this.name = 'SvnRevisionError';
  }
}

/** True when `value` (already trimmed) is a valid single-revision specifier. */
export function isValidSvnRevision(value: string): boolean {
  if (NUMERIC_REVISION.test(value)) return value.length <= MAX_NUMERIC_REVISION_DIGITS;
  if (REVISION_KEYWORDS.has(value.toUpperCase())) return true;
  return DATE_REVISION.test(value);
}

function normalizeRevisionSpec(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new SvnRevisionError(`${field} must not be empty.`, field);
  if (!isValidSvnRevision(normalized)) {
    throw new SvnRevisionError(
      `${field} "${value}" is not a valid SVN revision (expected a number, ` +
        `HEAD, BASE, COMMITTED, PREV or a {DATE} form).`,
      field
    );
  }
  const keyword = normalized.toUpperCase();
  return REVISION_KEYWORDS.has(keyword) ? keyword : normalized;
}

/**
 * Validate an optional single-revision input (`-r` slot). Returns the
 * canonical string form, or `undefined` when the caller passed
 * `undefined`/`null`/`''` (revision not requested). Numbers are accepted when
 * they are non-negative safe integers. Throws `SvnRevisionError` otherwise.
 */
export function normalizeSvnRevision(value: unknown, field = 'revision'): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new SvnRevisionError(`${field} must be a non-negative integer.`, field);
    }
    return String(value);
  }
  if (typeof value !== 'string') {
    throw new SvnRevisionError(`${field} must be a number or string.`, field);
  }
  if (!value.trim()) return undefined;
  return normalizeRevisionSpec(value, field);
}

/**
 * Validate a REQUIRED single-revision input: like `normalizeSvnRevision` but
 * absent/empty values throw instead of returning `undefined`.
 */
export function requireSvnRevision(value: unknown, field = 'revision'): string {
  const normalized = normalizeSvnRevision(value, field);
  if (normalized === undefined) throw new SvnRevisionError(`${field} is required.`, field);
  return normalized;
}

/** Like `normalizeSvnRevisionNumber`, but absent values throw. */
export function requireSvnRevisionNumber(value: unknown, field = 'revision'): number {
  const normalized = normalizeSvnRevisionNumber(value, field);
  if (normalized === undefined) throw new SvnRevisionError(`${field} is required.`, field);
  return normalized;
}

/**
 * Validate an optional numeric revision input (slots typed as `number` in the
 * IPC contract, e.g. log/blame start and end revisions). Strict about type and
 * character set: numeric strings are only converted after an ASCII-digit
 * regex has vetted them, never via bare `Number()`/`parseInt` coercion.
 */
export function normalizeSvnRevisionNumber(value: unknown, field = 'revision'): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new SvnRevisionError(`${field} must be a non-negative integer.`, field);
    }
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    if (NUMERIC_REVISION.test(trimmed) && trimmed.length <= MAX_NUMERIC_REVISION_DIGITS) {
      // Safe here: the regex guarantees ASCII digits only.
      return Number(trimmed);
    }
  }
  throw new SvnRevisionError(`${field} must be a non-negative integer.`, field);
}

/**
 * Validate one `-c` (change) item: a single revision, a reversed numeric
 * revision (`-123`), or a `START:END` range of two single revisions. A
 * `{DATE}` spec is accepted as a single item (its text may contain `:`).
 */
export function normalizeSvnChangeItem(value: unknown, field = 'change'): string {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new SvnRevisionError(`${field} must be a number or string.`, field);
  }
  const raw = String(value).trim();
  if (!raw) throw new SvnRevisionError(`${field} must not be empty.`, field);

  const invalid = () => new SvnRevisionError(`${field} "${raw}" is not a valid change.`, field);

  if (raw.startsWith('-')) {
    // Only a plain numeric revision may be reversed.
    const unsigned = raw.slice(1);
    if (!NUMERIC_REVISION.test(unsigned) || !isValidSvnRevision(unsigned)) throw invalid();
    return `-${unsigned}`;
  }
  if (isValidSvnRevision(raw)) return normalizeRevisionSpec(raw, field);

  // START:END range of two colon-free single specs.
  const [start, end, ...extra] = raw.split(':');
  if (extra.length > 0 || !start || !end) throw invalid();
  return `${normalizeRevisionSpec(start, field)}:${normalizeRevisionSpec(end, field)}`;
}

/**
 * Validate the optional `-c` list of a merge/diff request. Returns the
 * canonical items (each a revision, reversed revision or `START:END` range)
 * ready to be joined for `--change`, or `undefined` when absent.
 */
export function normalizeSvnChangeList(
  values: unknown,
  field = 'revisions'
): string[] | undefined {
  if (values === undefined || values === null) return undefined;
  if (!Array.isArray(values)) {
    throw new SvnRevisionError(`${field} must be an array of revision specifiers.`, field);
  }
  return values.map((value, index) => normalizeSvnChangeItem(value, `${field}[${index}]`));
}
