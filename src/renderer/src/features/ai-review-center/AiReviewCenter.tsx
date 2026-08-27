import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  Archive,
  Check,
  CheckCheck,
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
  Undo2,
  X,
} from 'lucide-react';
import { exportReviewCenterMarkdown } from './reviewCenterStore';
import { useAiReviewCenter } from './useAiReviewCenter';
import { CommitStackPanel } from './CommitStackPanel';
import { ConsentToggle } from './ConsentToggle';
import { RepositoryProfilePanel } from './RepositoryProfilePanel';
import { ReviewEmptyState } from './ReviewEmptyState';
import { AiRichText } from '@renderer/components/ai/AiRichText';
import { useFocusTrap } from '@renderer/hooks/useFocusTrap';
import type { ReviewCenterWorkspace } from './types';

interface AiReviewCenterProps {
  workingCopyPath?: string;
  onClose: () => void;
}

type ReviewTab = 'open' | 'dismissed' | 'files' | 'groups' | 'questions' | 'runs' | 'profile';

/** Chip filter keys (#112); "critical" renders the shared `danger` severity. */
type SeverityFilter = 'critical' | 'warning' | 'info';

const SEVERITY_FILTERS: Array<{
  id: SeverityFilter;
  label: string;
  severity: 'danger' | 'warning' | 'info';
}> = [
  { id: 'critical', label: 'Critical', severity: 'danger' },
  { id: 'warning', label: 'Warning', severity: 'warning' },
  { id: 'info', label: 'Info', severity: 'info' },
];

/** One palette for a severity: its filter chip, card dot, border and pill. */
const SEVERITY_TONE: Record<
  'danger' | 'warning' | 'info',
  { label: string; chip: string; dot: string; border: string }
> = {
  danger: {
    label: 'critical',
    chip: 'border-error/40 bg-error/10 text-error',
    dot: 'bg-error',
    border: 'border-error/25',
  },
  warning: {
    label: 'warning',
    chip: 'border-warning/40 bg-warning/10 text-warning',
    dot: 'bg-warning',
    border: 'border-warning/25',
  },
  info: {
    label: 'info',
    chip: 'border-accent/40 bg-accent/10 text-accent',
    dot: 'bg-accent',
    border: 'border-border',
  },
};

const ALL_SEVERITY_FILTERS = new Set<SeverityFilter>(['critical', 'warning', 'info']);
const UNDO_WINDOW_MS = 12_000;

const tabs: Array<{ id: ReviewTab; label: string; icon: typeof Inbox }> = [
  { id: 'open', label: 'Open', icon: Inbox },
  { id: 'dismissed', label: 'Triaged', icon: Archive },
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

interface UndoEntry {
  snapshot: ReviewCenterWorkspace;
  label: string;
}

export function AiReviewCenter({ workingCopyPath, onClose }: AiReviewCenterProps) {
  const { workspace, isLoading, triageFinding, triageFindings, restoreWorkspace, clear } =
    useAiReviewCenter(workingCopyPath);
  const [tab, setTab] = useState<ReviewTab>('open');
  const [activeIndex, setActiveIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [severityFilters, setSeverityFilters] =
    useState<ReadonlySet<SeverityFilter>>(ALL_SEVERITY_FILTERS);
  const [undo, setUndo] = useState<UndoEntry | null>(null);
  const undoTimerRef = useRef<number | null>(null);
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
  const triagedFindings = useMemo(
    () => workspace?.findings.filter((finding) => finding.state !== 'open') ?? [],
    [workspace?.findings]
  );
  const baseFindings = tab === 'open' ? openFindings : triagedFindings;
  const severityCounts = useMemo(() => {
    const counts = new Map<SeverityFilter, number>([
      ['critical', 0],
      ['warning', 0],
      ['info', 0],
    ]);
    for (const finding of baseFindings) {
      const key: SeverityFilter =
        finding.severity === 'danger' ? 'critical' : (finding.severity as 'warning' | 'info');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [baseFindings]);
  const visibleFindings = useMemo(
    () =>
      baseFindings.filter((finding) =>
        severityFilters.has(
          finding.severity === 'danger' ? 'critical' : (finding.severity as 'warning' | 'info')
        )
      ),
    [baseFindings, severityFilters]
  );

  useEffect(
    () => () => {
      returnFocusRef.current?.focus({ preventScroll: true });
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
    },
    []
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [tab]);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, visibleFindings.length - 1)));
  }, [visibleFindings.length]);

  const snapshotForUndo = useCallback(
    (label: string) => {
      if (!workspace) return;
      setUndo({ snapshot: workspace, label });
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = window.setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    },
    [workspace]
  );

  const runUndo = useCallback(() => {
    if (!undo) return;
    restoreWorkspace(undo.snapshot);
    setUndo(null);
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, [restoreWorkspace, undo]);

  const toggleSeverityFilter = (filter: SeverityFilter) => {
    setSeverityFilters((current) => {
      const next = new Set(current);
      if (next.has(filter)) {
        // Never allow an empty filter set — that hides everything.
        if (next.size > 1) next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  };

  const triageOne = useCallback(
    (id: string, state: 'accepted' | 'dismissed' | 'open') => {
      snapshotForUndo(
        state === 'accepted'
          ? 'Accepted 1 finding'
          : state === 'dismissed'
            ? 'Dismissed 1 finding'
            : 'Restored 1 finding'
      );
      triageFinding(id, state);
    },
    [snapshotForUndo, triageFinding]
  );

  const bulkTriage = useCallback(
    (state: 'accepted' | 'dismissed' | 'open') => {
      const ids = visibleFindings.map((finding) => finding.id);
      if (ids.length === 0) return;
      snapshotForUndo(
        state === 'accepted'
          ? `Accepted ${ids.length} findings`
          : state === 'dismissed'
            ? `Dismissed ${ids.length} findings`
            : `Restored ${ids.length} findings`
      );
      triageFindings(ids, state);
    },
    [snapshotForUndo, triageFindings, visibleFindings]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable === true;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (key === 'j' || key === 'ArrowDown') {
        event.preventDefault();
        if (visibleFindings.length > 0) {
          setActiveIndex((index) => Math.min(visibleFindings.length - 1, index + 1));
        }
      } else if (key === 'k' || key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 1));
      } else if (key === 'u' || key === 'U') {
        if (undo) {
          event.preventDefault();
          runUndo();
        }
      } else if (key === 'a' && tab === 'open' && visibleFindings[activeIndex]) {
        event.preventDefault();
        triageOne(visibleFindings[activeIndex]!.id, 'accepted');
      } else if (key === 'A' && tab === 'open') {
        event.preventDefault();
        bulkTriage('accepted');
      } else if (key === 'd' && visibleFindings[activeIndex]) {
        event.preventDefault();
        triageOne(visibleFindings[activeIndex]!.id, tab === 'open' ? 'dismissed' : 'open');
      } else if (key === 'D') {
        event.preventDefault();
        bulkTriage(tab === 'open' ? 'dismissed' : 'open');
      } else if (/^[1-7]$/.test(key)) {
        event.preventDefault();
        setTab(tabs[Number(key) - 1]!.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeIndex,
    onClose,
    tab,
    triageFinding,
    triageFindings,
    restoreWorkspace,
    visibleFindings,
    undo,
    workspace,
    triageOne,
    bulkTriage,
    runUndo,
  ]);

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

  /** Per-tab counts, so the header needs no separate stat band (#112 UI). */
  const tabCounts: Partial<Record<ReviewTab, number>> = {
    open: openFindings.length,
    dismissed: triagedFindings.length,
    files: workspace?.explanations.length ?? 0,
    questions: workspace?.questions.length ?? 0,
    runs: workspace?.runs.length ?? 0,
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex justify-end bg-black/45 backdrop-blur-[2px]"
      onMouseDown={onClose}
    >
      <aside
        ref={dialogRef}
        className="flex h-full min-h-0 w-full max-w-[780px] flex-col border-l border-border-strong bg-bg shadow-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="AI Review Center"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex-shrink-0 border-b border-border bg-bg-secondary/60 px-5 pb-3.5 pt-4">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-10 border border-accent/25 bg-accent/10 text-accent">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-15 font-semibold tracking-[-0.01em] text-text">
                  AI Review Center
                </h2>
                <span
                  className="rounded-pill border border-border bg-bg-sunk px-2 py-0.5 text-9.5 font-medium text-text-muted"
                  title="Findings here never block a commit"
                >
                  Advisory
                </span>
                {staleRuns > 0 && (
                  <span
                    className="rounded-pill border border-warning/40 bg-warning/10 px-2 py-0.5 text-9.5 font-medium text-warning"
                    title="Some results were produced from a different set of changes"
                  >
                    {staleRuns} stale
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-10.5 text-text-faint" title={workingCopyPath}>
                {workingCopyPath ? shortPath(workingCopyPath) : 'No working copy selected'}
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              className="btn-icon-sm -mr-1 -mt-1 flex-shrink-0"
              onClick={onClose}
              aria-label="Close AI Review Center"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {workingCopyPath && (
            <div className="mt-3">
              <ConsentToggle workingCopyPath={workingCopyPath} />
            </div>
          )}
        </header>

        <nav
          className="flex flex-shrink-0 gap-0.5 overflow-x-auto border-b border-border bg-bg-secondary/60 px-3 scrollbar-overlay"
          aria-label="Review categories"
          role="tablist"
        >
          {tabs.map(({ id, label, icon: Icon }, index) => {
            const active = tab === id;
            const count = tabCounts[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`relative flex min-w-max items-center gap-1.5 px-2.5 py-2.5 text-11.5 font-semibold transition-fast ${
                  active ? 'text-accent' : 'text-text-muted hover:text-text'
                }`}
                aria-current={active ? 'page' : undefined}
                aria-selected={active}
                role="tab"
                id={`ai-review-tab-${id}`}
                aria-controls="ai-review-panel"
                aria-keyshortcuts={`${index + 1}`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
                {count ? (
                  <span
                    className={`rounded-pill px-1.5 font-mono text-9.5 leading-4 ${
                      active ? 'bg-accent/15 text-accent' : 'bg-bg-sunk text-text-faint'
                    }`}
                  >
                    {count}
                  </span>
                ) : null}
                {active && (
                  <span
                    className="absolute inset-x-1.5 bottom-0 h-[2px] rounded-full bg-accent"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div
          id="ai-review-panel"
          role="tabpanel"
          aria-labelledby={`ai-review-tab-${tab}`}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5"
        >
          {isLoading ? (
            <div className="space-y-2" aria-label="Loading review results">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-24 animate-pulse rounded-10 border border-border bg-bg-secondary motion-reduce:animate-none"
                />
              ))}
            </div>
          ) : !workingCopyPath ? (
            <ReviewEmptyState
              icon={ShieldCheck}
              title="No working copy"
              detail="Open a working copy to inspect its AI review activity."
            />
          ) : tab === 'open' || tab === 'dismissed' ? (
            <div>
              {/* Filters stay reachable while a long queue scrolls under them. */}
              <div className="sticky top-0 z-10 -mx-4 -mt-3.5 mb-3 flex flex-wrap items-center gap-1.5 border-b border-border-muted bg-bg/95 px-4 py-2.5 backdrop-blur">
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  role="toolbar"
                  aria-label="Finding filters and bulk triage"
                >
                  {SEVERITY_FILTERS.map((filter) => {
                    const enabled = severityFilters.has(filter.id);
                    const count = severityCounts.get(filter.id) ?? 0;
                    return (
                      <button
                        key={filter.id}
                        type="button"
                        onClick={() => toggleSeverityFilter(filter.id)}
                        aria-pressed={enabled}
                        className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-10.5 font-medium transition-fast ${
                          enabled
                            ? SEVERITY_TONE[filter.severity].chip
                            : 'border-border bg-bg-secondary text-text-faint hover:text-text'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            enabled ? SEVERITY_TONE[filter.severity].dot : 'bg-text-faint'
                          }`}
                          aria-hidden="true"
                        />
                        {filter.label} · {count}
                      </button>
                    );
                  })}
                  <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
                  {tab === 'open' ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm gap-1 text-11"
                        disabled={visibleFindings.length === 0}
                        onClick={() => bulkTriage('accepted')}
                        title="Accept every visible finding (Shift+A)"
                      >
                        <CheckCheck className="h-3 w-3" aria-hidden="true" />
                        Accept all ({visibleFindings.length})
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm gap-1 text-11"
                        disabled={visibleFindings.length === 0}
                        onClick={() => bulkTriage('dismissed')}
                        title="Dismiss every visible finding (Shift+D)"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                        Dismiss all
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm gap-1 text-11"
                      disabled={visibleFindings.length === 0}
                      onClick={() => bulkTriage('open')}
                      title="Restore every visible finding to the open queue (Shift+D)"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" />
                      Restore all ({visibleFindings.length})
                    </button>
                  )}
                </div>
              </div>
              {undo && (
                <div
                  className="mb-2 flex items-center gap-2 rounded-9 border border-accent/30 bg-accent/[0.07] px-3 py-2"
                  role="status"
                  aria-live="polite"
                >
                  <Undo2 className="h-3.5 w-3.5 flex-shrink-0 text-accent" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-11 text-text-secondary">
                    {undo.label}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm gap-1 text-11"
                    onClick={runUndo}
                    title="Undo the last triage action (U)"
                  >
                    Undo
                    <kbd className="kbd">U</kbd>
                  </button>
                </div>
              )}
              {visibleFindings.length ? (
                <ol className="space-y-2">
                  {visibleFindings.map((finding, index) => {
                    const tone = SEVERITY_TONE[finding.severity] ?? SEVERITY_TONE.info;
                    return (
                      <li
                        key={finding.id}
                        className={`overflow-hidden rounded-10 border bg-bg-secondary/60 transition-fast ${
                          index === activeIndex
                            ? 'border-accent/60 bg-bg-secondary shadow-card'
                            : `${tone.border} hover:border-border-strong`
                        }`}
                      >
                        <div className="p-3">
                          <div className="flex items-start gap-2">
                            {/* Severity reads from this dot and the pill; the
                                detail block below carries the accent rail that
                                marks model output, so the card adds no second
                                vertical rail of its own. */}
                            <span
                              className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${tone.dot}`}
                              aria-hidden="true"
                            />
                            <h3 className="min-w-0 flex-1 text-12.5 font-semibold leading-snug text-text">
                              {finding.title}
                            </h3>
                            <span
                              className={`flex-shrink-0 rounded-pill border px-2 py-0.5 text-9.5 font-medium ${tone.chip}`}
                            >
                              {tone.label}
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5">
                            <span className="rounded-4 bg-bg-sunk px-1.5 py-0.5 font-mono text-9.5 text-text-muted">
                              {finding.category}
                            </span>
                            {finding.state === 'accepted' && (
                              <span className="rounded-4 border border-success/35 bg-success/10 px-1.5 py-0.5 text-9.5 font-medium text-success">
                                accepted
                              </span>
                            )}
                            {finding.state === 'dismissed' && (
                              <span className="rounded-4 border border-border-strong px-1.5 py-0.5 text-9.5 font-medium text-text-faint">
                                dismissed
                              </span>
                            )}
                          </div>
                          <AiRichText
                            className="mt-2 text-11.5"
                            markdown={finding.detail}
                            aria-label="Finding detail (AI output)"
                          />
                          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border-muted pt-2.5">
                            <Link
                              to="/files"
                              search={{ path: finding.filePath }}
                              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-6 bg-bg-sunk px-2 py-1 font-mono text-10 text-accent hover:bg-accent/10"
                              title={finding.filePath}
                            >
                              <span className="truncate">
                                {shortPath(finding.filePath)}
                                {finding.line > 0 ? `:${finding.line}` : ''}
                              </span>
                              <ChevronRight
                                className="h-3 w-3 flex-shrink-0 opacity-70"
                                aria-hidden="true"
                              />
                            </Link>
                            <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
                              {tab === 'open' ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm gap-1 text-11"
                                    onClick={() => triageOne(finding.id, 'accepted')}
                                    title="Accept this finding (A)"
                                  >
                                    <Check className="h-3 w-3" aria-hidden="true" />
                                    Accept
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm gap-1 text-11"
                                    onClick={() => triageOne(finding.id, 'dismissed')}
                                    title="Dismiss this finding (D)"
                                  >
                                    <X className="h-3 w-3" aria-hidden="true" />
                                    Dismiss
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm gap-1 text-11"
                                  onClick={() => triageOne(finding.id, 'open')}
                                >
                                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                                  Restore
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : baseFindings.length ? (
                <ReviewEmptyState
                  icon={SlidersHorizontal}
                  title="No findings match the severity filter"
                  detail="Enable more severity levels above to see the remaining findings."
                />
              ) : (
                <ReviewEmptyState
                  icon={tab === 'open' ? CheckCheck : Archive}
                  tone={tab === 'open' ? 'positive' : 'neutral'}
                  title={tab === 'open' ? 'Review queue clear' : 'No triaged findings'}
                  detail={
                    tab === 'open'
                      ? 'Nothing is waiting on you. Run “Review” from the commit window to check a change set.'
                      : 'Findings you accept or dismiss are kept here, and can be restored at any time.'
                  }
                />
              )}
            </div>
          ) : tab === 'files' ? (
            workspace?.explanations.length ? (
              <div className="space-y-2">
                {workspace.explanations.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-10 border border-border bg-bg-secondary/60 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <FileCode2
                        className="h-3.5 w-3.5 flex-shrink-0 text-accent"
                        aria-hidden="true"
                      />
                      <h3
                        className="min-w-0 flex-1 truncate font-mono text-11 font-semibold text-text"
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
                    <AiRichText
                      className="mt-2 text-11.5"
                      markdown={item.summary}
                      aria-label="File explanation (AI output)"
                    />
                    {item.risks.length > 0 && (
                      <p className="mt-2 inline-flex items-center gap-1.5 rounded-pill border border-warning/30 bg-warning/[0.08] px-2 py-0.5 text-10 text-warning">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        {item.risks.length} risk signal{item.risks.length === 1 ? '' : 's'}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <ReviewEmptyState
                icon={FileCode2}
                title="No file explanations"
                detail="Use “Explain” in the commit diff toolbar and each answer is kept here."
              />
            )
          ) : tab === 'groups' ? (
            workingCopyPath ? (
              <CommitStackPanel workingCopyPath={workingCopyPath} />
            ) : (
              <ReviewEmptyState
                icon={GitBranch}
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
                    className="flex gap-3 rounded-10 border border-border bg-bg-secondary/60 p-3"
                  >
                    <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-6 bg-accent/12 font-mono text-9.5 font-semibold text-accent">
                      {index + 1}
                    </span>
                    <AiRichText
                      className="min-w-0 flex-1 text-11.5"
                      markdown={question}
                      aria-label={`Review question ${index + 1} (AI output)`}
                    />
                  </li>
                ))}
              </ol>
            ) : (
              <ReviewEmptyState
                icon={HelpCircle}
                title="No unresolved questions"
                detail="Questions raised by per-file analysis collect here."
              />
            )
          ) : tab === 'profile' ? (
            workingCopyPath ? (
              <RepositoryProfilePanel workingCopyPath={workingCopyPath} />
            ) : (
              <ReviewEmptyState
                icon={SlidersHorizontal}
                title="No working copy"
                detail="Open a working copy to configure its AI profile."
              />
            )
          ) : workspace?.runs.length ? (
            <ol className="divide-y divide-border-muted overflow-hidden rounded-10 border border-border bg-bg-secondary/60">
              {workspace.runs.map((run) => (
                <li key={run.id} className="flex items-start gap-2.5 px-3 py-2.5">
                  <Clock3
                    className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-text-faint"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-11 font-semibold capitalize text-text">{run.kind}</span>
                      <Freshness current={currentRunChecksums.get(run.kind) === run.checksum} />
                    </div>
                    <p className="mt-0.5 truncate text-11 text-text-secondary" title={run.summary}>
                      {run.summary}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <span className="block text-10.5 text-text-muted">
                      {formatAge(run.createdAt)}
                    </span>
                    <span className="block font-mono text-9.5 text-text-faint">
                      {run.provider}
                      {run.model ? `/${run.model}` : ''} · {(run.durationMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <ReviewEmptyState
              icon={History}
              title="No previous runs"
              detail="Review, planning, and explanation runs are logged here — never the prompts or diffs themselves."
            />
          )}
        </div>

        <footer className="flex min-h-12 flex-shrink-0 flex-wrap items-center gap-2 border-t border-border bg-bg-secondary/60 px-4 py-2">
          <div className="hidden items-center gap-1.5 text-10 text-text-faint xl:flex">
            <kbd className="kbd">J</kbd>
            <kbd className="kbd">K</kbd>
            <span>navigate</span>
            <span className="mx-1 h-3 w-px bg-border" aria-hidden="true" />
            <kbd className="kbd">A</kbd>
            <kbd className="kbd">D</kbd>
            <span>triage</span>
            <span className="mx-1 h-3 w-px bg-border" aria-hidden="true" />
            <kbd className="kbd">U</kbd>
            <span>undo</span>
            <span className="mx-1 h-3 w-px bg-border" aria-hidden="true" />
            <kbd className="kbd">Esc</kbd>
            <span>close</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm ml-auto gap-1 text-11"
            onClick={() => void clear()}
            disabled={!workspace?.runs.length}
            title="Clear locally saved review results"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            Clear
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm gap-1 text-11"
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
      className={`inline-flex flex-shrink-0 items-center gap-1 rounded-pill border px-1.5 py-0.5 text-9.5 font-medium ${
        current
          ? 'border-success/30 bg-success/[0.08] text-success'
          : 'border-warning/30 bg-warning/[0.08] text-warning'
      }`}
    >
      <span
        className={`h-1 w-1 rounded-full ${current ? 'bg-success' : 'bg-warning'}`}
        aria-hidden="true"
      />
      {current ? 'current' : 'stale'}
    </span>
  );
}

export default AiReviewCenter;
