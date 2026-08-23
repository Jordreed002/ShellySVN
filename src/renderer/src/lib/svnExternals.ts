/**
 * svn:externals parsing and formatting — pure functions.
 *
 * Grammar (one definition per line; blank lines and lines whose first
 * non-whitespace character is `#` are skipped by Subversion):
 *
 *   localpath [-r OPERATIVE] URL[@PEG]     (legacy, pre-1.5 layout)
 *   URL[@PEG] [-r OPERATIVE] localpath     (modern layout)
 *
 * - `-r REV` may be attached (`-r1234`) or split (`-r 1234`).
 * - Revisions are numbers, `HEAD`, or `{DATE}` dates.
 * - URL forms: `scheme://…`, `^/…` (repository root), `//…` and `/…`
 *   (parent-URL relative), `../…` / `./…` (parent-URL relative paths).
 * - Local paths are relative to the directory carrying the property, must
 *   not be absolute and must not contain `..` segments. Tokens are split on
 *   whitespace — Subversion has no quoting here, so paths cannot contain
 *   spaces.
 */

export type SvnExternalsWarningCode =
  | 'legacy-form'
  | 'ambiguous'
  | 'duplicate-local-path'
  | 'peg-empty'
  | 'relative-url'
  | 'unusual-revision'
  | 'quoted-token';

export interface SvnExternalsWarning {
  code: SvnExternalsWarningCode;
  message: string;
}

export interface SvnExternalDefinition {
  localPath: string;
  url: string;
  /** Operative revision (`-r`), e.g. "1234", "HEAD", "{2020-01-01}". */
  operativeRevision?: string;
  /** Peg revision (`URL@PEG`). */
  pegRevision?: string;
  /** True when the line used the legacy local-path-first layout. */
  legacy?: boolean;
}

export type SvnExternalLine =
  | { kind: 'definition'; raw: string; definition: SvnExternalDefinition; warnings: SvnExternalsWarning[] }
  | { kind: 'comment'; raw: string; comment: string }
  | { kind: 'blank'; raw: string }
  | { kind: 'invalid'; raw: string; error: string };

export interface SvnExternalsParseResult {
  lines: SvnExternalLine[];
  /** Convenience view over `lines` — definition entries in order. */
  definitions: Array<{ line: number; definition: SvnExternalDefinition; warnings: SvnExternalsWarning[] }>;
}

const REVISION_PATTERN = /^(?:\d+|HEAD|\{[^}]+\})$/i;

export function isValidExternalRevision(revision: string | undefined | null): boolean {
  if (!revision) return false;
  return REVISION_PATTERN.test(revision.trim());
}

/**
 * URL shape accepted by svn:externals: an absolute URL with a scheme, or a
 * repository/parent-relative form (`^/`, `//`, `/`, `../`, `./`).
 */
export function isValidExternalUrl(url: string): boolean {
  const value = url.trim();
  if (value === '') return false;
  if (/\s/.test(value)) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return true; // scheme://…
  return /^(?:\^\/|\/\/|\/|\.\.\/|\.{2}$|\.\/)/.test(value);
}

/** Does the token look like an externals URL / repos-relative reference? */
function looksLikeUrl(token: string): boolean {
  return isValidExternalUrl(token);
}

function isValidLocalPath(localPath: string): { valid: boolean; reason?: string } {
  if (localPath === '') return { valid: false, reason: 'Local path is empty.' };
  if (/\s/.test(localPath)) {
    return { valid: false, reason: 'Local path contains whitespace — svn:externals cannot express that.' };
  }
  if (/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(localPath)) {
    return { valid: false, reason: 'Local path must be relative to the directory with the property.' };
  }
  const segments = localPath.split(/[\\/]/);
  if (segments.some((segment) => segment === '..')) {
    return { valid: false, reason: "Local path must stay inside the working copy (no '..' segments)." };
  }
  if (segments.some((segment) => segment === '' || segment === '.')) {
    return { valid: false, reason: 'Local path has empty or "." segments.' };
  }
  return { valid: true };
}

function splitPegRevision(token: string): { url: string; peg?: string; emptyPeg?: boolean } {
  const atIndex = token.lastIndexOf('@');
  if (atIndex <= 0) return { url: token };
  const url = token.slice(0, atIndex);
  const peg = token.slice(atIndex + 1);
  if (peg === '') return { url, emptyPeg: true };
  if (isValidExternalRevision(peg)) return { url, peg };
  // Not a revision — the '@' belongs to the URL itself.
  return { url: token };
}

/**
 * Parse an svn:externals property value. Never throws: lines that cannot be
 * understood come back as `kind: 'invalid'` with the reason, so the editor
 * can show and preserve them instead of silently dropping definitions.
 */
export function parseSvnExternals(value: string | undefined | null): SvnExternalsParseResult {
  const lines: SvnExternalLine[] = [];
  const rawLines = (value ?? '').split(/\r\n|\r|\n/);

  const localPathCounts = new Map<string, number>();

  rawLines.forEach((rawLine) => {
    const trimmed = rawLine.trim();
    if (trimmed === '') {
      lines.push({ kind: 'blank', raw: rawLine });
      return;
    }
    if (trimmed.startsWith('#')) {
      lines.push({ kind: 'comment', raw: rawLine, comment: trimmed.replace(/^#\s?/, '') });
      return;
    }

    const tokens = rawLine.split(/\s+/).filter((token) => token !== '');
    const warnings: SvnExternalsWarning[] = [];

    if (tokens.some((token) => token.startsWith('"') || token.endsWith('"'))) {
      warnings.push({
        code: 'quoted-token',
        message: 'Quoted tokens are not supported by svn:externals; Subversion splits on plain whitespace.',
      });
    }

    // Peel off the revision flag in either attached or split form.
    let operativeRevision: string | undefined;
    const rest: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === '-r') {
        const revisionValue = tokens[i + 1];
        if (revisionValue === undefined || revisionValue.startsWith('-')) {
          lines.push({ kind: 'invalid', raw: rawLine, error: '"-r" is missing its revision.' });
          return;
        }
        operativeRevision = revisionValue;
        i++;
        continue;
      }
      const attached = token.match(/^-r(.+)$/);
      if (attached) {
        operativeRevision = attached[1];
        continue;
      }
      rest.push(token);
    }

    if (rest.length === 2 && looksLikeUrl(rest[0]) && !looksLikeUrl(rest[1])) {
      // Modern: URL[@PEG] localpath
      const { url, peg, emptyPeg } = splitPegRevision(rest[0]);
      if (emptyPeg) {
        warnings.push({
          code: 'peg-empty',
          message: 'URL ends with "@" — an empty peg revision is treated as part of the URL.',
        });
      }
      const localPath = rest[1] ?? '';
      const localCheck = isValidLocalPath(localPath);
      if (!localCheck.valid) {
        lines.push({
          kind: 'invalid',
          raw: rawLine,
          error: localCheck.reason ?? 'Invalid local path.',
        });
        return;
      }
      const definition: SvnExternalDefinition = {
        localPath,
        url,
        ...(peg ? { pegRevision: peg } : {}),
        ...(operativeRevision ? { operativeRevision } : {}),
      };
      pushDefinition(lines, localPathCounts, rawLine, definition, warnings);
      return;
    }

    // Legacy: localpath [-r REV] URL[@PEG]  (operative already peeled above)
    if (rest.length === 2 && !looksLikeUrl(rest[0]) && looksLikeUrl(rest[1])) {
      const { url, peg, emptyPeg } = splitPegRevision(rest[1]);
      if (emptyPeg) {
        warnings.push({
          code: 'peg-empty',
          message: 'URL ends with "@" — an empty peg revision is treated as part of the URL.',
        });
      }
      const localPath = rest[0] ?? '';
      const localCheck = isValidLocalPath(localPath);
      if (!localCheck.valid) {
        lines.push({
          kind: 'invalid',
          raw: rawLine,
          error: localCheck.reason ?? 'Invalid local path.',
        });
        return;
      }
      warnings.push({
        code: 'legacy-form',
        message: 'Legacy local-path-first layout. The modern form puts the URL first: "URL[@PEG] [-r REV] localpath".',
      });
      const definition: SvnExternalDefinition = {
        localPath,
        url,
        ...(peg ? { pegRevision: peg } : {}),
        ...(operativeRevision ? { operativeRevision } : {}),
        legacy: true,
      };
      pushDefinition(lines, localPathCounts, rawLine, definition, warnings);
      return;
    }

    if (rest.length === 2 && looksLikeUrl(rest[0]) && looksLikeUrl(rest[1])) {
      lines.push({
        kind: 'invalid',
        raw: rawLine,
        error: 'Both tokens look like URLs — which one is the local path?',
      });
      return;
    }

    lines.push({
      kind: 'invalid',
      raw: rawLine,
      error:
        rest.length < 2
          ? 'Expected two tokens after the revision flag: a URL and a local path.'
          : rest.length === 2
            ? 'Neither token looks like a URL — expected "URL[@PEG] [-r REV] localpath".'
            : 'Too many tokens — svn:externals lines are "URL[@PEG] [-r REV] localpath".',
    });
  });

  const definitions = lines
    .map((line, index) => (line.kind === 'definition' ? { line: index + 1, ...line } : null))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return { lines, definitions };
}

function pushDefinition(
  lines: SvnExternalLine[],
  localPathCounts: Map<string, number>,
  rawLine: string,
  definition: SvnExternalDefinition,
  warnings: SvnExternalsWarning[]
): void {
  const normalized = definition.localPath.replace(/\\/g, '/').toLowerCase();
  const previous = localPathCounts.get(normalized) ?? 0;
  localPathCounts.set(normalized, previous + 1);

  if (isRelativeFormUrl(definition.url)) {
    warnings.push({
      code: 'relative-url',
      message:
        'Relative URL — resolved against the URL of the directory carrying svn:externals (moves with the branch).',
    });
  }
  if (definition.operativeRevision && !isValidExternalRevision(definition.operativeRevision)) {
    warnings.push({
      code: 'unusual-revision',
      message: `Operative revision "${definition.operativeRevision}" is not a number, HEAD or a {date}.`,
    });
  }
  if (definition.pegRevision && !isValidExternalRevision(definition.pegRevision)) {
    warnings.push({
      code: 'unusual-revision',
      message: `Peg revision "${definition.pegRevision}" is not a number, HEAD or a {date}.`,
    });
  }
  if (previous > 0) {
    warnings.push({
      code: 'duplicate-local-path',
      message: `Local path "${definition.localPath}" is used by more than one definition — Subversion will refuse this.`,
    });
  }

  lines.push({ kind: 'definition', raw: rawLine, definition, warnings });
}

function isRelativeFormUrl(url: string): boolean {
  return /^\.{1,2}\//.test(url);
}

/** Serialize one definition in the modern canonical layout. */
export function formatExternalDefinition(definition: SvnExternalDefinition): string {
  const url = definition.pegRevision
    ? `${definition.url}@${definition.pegRevision}`
    : definition.url;
  const revision = definition.operativeRevision ? ` -r ${definition.operativeRevision}` : '';
  return `${url}${revision} ${definition.localPath}`;
}

/**
 * Serialize parsed lines back to a property value. Definitions are rewritten
 * in canonical modern form (URL first); comment and blank lines are kept
 * verbatim so nothing the user wrote is lost on round-trip.
 */
export function formatSvnExternals(lines: readonly SvnExternalLine[]): string {
  return lines
    .map((line) => {
      switch (line.kind) {
        case 'definition':
          return formatExternalDefinition(line.definition);
        case 'comment':
        case 'blank':
          return line.raw;
        case 'invalid':
          return line.raw;
      }
    })
    .join('\n');
}

export interface ExternalFieldIssues {
  localPath: string[];
  url: string[];
  operativeRevision: string[];
  pegRevision: string[];
}

/** Per-field validation for the table editor cells. */
export function validateExternalFields(fields: {
  localPath: string;
  url: string;
  operativeRevision?: string;
  pegRevision?: string;
}): ExternalFieldIssues {
  const issues: ExternalFieldIssues = { localPath: [], url: [], operativeRevision: [], pegRevision: [] };
  const localCheck = isValidLocalPath(fields.localPath.trim());
  if (!localCheck.valid) issues.localPath.push(localCheck.reason ?? 'Invalid local path.');
  if (!isValidExternalUrl(fields.url.trim())) {
    issues.url.push(
      'Expected a URL (scheme://…, ^/…, //…, /… or ../…) without whitespace.'
    );
  }
  if (fields.operativeRevision && !isValidExternalRevision(fields.operativeRevision)) {
    issues.operativeRevision.push('Revision must be a number, HEAD or a {date}.');
  }
  if (fields.pegRevision && !isValidExternalRevision(fields.pegRevision)) {
    issues.pegRevision.push('Revision must be a number, HEAD or a {date}.');
  }
  return issues;
}
