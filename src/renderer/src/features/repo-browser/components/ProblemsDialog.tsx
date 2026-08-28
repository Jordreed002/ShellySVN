import type { ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileWarning,
  Lock,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import {
  AccessibleDialog,
  AccessibleDialogBody,
  AccessibleDialogFooter,
} from '@renderer/components/AccessibleDialog';
import type { ProblemKind, RepoProblem } from '../types';

/**
 * ProblemsDialog — the states that stop work and never explain themselves.
 *
 * SPEC rule 4: tree conflicts, needs-cleanup, stale locks and floating
 * externals get **cause, consequence and the exact command**. Each entry here
 * therefore has four parts, in that order, and the command is verbatim and
 * copyable — never paraphrased, never hidden behind a button whose effect you
 * cannot predict.
 */

/**
 * Kind-level primer. `RepoProblem.explanation` says what happened to *this*
 * path; these two lines say what the state *is*, for someone meeting it for
 * the first time.
 */
interface KindPrimer {
  /** Why Subversion put the working copy in this state. */
  cause: string;
  /** What it stops you doing until it is cleared. */
  consequence: string;
  icon: ReactNode;
}

const KIND_PRIMER: Record<ProblemKind, KindPrimer> = {
  'tree-conflict': {
    cause:
      'A structural change here met a different structural change on the server — a delete against an edit, a rename against a rename. Subversion cannot reconcile "this file should not exist" with "this file changed", so it stopped and recorded both intentions.',
    consequence:
      'The path stays conflicted and the working copy refuses to commit until you say which intention wins. This is not a text conflict: there are no conflict markers and no merge editor will help. It needs a decision.',
    icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
  },
  'text-conflict': {
    cause:
      'Two revisions changed the same lines of the same file, so `svn update` or `svn merge` could not pick a winner and wrote both versions into the file between conflict markers.',
    consequence:
      'The file on disk currently contains markers rather than working code, and commit is refused for that path until it is resolved.',
    icon: <FileWarning className="h-4 w-4" aria-hidden="true" />,
  },
  missing: {
    cause:
      'This versioned path is recorded in the working copy metadata but is no longer present on disk.',
    consequence:
      'Restore it with revert, or schedule its deletion explicitly. If it was deleted upstream, update the working copy to reconcile that repository change.',
    icon: <FileWarning className="h-4 w-4" aria-hidden="true" />,
  },
  'needs-cleanup': {
    cause:
      'An operation — an update, a commit, a switch — was interrupted part-way through. Subversion takes an internal lock on the working copy before it starts writing, and it never got to release it.',
    consequence:
      'Nothing is lost and nothing is broken. But until that lock is cleared, every subsequent operation on this working copy refuses to start, with a message about the copy being locked. `svn cleanup` releases it and finishes or rolls back the interrupted work.',
    icon: <RefreshCw className="h-4 w-4" aria-hidden="true" />,
  },
  'stale-lock': {
    cause:
      'Someone took an `svn lock` on this path — usually on a binary that cannot be merged — and never released it. Subversion locks never expire on their own; there is no timeout.',
    consequence:
      'Nobody else can commit that path while the lock stands. If it was forgotten rather than deliberate, breaking it is safe: the holder is told the next time they update.',
    icon: <Lock className="h-4 w-4" aria-hidden="true" />,
  },
  'floating-external': {
    cause:
      'An `svn:externals` definition points at a path with no peg revision (`@rev`), so it always resolves to whatever HEAD happens to be at the moment you update.',
    consequence:
      'Every update can silently change the external, which means two checkouts of the same revision can produce different builds. Pin it to a revision or a tag and the checkout becomes reproducible again.',
    icon: <ExternalLink className="h-4 w-4" aria-hidden="true" />,
  },
  'out-of-date': {
    cause:
      'The server has revisions for this path that your BASE revision does not. Subversion refuses to commit on top of changes you have never seen.',
    consequence:
      'Commit is rejected with "File or directory is out of date". Update first, resolve anything that conflicts, then commit.',
    icon: <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />,
  },
};

const KIND_LABEL: Record<ProblemKind, string> = {
  'tree-conflict': 'Tree conflict',
  'text-conflict': 'Text conflict',
  missing: 'Missing',
  'needs-cleanup': 'Needs cleanup',
  'stale-lock': 'Stale lock',
  'floating-external': 'Floating external',
  'out-of-date': 'Out of date',
};

const SEVERITY_STYLE: Record<
  RepoProblem['severity'],
  { card: string; icon: string; chip: string; label: string }
> = {
  blocking: {
    card: 'border-svn-conflict/50 bg-svn-conflict/10',
    icon: 'text-svn-conflict',
    chip: 'bg-svn-conflict/20 text-svn-conflict',
    label: 'Blocking',
  },
  warning: {
    card: 'border-svn-modified/50 bg-svn-modified/10',
    icon: 'text-svn-modified',
    chip: 'bg-svn-modified/20 text-svn-modified',
    label: 'Warning',
  },
  advisory: {
    card: 'border-border bg-bg-tertiary/40',
    icon: 'text-text-muted',
    chip: 'bg-bg-elevated text-text-secondary',
    label: 'Advisory',
  },
};

export interface ProblemsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Everything `svn status`, `svn info` and the externals scan found wrong. */
  problems: RepoProblem[];
  /** Run the listed command for one problem. Omit to make the list read-only. */
  onFixProblem?: (problem: RepoProblem) => void;
  /** Copy a command verbatim to the clipboard. Omit to hide the copy buttons. */
  onCopyCommand?: (command: string) => void;
  /**
   * Run the commands that cannot lose work — `svn cleanup`, pinning an
   * external. Never offered for conflicts, which require a decision.
   */
  onFixSafe?: () => void;
  /** How many problems `onFixSafe` would clear. */
  safeFixCount?: number;
  /** Reveal a problem's path in the browser behind the dialog. */
  onRevealPath?: (path: string) => void;
  isFixing?: boolean;
}

function ProblemCard({
  problem,
  onFixProblem,
  onCopyCommand,
  onRevealPath,
  isFixing,
}: {
  problem: RepoProblem;
  onFixProblem?: (problem: RepoProblem) => void;
  onCopyCommand?: (command: string) => void;
  onRevealPath?: (path: string) => void;
  isFixing: boolean;
}) {
  const primer = KIND_PRIMER[problem.kind];
  const style = SEVERITY_STYLE[problem.severity];

  return (
    <li className={`mb-2 flex items-start gap-2.5 rounded-xl border p-3 ${style.card}`}>
      <span className={`mt-0.5 flex-none ${style.icon}`}>{primer.icon}</span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-[13px] font-bold text-text">{problem.title}</b>
          <span className={`badge ${style.chip}`}>{style.label}</span>
          <span className="badge bg-bg-elevated text-text-secondary">
            {KIND_LABEL[problem.kind]}
          </span>
        </div>

        {onRevealPath ? (
          <button
            type="button"
            onClick={() => onRevealPath(problem.path)}
            className="mt-1 block max-w-full truncate font-mono text-[11px] text-text-muted hover:text-accent"
            style={{ direction: 'rtl', textAlign: 'left' }}
            title={`Show ${problem.path} in the browser`}
          >
            <bdi>{problem.path}</bdi>
          </button>
        ) : (
          <p
            className="mt-1 max-w-full truncate font-mono text-[11px] text-text-muted"
            style={{ direction: 'rtl', textAlign: 'left' }}
            title={problem.path}
          >
            <bdi>{problem.path}</bdi>
          </p>
        )}

        <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">{problem.explanation}</p>

        <dl className="mt-2 space-y-1.5 text-xs leading-relaxed">
          <div>
            <dt className="text-2xs font-bold uppercase tracking-wide text-text-faint">Cause</dt>
            <dd className="text-text-secondary">{primer.cause}</dd>
          </div>
          <div>
            <dt className="text-2xs font-bold uppercase tracking-wide text-text-faint">
              Consequence
            </dt>
            <dd className="text-text-secondary">{primer.consequence}</dd>
          </div>
        </dl>

        <div className="mt-2.5 flex items-center gap-2">
          <code className="min-w-0 flex-1 whitespace-pre-wrap break-all rounded-md border border-border-muted bg-bg px-2 py-1.5 font-mono text-[11px] leading-relaxed text-text">
            {problem.command}
          </code>
          {onCopyCommand && (
            <button
              type="button"
              onClick={() => onCopyCommand(problem.command)}
              className="btn-icon-sm flex-none"
              aria-label={`Copy command for ${problem.title}`}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {onFixProblem && (
            <button
              type="button"
              onClick={() => onFixProblem(problem)}
              disabled={isFixing}
              className="btn btn-sm btn-secondary flex-none"
            >
              <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
              Run
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function ProblemsDialog({
  isOpen,
  onClose,
  problems,
  onFixProblem,
  onCopyCommand,
  onFixSafe,
  safeFixCount = 0,
  onRevealPath,
  isFixing = false,
}: ProblemsDialogProps) {
  const count = problems.length;
  const title =
    count === 0
      ? 'Nothing needs attention'
      : count === 1
        ? 'One thing needs attention'
        : `${count} things need attention`;

  /* The tile takes the colour of the worst thing inside, so the header does not
     read as neutral information while a conflict is blocking your commit. */
  const worstSeverity = problems.some((problem) => problem.severity === 'blocking')
    ? 'danger'
    : count > 0
      ? 'warning'
      : 'accent';

  return (
    <AccessibleDialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon={count === 0 ? CheckCircle2 : AlertTriangle}
      tone={worstSeverity}
      size="lg"
      description="Working-copy problems, each with its cause, its consequence and the exact command that clears it."
    >
      <AccessibleDialogBody>
        <p className="mb-4 text-xs leading-relaxed text-text-secondary">
          The states that stop work and rarely explain themselves. Each says what it is, what caused
          it, and the command that clears it. Nothing here runs on its own.
        </p>

        {count === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-bg-tertiary/40 p-4">
            <CheckCircle2 className="h-5 w-5 flex-none text-svn-normal" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-text-secondary">
              No tree conflicts, no working-copy lock, no stale locks and no floating externals.
              Checked when the working copy is opened and after every operation.
            </p>
          </div>
        ) : (
          <ul className="list-none">
            {problems.map((problem) => (
              <ProblemCard
                key={`${problem.kind}:${problem.path}`}
                problem={problem}
                onFixProblem={onFixProblem}
                onCopyCommand={onCopyCommand}
                onRevealPath={onRevealPath}
                isFixing={isFixing}
              />
            ))}
          </ul>
        )}
      </AccessibleDialogBody>

      <AccessibleDialogFooter>
        <span className="mr-auto text-2xs text-text-muted">
          Checked when a working copy is opened and after every operation.
        </span>
        <button type="button" onClick={onClose} className="btn btn-secondary">
          Close
        </button>
        {onFixSafe && safeFixCount > 0 && (
          <button
            type="button"
            onClick={onFixSafe}
            disabled={isFixing}
            aria-busy={isFixing}
            className="btn btn-primary"
          >
            <Wrench className="h-4 w-4" aria-hidden="true" />
            {isFixing
              ? 'Running…'
              : `Fix the ${safeFixCount} safe ${safeFixCount === 1 ? 'one' : 'ones'}`}
          </button>
        )}
      </AccessibleDialogFooter>
    </AccessibleDialog>
  );
}

export default ProblemsDialog;
