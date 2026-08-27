import { runSvn } from './svn-executor';

/**
 * SVN client builds differ in which experimental commands they ship —
 * TortoiseSVN's CLI, for example, bundles no `shelve`/`unshelve` at all.
 * Its failure shapes vary too: `svn help shelve` exits 0 with only a
 * stderr note ("shelve": unknown command), while `shelve --list` fails
 * with `invalid option: --list` because the option parser runs before the
 * subcommand lookup. Shelving entry points probe this up front so they can
 * route straight to the portable-shelf store instead of spawning a command
 * that is guaranteed to fail. The probe is a cheap local `svn help`
 * (~tens of ms) run per operation — no cache, so a swapped client binary
 * takes effect immediately and tests stay isolated.
 */
const SHELVE_MISSING_PATTERN = /unknown (?:command|subcommand)|invalid option/i;

export async function isNativeShelvingSupported(): Promise<boolean> {
  try {
    // runSvn (not runSvnText) — a missing command can exit 0 with the
    // explanation on stderr, which stdout-only callers would read as success.
    const result = await runSvn(['help', 'shelve']);
    if (result.code === 0 && result.stdout.trim() && !result.stderr.trim()) {
      return true;
    }
    const message = `${result.stderr}\n${result.stdout}`;
    return !SHELVE_MISSING_PATTERN.test(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    // A failed `help shelve` only proves shelving is missing when svn itself
    // said so; any other failure (missing binary, broken PATH, timeout) stays
    // "supported" so the real command runs and its own error reporting applies.
    return !SHELVE_MISSING_PATTERN.test(message);
  }
}
