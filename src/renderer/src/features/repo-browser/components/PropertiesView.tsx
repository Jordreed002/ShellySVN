/**
 * `svn proplist -v` for the selected path.
 *
 * Properties are where Subversion hides the decisions that later bite:
 * `svn:externals` without a peg revision silently re-points at whatever HEAD
 * happens to be, so two people checking out the same revision get different
 * code; `svn:needs-lock` is why a file is read-only on disk. Those get flagged
 * inline with cause and consequence, per the spec's "explain the ugly states".
 *
 * Presentational only: properties arrive via props.
 */

import { AlertTriangle, FileCode, Loader2, ShieldAlert } from 'lucide-react';
import { DetailMessage, useRepoBrowserRetry } from './RepoDetailPane';

/** One property as returned by `svn proplist -v` / `svn propget`. */
export interface SvnPropertyEntry {
  /** Property name, e.g. `svn:externals`, `bugtraq:url`. */
  name: string;
  /** Raw value, newlines preserved — `svn:externals` is multi-line. */
  value: string;
}

/** A problem found in a property value, ready to render beside it. */
export interface PropertyWarning {
  /** The line the warning is about, quoted verbatim. */
  subject: string;
  title: string;
  /** Cause and consequence, in one sentence a newcomer can act on. */
  explanation: string;
  /** The exact command that fixes it. */
  command: string;
}

/**
 * An `svn:externals` definition is reproducible only when it pins a revision —
 * `^/vendor/plex-fonts@2413 vendor`, or an explicit `-r 2413`. Without one it
 * floats to HEAD of the target.
 *
 * Pure and exported so the route, the problems panel and tests agree on what
 * "floating" means.
 */
export function isFloatingExternal(line: string): boolean {
  const definition = line.trim();
  if (definition === '' || definition.startsWith('#')) return false;
  if (/(^|\s)-r\s*\d+(\s|$)/.test(definition)) return false;
  // A peg revision is `@REV` on the URL token, not a bare `@` in a path.
  return !/@\S+(\s|$)/.test(definition);
}

/** Inspect a property value and return anything that will hurt later. */
export function analyseProperty(property: SvnPropertyEntry): PropertyWarning[] {
  if (property.name !== 'svn:externals') return [];

  return property.value
    .split('\n')
    .filter((line) => isFloatingExternal(line))
    .map((line) => ({
      subject: line.trim(),
      title: 'Floating external — no peg revision',
      explanation:
        'This external tracks HEAD of its target, so the checkout is not reproducible: the same repository revision can pull different content tomorrow, and a build that passed today can fail with nothing changed here. Pin it with @REV.',
      command: 'svn propedit svn:externals <path>   # add @REV to the URL',
    }));
}

/** Short, plain-language note for the properties whose effects surprise people. */
const PROPERTY_NOTES: Record<string, string> = {
  'svn:needs-lock':
    'The file is read-only on disk until you run svn lock — that is the property working, not a permissions fault.',
  'svn:eol-style':
    'Line endings are translated on checkout and commit; a mismatch here is the usual cause of whole-file diffs.',
  'svn:mime-type':
    'A non-text MIME type makes Subversion treat the file as binary: no line diffs, no merging.',
  'svn:ignore': 'Listed patterns stay unversioned; svn status will not report them.',
  'svn:global-ignores':
    'Inherited by descendants — unlike svn:ignore, which applies to one directory.',
};

export interface PropertiesViewProps {
  properties: readonly SvnPropertyEntry[];
  /** Path the properties belong to, used in the empty state. */
  path?: string;
  loading?: boolean;
  error?: string | null;
  /**
   * Retry the failed read. Defaults to invalidating the feature's query family;
   * callers with a narrower refetcher should pass it.
   */
  onRetry?: () => void;
  className?: string;
}

export function PropertiesView({
  properties,
  path,
  loading = false,
  error = null,
  onRetry,
  className = '',
}: PropertiesViewProps): React.JSX.Element {
  const retryDefault = useRepoBrowserRetry();

  if (loading) {
    return <DetailMessage icon={Loader2} title="Running svn proplist -v…" busy />;
  }

  if (error) {
    return (
      <DetailMessage
        icon={AlertTriangle}
        tone="error"
        title="svn proplist failed"
        detail={error}
        onRetry={onRetry ?? retryDefault}
      />
    );
  }

  if (properties.length === 0) {
    return (
      <DetailMessage
        icon={FileCode}
        title="No properties set"
        detail={
          <>
            {path ? <b className="font-mono">{path}</b> : 'This path'} carries no Subversion
            properties of its own. Properties are not inherited from the parent directory unless
            they are inheritable ones such as <span className="font-mono">svn:global-ignores</span>.
          </>
        }
        command={path ? `svn proplist -v "${path}"` : 'svn proplist -v'}
      />
    );
  }

  return (
    <div className={`font-mono text-[11.5px] leading-[1.65] ${className}`}>
      <dl className="divide-y divide-border-muted">
        {properties.map((property) => {
          const warnings = analyseProperty(property);
          const note = PROPERTY_NOTES[property.name];
          return (
            <div key={property.name} className="px-3 py-2">
              <dt className="text-accent">{property.name}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap break-words text-text">
                {property.value.trim() === '' ? (
                  <span className="italic text-text-muted">(empty)</span>
                ) : (
                  property.value
                )}
              </dd>

              {note ? (
                <p className="mt-1 font-sans text-2xs leading-relaxed text-text-muted">{note}</p>
              ) : null}

              {warnings.map((warning) => (
                <div
                  key={warning.subject}
                  className="mt-1.5 flex items-start gap-2 rounded-md border border-svn-modified/50 bg-svn-modified/10 px-2 py-1.5"
                >
                  <ShieldAlert
                    className="mt-0.5 h-3.5 w-3.5 flex-none text-svn-modified"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 font-sans text-2xs leading-relaxed">
                    <p className="font-bold text-text">{warning.title}</p>
                    <p className="mt-0.5 break-words font-mono text-text-secondary">
                      {warning.subject}
                    </p>
                    <p className="mt-0.5 text-text-secondary">{warning.explanation}</p>
                    <code className="mt-1 block break-words font-mono text-text-muted">
                      {warning.command}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </dl>
    </div>
  );
}
