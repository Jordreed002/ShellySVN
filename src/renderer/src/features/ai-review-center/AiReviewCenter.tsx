import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronRight,
  Clipboard,
  Clock3,
  FileCode2,
  GitBranch,
  HelpCircle,
  History,
  Inbox,
  RotateCcw,
  SlidersHorizontal,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { exportReviewCenterMarkdown } from './reviewCenterStore';
import { useAiReviewCenter } from './useAiReviewCenter';
import { CommitStackPanel } from './CommitStackPanel';
import { RepositoryProfilePanel } from './RepositoryProfilePanel';
import { useFocusTrap } from '@renderer/hooks/useFocusTrap';

interface AiReviewCenterProps {
  workingCopyPath?: string;
  onClose: () => void;
}

type ReviewTab = 'open' | 'dismissed' | 'files' | 'groups' | 'questions' | 'runs' | 'profile';

const tabs: Array<{ id: ReviewTab; label: string; icon: typeof Inbox }> = [
  { id: 'open', label: 'Open', icon: Inbox },
  { id: 'dismissed', label: 'Dismissed', icon: Archive },
  { id: 'files', label: 'Files', icon: FileCode2 },
  { id: 'groups', label: 'Groups', icon: GitBranch },
  { id: 'questions', label: 'Questions', icon: HelpCircle },
  { id: 'runs', label: 'Runs', icon: History },
  { id: 'profile', label: 'Profile', icon: SlidersHorizontal },
];

function shortPath(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/');
  return parts.slice(-3).join('/');
}

function formatAge(timestamp: string): string {
  const elapsed = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return 'now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return `${Math.floor(elapsed / 86_400_000)}d`;
}

export function AiReviewCenter({ workingCopyPath, onClose }: AiReviewCenterProps) {
  const { workspace, isLoading, triageFinding, clear } = useAiReviewCenter(workingCopyPath);
  const [tab, setTab] = useState<ReviewTab>('open');
  const [activeIndex, setActiveIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const dialogRef = useFocusTrap<HTMLElement>({
    onEscape: onClose,
    returnFocus: false,
    preventScroll: true,
    initialFocus: closeButtonRef,
  });
  const openFindings = useMemo(
    () => workspace?.findings.filter((finding) => finding.state === 'open') ?? [],
    [workspace?.findings]
  );
  const dismissedFindings = useMemo(
    () => workspace?.findings.filter((finding) => finding.state === 'dismissed') ?? [],
    [workspace?.findings]
  );
  const visibleFindings = tab === 'dismissed' ? dismissedFindings : openFindings;

  useEffect(
    () => () => {
      returnFocusRef.current?.focus({ preventScroll: true });
    },
    []
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [tab]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (!typing && (event.key === 'j' || event.key === 'ArrowDown')) {
        event.preventDefault();
        if (visibleFindings.length > 0) {
          setActiveIndex((index) => Math.min(visibleFindings.length - 1, index + 1));
        }
      } else if (!typing && (event.key === 'k' || event.key === 'ArrowUp')) {
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 1));
      } else if (!typing && event.key.toLowerCase() === 'd' && visibleFindings[activeIndex]) {
        event.preventDefault();
        triageFinding(visibleFindings[activeIndex].id, tab === 'dismissed' ? 'open' : 'dismissed');
      } else if (!typing && /^[1-7]$/.test(event.key)) {
        event.preventDefault();
        setTab(tabs[Number(event.key) - 1].id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, onClose, tab, triageFinding, visibleFindings]);

  const copyReport = async () => {
    if (!workspace) return;
    await navigator.clipboard.writeText(exportReviewCenterMarkdown(workspace));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const currentRunChecksums = new Map<string, string>();
  for (const run of workspace?.runs ?? []) {
    if (!currentRunChecksums.has(run.kind)) currentRunChecksums.set(run.kind, run.checksum);
  }
  const staleRuns =
    workspace?.runs.filter((run) => currentRunChecksums.get(run.kind) !== run.checksum).length ?? 0;

  return (
    <div
      className="fixed inset-0 z-[90] flex justify-end overflow-y-auto overscroll-contain bg-black/35 backdrop-blur-[1px]"
      onMouseDown={onClose}
    >
      <aside
        ref={dialogRef}
        className="flex min-h-0 w-full max-w-[760px] flex-col border-l border-border-strong bg-bg shadow-2xl sm:h-full"
        role="dialog"
        aria-modal="true"
        aria-label="AI Review Center"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="relative overflow-hidden border-b border-border bg-bg-secondary px-5 pb-4 pt-5">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-56 opacity-[0.07] [background-image:repeating-linear-gradient(135deg,currentColor_0,currentColor_1px,transparent_1px,transparent_10px)]" />
          <div className="relative flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center border border-accent/40 bg-accent/10 text-accent">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-15 font-bold tracking-[-0.02em]">AI Review Center</h2>
                <span className="border border-border bg-bg px-1.5 py-0.5 font-mono text-9 uppercase tracking-[0.15em] text-text-muted">
                  advisory
                </span>
              </div>
              <p
                className="mt-1 truncate font-mono text-10 text-text-muted"
                title={workingCopyPath}
              >
                {workingCopyPath ? shortPath(workingCopyPath) : 'No working copy selected'}
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              className="ibtn"
              onClick={onClose}
              aria-label="Close AI Review Center"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="relative mt-4 grid grid-cols-3 gap-px overflow-hidden border border-border bg-border">
            <div className="bg-bg px-3 py-2">
              <span className="block font-mono text-9 uppercase tracking-wider text-text-faint">
                Open
              </span>
              <strong className="text-17 text-text">{openFindings.length}</strong>
            </div>
            <div className="bg-bg px-3 py-2">
              <span className="block font-mono text-9 uppercase tracking-wider text-text-faint">
                Files analyzed
              </span>
              <strong className="text-17 text-text">{workspace?.explanations.length ?? 0}</strong>
            </div>
            <div className="bg-bg px-3 py-2">
              <span className="block font-mono text-9 uppercase tracking-wider text-text-faint">
                Stale runs
              </span>
              <strong className={staleRuns ? 'text-17 text-svn-modified' : 'text-17 text-text'}>
                {staleRuns}
              </strong>
            </div>
          </div>
        </header>

        <nav
          className="flex min-h-11 overflow-x-auto border-b border-border bg-bg-secondary px-2"
          aria-label="Review categories"
          role="tablist"
        >
          {tabs.map(({ id, label, icon: Icon }, index) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex min-w-max items-center gap-1.5 border-b-2 px-3 text-11 font-semibold transition-fast ${
                tab === id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-muted hover:text-text'
              }`}
              aria-current={tab === id ? 'page' : undefined}
              aria-selected={tab === id}
              role="tab"
              id={`ai-review-tab-${id}`}
              aria-controls="ai-review-panel"
              aria-keyshortcuts={`${index + 1}`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>

        <div
          id="ai-review-panel"
          role="tabpanel"
          aria-labelledby={`ai-review-tab-${tab}`}
          className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(90deg,transparent_31px,var(--color-border-muted)_32px,transparent_33px)] px-3 py-4 sm:px-5"
        >
          {isLoading ? (
            <div className="space-y-2" aria-label="Loading review results">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-24 animate-pulse border border-border bg-bg-secondary motion-reduce:animate-none"
                />
              ))}
            </div>
          ) : !workingCopyPath ? (
            <EmptyState
              title="No working copy"
              detail="Open a working copy to inspect its AI review activity."
            />
          ) : tab === 'open' || tab === 'dismissed' ? (
            visibleFindings.length ? (
              <ol className="space-y-2">
                {visibleFindings.map((finding, index) => (
                  <li
                    key={finding.id}
                    className={`border bg-bg-secondary transition-fast ${index === activeIndex ? 'border-accent shadow-[inset_3px_0_0_var(--color-accent)]' : 'border-border'}`}
                  >
                    <div className="flex items-start gap-3 p-3">
                      <span
                        className={`mt-0.5 h-2.5 w-2.5 flex-shrink-0 ${finding.severity === 'danger' ? 'bg-svn-conflict' : finding.severity === 'warning' ? 'bg-svn-modified' : 'bg-accent'}`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-12.5 font-semibold text-text">{finding.title}</h3>
                          <span className="font-mono text-9 uppercase tracking-wider text-text-faint">
                            {finding.category}
                          </span>
                          <span className="font-mono text-9 uppercase tracking-wider text-text-muted">
                            {finding.severity} severity
                          </span>
                        </div>
                        <p className="mt-1 text-11.5 leading-relaxed text-text-secondary">
                          {finding.detail}
                        </p>
                        <Link
                          to="/files"
                          search={{ path: finding.filePath }}
                          className="mt-2 inline-flex max-w-full items-center gap-1 font-mono text-10 text-accent hover:underline"
                          title={finding.filePath}
                        >
                          <span className="truncate">
                            {shortPath(finding.filePath)}
                            {finding.line > 0 ? `:${finding.line}` : ''}
                          </span>
                          <ChevronRight className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                        </Link>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm gap-1"
                        onClick={() =>
                          triageFinding(finding.id, tab === 'dismissed' ? 'open' : 'dismissed')
                        }
                      >
                        {tab === 'dismissed' ? (
                          <RotateCcw className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <Check className="h-3 w-3" aria-hidden="true" />
                        )}
                        {tab === 'dismissed' ? 'Restore' : 'Dismiss'}
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                title={tab === 'open' ? 'Review queue clear' : 'No dismissed findings'}
                detail={
                  tab === 'open'
                    ? 'Run Review selected changes from the commit window to populate this queue.'
                    : 'Dismissed review observations remain available here.'
                }
              />
            )
          ) : tab === 'files' ? (
            workspace?.explanations.length ? (
              <div className="space-y-2">
                {workspace.explanations.map((item) => (
                  <article key={item.id} className="border border-border bg-bg-secondary p-3">
                    <div className="flex items-center gap-2">
                      <FileCode2 className="h-4 w-4 text-accent" aria-hidden="true" />
                      <h3
                        className="min-w-0 flex-1 truncate font-mono text-11 font-semibold"
                        title={item.filePath}
                      >
                        {shortPath(item.filePath)}
                      </h3>
                      <Freshness
                        current={
                          workspace.explanations.find(
                            (candidate) => candidate.filePath === item.filePath
                          )?.checksum === item.checksum
                        }
                      />
                    </div>
                    <p className="mt-2 text-12 text-text-secondary">{item.summary}</p>
                    {item.risks.length > 0 && (
                      <p className="mt-2 text-10.5 text-svn-modified">
                        {item.risks.length} risk signal{item.risks.length === 1 ? '' : 's'}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No file explanations"
                detail="Explain a file from the commit diff preview to retain its summary here."
              />
            )
          ) : tab === 'groups' ? (
            workingCopyPath ? (
              <CommitStackPanel workingCopyPath={workingCopyPath} />
            ) : (
              <EmptyState
                title="No working copy"
                detail="Open a working copy to use its commit stack."
              />
            )
          ) : tab === 'questions' ? (
            workspace?.questions.length ? (
              <ol className="space-y-2">
                {workspace.questions.map((question, index) => (
                  <li
                    key={question}
                    className="flex gap-3 border border-border bg-bg-secondary p-3"
                  >
                    <span className="font-mono text-9 text-accent">Q{index + 1}</span>
                    <p className="text-12 text-text-secondary">{question}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                title="No unresolved questions"
                detail="Review questions from per-file analysis collect here."
              />
            )
          ) : tab === 'profile' ? (
            workingCopyPath ? (
              <RepositoryProfilePanel workingCopyPath={workingCopyPath} />
            ) : (
              <EmptyState
                title="No working copy"
                detail="Open a working copy to configure its AI profile."
              />
            )
          ) : workspace?.runs.length ? (
            <ol className="divide-y divide-border border border-border bg-bg-secondary">
              {workspace.runs.map((run) => (
                <li
                  key={run.id}
                  className="grid grid-cols-[18px_minmax(0,1fr)_auto] gap-2 px-3 py-2.5"
                >
                  <Clock3 className="mt-0.5 h-3.5 w-3.5 text-text-faint" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-9 uppercase tracking-wider text-accent">
                        {run.kind}
                      </span>
                      <Freshness current={currentRunChecksums.get(run.kind) === run.checksum} />
                    </div>
                    <p className="mt-0.5 truncate text-11.5 text-text-secondary">{run.summary}</p>
                  </div>
                  <div className="text-right font-mono text-9.5 text-text-faint">
                    <span>{formatAge(run.createdAt)}</span>
                    <span className="block">
                      {run.provider}
                      {run.model ? `/${run.model}` : ''} · {(run.durationMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="No previous runs"
              detail="Review, planning, and explanation runs appear here without storing prompts or diffs."
            />
          )}
        </div>

        <footer className="flex min-h-12 flex-wrap items-center gap-2 border-t border-border bg-bg-secondary px-4 py-2">
          <span className="hidden font-mono text-9.5 text-text-faint sm:inline">
            J/K navigate · D triage · Esc close
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm ml-auto gap-1"
            onClick={() => void clear()}
            disabled={!workspace?.runs.length}
            title="Clear locally saved review results"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            Clear
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm gap-1"
            onClick={() => void copyReport()}
            disabled={!workspace}
          >
            <Clipboard className="h-3 w-3" aria-hidden="true" />
            {copied ? 'Copied' : 'Copy Markdown'}
          </button>
          <span className="sr-only" aria-live="polite">
            {copied ? 'Review report copied to clipboard' : ''}
          </span>
        </footer>
      </aside>
    </div>
  );
}

function Freshness({ current }: { current: boolean }) {
  return (
    <span
      className={`border px-1 py-0.5 font-mono text-8 uppercase tracking-wider ${current ? 'border-svn-normal/30 text-svn-normal' : 'border-svn-modified/30 text-svn-modified'}`}
    >
      {current ? 'current' : 'stale'}
    </span>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="grid min-h-52 place-items-center border border-dashed border-border-strong bg-bg-secondary/60 p-8 text-center">
      <div>
        <AlertTriangle className="mx-auto h-5 w-5 text-text-faint" aria-hidden="true" />
        <h3 className="mt-3 text-13 font-semibold">{title}</h3>
        <p className="mx-auto mt-1 max-w-sm text-11.5 leading-relaxed text-text-muted">{detail}</p>
      </div>
    </div>
  );
}

export default AiReviewCenter;
