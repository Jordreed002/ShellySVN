/**
 * Target escaping for every `svn` invocation that receives positional
 * targets (working-copy paths or repository URLs).
 *
 * Two argv-level ambiguities must be neutralized for every multi-target op:
 *
 * 1. Option-like targets — a file named `-file` or `--force` would otherwise
 *    be consumed as an svn option. `withSvnTargets` always inserts the `--`
 *    option terminator before the first target.
 * 2. Peg-revision syntax — svn splits every target at its last `@` and tries
 *    to read the tail as a peg revision (`name@rev`). A file named `pic@2.png`
 *    therefore needs an explicit empty peg appended (`pic@2.png@`), unless the
 *    tail already is the peg the caller intended (`trunk@42`) or the `@` can
 *    never form a peg tail (confined to a URL's `user@host` authority).
 */

export function validateSvnTargets(targets: string[], label = 'SVN target'): void {
  if (targets.length === 0) throw new Error(`At least one ${label.toLowerCase()} is required`);
  for (const target of targets) {
    if (!target.trim()) throw new Error(`${label} must not be empty`);
    if (/[\u0000\r\n]/.test(target))
      throw new Error(`${label} contains invalid control characters`);
  }
}

const SVN_URL_TARGET = /^(?:https?|svn(?:\+ssh)?|file):\/\//i;
// What svn accepts as an explicit peg/operative revision specifier. ASCII
// digits only — `\d` never matches non-ASCII decimal digits, so locale
// digit forms are rejected instead of silently changing meaning.
const PEG_REVISION = /^(?:\d+|HEAD|BASE|COMMITTED|PREV|\{[^{}\r\n]+\})$/i;

/**
 * End index (exclusive) of the authority component (`user@host:port`) of a
 * URL-shaped target, located with generic RFC 3986 syntax so the scan works
 * for every svn scheme — including ones `new URL` cannot parse.
 */
function urlAuthorityEnd(target: string): number {
  const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.exec(target);
  if (!scheme) return -1;
  const authorityStart = scheme[0].length;
  const delimiter = target.slice(authorityStart).search(/[/?#]/);
  return delimiter === -1 ? target.length : authorityStart + delimiter;
}

/**
 * Append empty-peg escapes so no `@` inside a filename can be parsed as a
 * peg revision:
 * - targets without `@`, and targets already carrying an explicit (possibly
 *   empty) trailing peg, pass through unchanged;
 * - URL targets whose `@` characters are all confined to the authority
 *   (`svn+ssh://user@host/...`) pass through unchanged;
 * - URL targets that already end in an explicit peg (`...trunk@42`,
 *   `...trunk@{2020-01-01}`) keep it;
 * - anything else — local paths with `@` (`pic@2.png`), URLs with `@` in the
 *   path, query or fragment with a non-peg tail, and malformed URL-shaped
 *   strings — gets a trailing `@` (empty peg), which svn always reads as
 *   "default revision for this target".
 */
export function escapeLocalPegTargets(targets: string[]): string[] {
  return targets.map((target) => {
    if (!target.includes('@') || target.endsWith('@')) return target;

    if (SVN_URL_TARGET.test(target)) {
      const authorityEnd = urlAuthorityEnd(target);
      if (authorityEnd > 0 && target.indexOf('@', authorityEnd) === -1) return target;
      const tail = target.slice(target.lastIndexOf('@') + 1);
      if (PEG_REVISION.test(tail)) return target;
    }

    return `${target}@`;
  });
}

/** Append positional targets after SVN's option terminator. */
export function withSvnTargets(args: string[], targets: string[]): string[] {
  return [...args, '--', ...escapeLocalPegTargets(targets)];
}
