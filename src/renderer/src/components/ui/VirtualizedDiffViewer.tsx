/**
 * VirtualizedDiffViewer - Memory-efficient diff viewer for large files
 *
 * Features:
 * - Virtualized rendering using @tanstack/react-virtual for 60 FPS scrolling with 100k+ lines
 * - Progressive loading of diff chunks
 * - Memory-efficient with only visible lines rendered
 * - LRU caching for parsed diffs
 * - Progressive image loading support
 * - Unified and side-by-side view modes with word-level (intra-line)
 *   highlighting of changed segments (#47)
 * - Client-side ignore-whitespace / ignore-EOL re-computation (#47)
 * - Optional blame gutter: author + revision per line, colour-intensity by
 *   age, click a line's revision to reveal it (#46)
 *
 * Performance Targets:
 * - 10MB+ diffs load in < 1 second
 * - 100k+ line diffs scroll at 60 FPS
 * - Memory grows linearly with file size
 */

import { useRef, useCallback, useEffect, useMemo, useState, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Loader2,
  FileText,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  AlignLeft,
  Columns2,
} from 'lucide-react';
import type { SvnDiffResult, SvnDiffLine, SvnDiffHunk, SvnDiffFile } from '@shared/types';

// Import the LRU cache
import { LRUCache } from '@shared/utils/lru-cache';
import { DEFAULT_DIFF_CACHE_SIZE_BYTES, DEFAULT_DIFF_CACHE_TTL_MS } from '@shared/constants';

import {
  applyDiffOptions,
  DEFAULT_DIFF_DISPLAY_OPTIONS,
  type DiffDisplayOptions,
} from '@renderer/lib/diffOptions';
import { computeWordDiff, type WordDiffSegment } from '@renderer/lib/wordDiff';
import { blameAgeScale, type BlameAnnotation } from '@renderer/lib/blameRange';
import { buildSideBySideRows, pairUnifiedLines, type SideBySideRow } from './diffRows';

export type DiffViewMode = 'unified' | 'side-by-side';

// ============================================
// Types
// ============================================

interface VirtualizedDiffViewerProps {
  /** Diff result to display */
  diff: SvnDiffResult | null;
  /** Whether diff is currently loading */
  isLoading?: boolean;
  /** Error message if loading failed */
  error?: string | null;
  /** Custom class name */
  className?: string;
  /** Estimated row height for virtualization */
  estimatedRowHeight?: number;
  /** Number of overscan rows */
  overscan?: number;
  /** Callback when a line is clicked */
  onLineClick?: (
    line: SvnDiffLine,
    fileIndex: number,
    hunkIndex: number,
    lineIndex: number
  ) => void;
  /** Whether to show file headers */
  showFileHeaders?: boolean;
  /** Whether to collapse unchanged sections */
  collapseContext?: boolean;
  /** Context lines to show around changes when collapsed */
  contextLines?: number;
  /** View mode; uncontrolled when omitted (#47). */
  viewMode?: DiffViewMode;
  onViewModeChange?: (mode: DiffViewMode) => void;
  /** Whitespace/EOL options; uncontrolled when omitted (#47). */
  displayOptions?: DiffDisplayOptions;
  onDisplayOptionsChange?: (options: DiffDisplayOptions) => void;
  /** Show the view-mode/options toolbar. Default true. */
  showToolbar?: boolean;
  /**
   * Blame annotations for the new side of the diff, keyed by line number
   * internally. When supplied a gutter column is rendered (#46).
   */
  blameLines?: readonly BlameAnnotation[] | null;
  /** Called when a blame revision in the gutter is activated. */
  onBlameRevisionClick?: (revision: number, lineNumber: number) => void;
}

type FlatRowType = 'file-header' | 'hunk-header' | 'diff-line' | 'diff-pair' | 'collapsed-context';

interface FlattenedLine {
  type: FlatRowType;
  line?: SvnDiffLine;
  pair?: SideBySideRow;
  file?: SvnDiffFile;
  hunk?: SvnDiffHunk;
  fileIndex: number;
  hunkIndex: number;
  lineIndex: number;
  isCollapsed?: boolean;
  collapsedCount?: number;
  /** Counterpart text for word-level highlighting in unified mode. */
  wordPair?: { oldText: string; newText: string; side: 'old' | 'new' };
}

interface FileCollapseState {
  [key: number]: boolean; // fileIndex -> isCollapsed
}

// ============================================
// LRU Cache for Diffs
// ============================================

// Cache for diff flattening results (100MB limit)
// Using a module-level cache that can be cleared when needed
let diffCache: LRUCache<FlattenedLine[]> | null = null;

function getDiffCache(): LRUCache<FlattenedLine[]> {
  if (!diffCache) {
    diffCache = new LRUCache<FlattenedLine[]>({
      maxSize: DEFAULT_DIFF_CACHE_SIZE_BYTES,
      defaultTTL: DEFAULT_DIFF_CACHE_TTL_MS,
    });
  }
  return diffCache;
}

/**
 * Clear the diff cache (useful for memory cleanup or when switching repos)
 */
export function clearDiffCache(): void {
  if (diffCache) {
    diffCache.destroy();
    diffCache = null;
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Generate a stable hash string from a diff for cache key
 * Uses content sampling to reduce collision probability
 */
function hashDiffContent(diff: SvnDiffResult): string {
  let hash = 0;
  const sampleSize = Math.min(diff.files.length, 5);

  for (let i = 0; i < sampleSize; i++) {
    const file = diff.files[i];
    // Include first hunk's first line content for uniqueness
    const firstHunk = file.hunks[0];
    const firstLine = firstHunk?.lines[0]?.content || '';
    hash = ((hash << 5) - hash + file.oldPath.length + file.newPath.length + firstLine.length) | 0;
  }

  return hash.toString(16);
}

/**
 * Generate a cache key for a diff
 * Uses structural info + content hash for better uniqueness
 */
function getDiffCacheKey(diff: SvnDiffResult): string {
  const structure = diff.files.map((f, i) => `${i}:${f.oldPath}:${f.hunks.length}`).join('|');
  const contentHash = hashDiffContent(diff);
  return `diff:${contentHash}:${structure.length}`;
}

/** Flatten one hunk's unified lines with word-diff pairing metadata attached. */
function flattenUnifiedHunkLines(hunk: SvnDiffHunk): FlattenedLine[] {
  return pairUnifiedLines(hunk.lines).map((entry) => ({
    type: 'diff-line' as const,
    line: entry.line,
    wordPair: entry.wordPair,
    fileIndex: -1,
    hunkIndex: -1,
    lineIndex: entry.lineIndex,
  }));
}

/** True for rows that carry a change on either side (used by context collapsing). */
function pairHasChange(row: SideBySideRow): boolean {
  return (
    (row.left !== null && row.left.type !== 'context') ||
    (row.right !== null && row.right.type !== 'context')
  );
}

/** Build side-by-side rows for a hunk, collapsing long context runs into single indicator rows. */
function flattenSideBySideHunk(hunk: SvnDiffHunk, contextLines: number, collapse: boolean): FlattenedLine[] {
  const rows = buildSideBySideRows(hunk.lines);
  if (!collapse) {
    return rows.map((pair, lineIndex) => ({
      type: 'diff-pair' as const,
      pair,
      fileIndex: -1,
      hunkIndex: -1,
      lineIndex,
    }));
  }

  const out: FlattenedLine[] = [];
  let run: Array<{ pair: SideBySideRow; lineIndex: number }> = [];

  const flushRun = () => {
    if (run.length === 0) return;
    const threshold = contextLines * 2 + 10;
    if (run.length > threshold) {
      const head = run.slice(0, contextLines);
      const tail = run.slice(run.length - contextLines);
      for (const entry of head) {
        out.push({ type: 'diff-pair', pair: entry.pair, fileIndex: -1, hunkIndex: -1, lineIndex: entry.lineIndex });
      }
      out.push({
        type: 'collapsed-context',
        fileIndex: -1,
        hunkIndex: -1,
        lineIndex: -1,
        collapsedCount: run.length - contextLines * 2,
      });
      for (const entry of tail) {
        out.push({ type: 'diff-pair', pair: entry.pair, fileIndex: -1, hunkIndex: -1, lineIndex: entry.lineIndex });
      }
    } else {
      for (const entry of run) {
        out.push({ type: 'diff-pair', pair: entry.pair, fileIndex: -1, hunkIndex: -1, lineIndex: entry.lineIndex });
      }
    }
    run = [];
  };

  rows.forEach((pair, lineIndex) => {
    if (pairHasChange(pair)) {
      flushRun();
      out.push({ type: 'diff-pair', pair, fileIndex: -1, hunkIndex: -1, lineIndex });
    } else {
      run.push({ pair, lineIndex });
    }
  });
  flushRun();

  return out;
}

/**
 * Flatten diff result into a single array of renderable lines
 * This enables efficient virtualization across files and hunks
 */
function flattenDiff(
  diff: SvnDiffResult,
  collapseContext: boolean = false,
  contextLines: number = 3,
  viewMode: DiffViewMode = 'unified'
): FlattenedLine[] {
  const cacheKey = `${getDiffCacheKey(diff)}:${collapseContext}:${contextLines}:${viewMode}`;
  const cache = getDiffCache();

  // Check cache
  const cached = cache.peek(cacheKey);
  if (cached) {
    return cached;
  }

  const lines: FlattenedLine[] = [];

  for (let fileIndex = 0; fileIndex < diff.files.length; fileIndex++) {
    const file = diff.files[fileIndex];

    // File header
    lines.push({
      type: 'file-header',
      file,
      fileIndex,
      hunkIndex: -1,
      lineIndex: -1,
    });

    for (let hunkIndex = 0; hunkIndex < file.hunks.length; hunkIndex++) {
      const hunk = file.hunks[hunkIndex];

      // Hunk header
      lines.push({
        type: 'hunk-header',
        hunk,
        fileIndex,
        hunkIndex,
        lineIndex: -1,
      });

      if (viewMode === 'side-by-side') {
        const flattenedRows = flattenSideBySideHunk(hunk, contextLines, collapseContext);
        for (const row of flattenedRows) {
          lines.push({
            ...row,
            fileIndex,
            hunkIndex,
            lineIndex: row.lineIndex,
          });
        }
        continue;
      }

      if (collapseContext) {
        // Collapse long runs of context lines
        const collapsed = collapseContextLines(hunk.lines, contextLines);
        for (let lineIndex = 0; lineIndex < collapsed.lines.length; lineIndex++) {
          const line = collapsed.lines[lineIndex];
          lines.push({
            type: 'diff-line',
            line,
            fileIndex,
            hunkIndex,
            lineIndex,
            isCollapsed: collapsed.collapsedIndices.has(lineIndex),
          });
        }
      } else {
        // Word-diff pairing needs the zipped walk; it emits the same lines in
        // the same order with extra metadata, so the no-options path gains
        // highlighting for free.
        for (const entry of flattenUnifiedHunkLines(hunk)) {
          lines.push({ ...entry, fileIndex, hunkIndex });
        }
      }
    }
  }

  // Cache the result
  cache.set(cacheKey, lines);

  return lines;
}

/**
 * Collapse long runs of context lines, keeping context around changes
 */
function collapseContextLines(
  lines: SvnDiffLine[],
  contextLines: number
): { lines: SvnDiffLine[]; collapsedIndices: Set<number> } {
  const result: SvnDiffLine[] = [...lines];
  const collapsedIndices = new Set<number>();

  // Find runs of context lines
  let contextRun: number[] = [];

  const flush = () => {
    if (contextRun.length > contextLines * 2 + 10) {
      // Collapse middle of run
      const start = contextLines;
      const end = contextRun.length - contextLines;

      for (let j = start; j < end; j++) {
        collapsedIndices.add(contextRun[j]);
      }
    }
    contextRun = [];
  };

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type === 'context') {
      contextRun.push(i);
    } else {
      flush();
    }
  }
  flush();

  return { lines: result, collapsedIndices };
}

// ============================================
// Sub-Components
// ============================================

/**
 * File header component
 */
const DiffFileHeader = memo(function DiffFileHeader({
  file,
  isCollapsed,
  onToggle,
}: {
  file: SvnDiffFile;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const fileName = file.newPath || file.oldPath;
  const displayPath = fileName.split('/').pop() || fileName;

  return (
    <button
      type="button"
      className="diff-file-header sticky top-0 z-20 bg-bg-elevated px-4 py-2 border-b border-border flex items-center gap-2 cursor-pointer hover:bg-bg-secondary w-full text-left"
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {isCollapsed ? (
        <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
      ) : (
        <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
      )}
      <FileText className="w-4 h-4 text-accent flex-shrink-0" />
      <span className="text-text font-medium truncate">{displayPath}</span>
      {file.oldPath !== file.newPath && (
        <span className="text-text-muted text-sm ml-2 truncate">
          (from {file.oldPath.split('/').pop()})
        </span>
      )}
      <span className="text-text-muted text-xs ml-auto">
        {file.hunks.length} hunk{file.hunks.length !== 1 ? 's' : ''}
      </span>
    </button>
  );
});

/**
 * Hunk header component
 */
const DiffHunkHeader = memo(function DiffHunkHeader({ hunk }: { hunk: SvnDiffHunk }) {
  return (
    <div className="diff-hunk-header bg-bg-tertiary px-4 py-1 text-text-muted text-xs font-mono">
      @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
    </div>
  );
});

function lineBgClass(type: SvnDiffLine['type']): string {
  switch (type) {
    case 'added':
      return 'bg-green-500/10 hover:bg-green-500/20';
    case 'removed':
      return 'bg-red-500/10 hover:bg-red-500/20';
    case 'hunk':
      return 'bg-blue-500/10';
    default:
      return 'hover:bg-bg-secondary';
  }
}

function linePrefixClass(type: SvnDiffLine['type']): string {
  switch (type) {
    case 'added':
      return 'text-green-600 dark:text-green-400';
    case 'removed':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-text-muted';
  }
}

function linePrefix(type: SvnDiffLine['type']): string {
  switch (type) {
    case 'added':
      return '+';
    case 'removed':
      return '-';
    default:
      return ' ';
  }
}

/** Token-level highlight of the changed part of a changed line (#47). */
const WordHighlightedContent = memo(function WordHighlightedContent({
  content,
  wordPair,
  highlightClass,
}: {
  content: string;
  wordPair?: { oldText: string; newText: string; side: 'old' | 'new' };
  highlightClass: string;
}) {
  const segments = useMemo<WordDiffSegment[]>(() => {
    if (!wordPair) return [{ text: content, changed: false }];
    const result =
      wordPair.side === 'old'
        ? computeWordDiff(wordPair.oldText, wordPair.newText).oldSegments
        : computeWordDiff(wordPair.oldText, wordPair.newText).newSegments;
    return result;
  }, [content, wordPair]);

  if (!wordPair) {
    return <>{content}</>;
  }

  return (
    <>
      {segments.map((segment, index) =>
        segment.changed ? (
          <span key={index} className={`${highlightClass} rounded-sm`}>
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  );
});

/**
 * Blame gutter cell: author + revision, background intensity by age (#46).
 * Rendered inside each virtualized row, so it costs nothing extra for large
 * files — only visible rows exist.
 */
const BlameGutterCell = memo(function BlameGutterCell({
  annotation,
  styleClass,
  onSelect,
}: {
  annotation: BlameAnnotation | undefined;
  styleClass: string;
  onSelect?: (revision: number, lineNumber: number) => void;
}) {
  if (!annotation) {
    return <div className="w-[132px] flex-shrink-0 border-r border-border/50 select-none" />;
  }

  const title =
    annotation.revision === null
      ? 'Uncommitted local change — no revision'
      : `r${annotation.revision} · ${annotation.author} · ${annotation.date || 'unknown date'}`;

  const body = (
    <>
      <span className="w-10 flex-shrink-0 text-right pr-1.5 font-semibold">
        {annotation.revision === null ? 'local' : `r${annotation.revision}`}
      </span>
      <span className="flex-1 truncate pl-1.5 text-text-secondary">{annotation.author}</span>
    </>
  );

  if (annotation.revision !== null && onSelect) {
    return (
      <button
        type="button"
        className={`w-[132px] flex-shrink-0 border-r border-border/50 select-none flex items-center text-left text-[11px] leading-none py-0.5 ${styleClass} hover:bg-accent/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent`}
        style={{ height: '100%' }}
        title={title}
        onClick={(event) => {
          event.stopPropagation();
          if (annotation.revision !== null) onSelect(annotation.revision, annotation.lineNumber);
        }}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      className={`w-[132px] flex-shrink-0 border-r border-border/50 select-none flex items-center text-left text-[11px] leading-none py-0.5 ${styleClass}`}
      title={title}
    >
      {body}
    </div>
  );
});

/**
 * Single diff line component (unified mode)
 */
const DiffLineComponent = memo(function DiffLineComponent({
  line,
  wordPair,
  onClick,
  blame,
  blameStyleClass,
  blameActive,
  onBlameSelect,
}: {
  line: SvnDiffLine;
  wordPair?: { oldText: string; newText: string; side: 'old' | 'new' };
  onClick?: () => void;
  blame?: BlameAnnotation;
  blameStyleClass?: string;
  blameActive: boolean;
  onBlameSelect?: (revision: number, lineNumber: number) => void;
}) {
  const getLineNumber = () => {
    if (line.type === 'added' && line.newLineNumber !== undefined) {
      return line.newLineNumber;
    }
    if (line.type === 'removed' && line.oldLineNumber !== undefined) {
      return line.oldLineNumber;
    }
    if (line.type === 'context') {
      return line.newLineNumber ?? line.oldLineNumber ?? '';
    }
    return '';
  };

  const highlightClass =
    line.type === 'added'
      ? 'bg-green-500/30'
      : line.type === 'removed'
        ? 'bg-red-500/30'
        : 'bg-accent/20';

  return (
    <div
      className={`${lineBgClass(line.type)} flex font-mono text-sm items-stretch cursor-pointer`}
      onClick={onClick}
    >
      {/* Blame gutter (#46) — rendered as a stable column whenever the gutter
          is on, so rows without an annotation keep the alignment. */}
      {(blameActive || onBlameSelect) && (
        <BlameGutterCell
          annotation={blame}
          styleClass={blameStyleClass ?? ''}
          onSelect={onBlameSelect}
        />
      )}

      {/* Line number */}
      <div className="diff-line-number w-12 flex-shrink-0 text-right pr-3 text-text-faint select-none border-r border-border flex items-center">
        {getLineNumber()}
      </div>

      {/* Prefix */}
      <div
        className={`diff-line-prefix w-5 flex-shrink-0 text-center flex items-center ${linePrefixClass(line.type)}`}
      >
        {linePrefix(line.type)}
      </div>

      {/* Content */}
      <div className="diff-line-content flex-1 whitespace-pre overflow-x-auto pl-2 flex items-center min-w-0">
        <WordHighlightedContent
          content={line.content}
          wordPair={line.type === 'added' || line.type === 'removed' ? wordPair : undefined}
          highlightClass={highlightClass}
        />
      </div>
    </div>
  );
});

/**
 * One aligned row of the side-by-side view (#47): old and new cells, gap
 * filling for unpaired lines, optional word highlighting on changed pairs.
 */
const DiffPairComponent = memo(function DiffPairComponent({
  pair,
  showLineNumbers = true,
  blame,
  blameStyleClass,
  blameActive,
  onBlameSelect,
  onClick,
}: {
  pair: SideBySideRow;
  showLineNumbers?: boolean;
  blame?: BlameAnnotation;
  blameStyleClass?: string;
  blameActive: boolean;
  onBlameSelect?: (revision: number, lineNumber: number) => void;
  onClick?: (line: SvnDiffLine, lineIndex: number) => void;
}) {
  const wordDiff = useMemo(() => {
    if (!pair.paired || !pair.left || !pair.right) return null;
    if (pair.left.content === pair.right.content) return null;
    return computeWordDiff(pair.left.content, pair.right.content);
  }, [pair]);

  const renderCell = (side: 'old' | 'new') => {
    const line = side === 'old' ? pair.left : pair.right;
    const lineIndex = side === 'old' ? pair.leftIndex : pair.rightIndex;

    if (!line) {
      // Gap filler keeps the opposite line vertically aligned (#47).
      return (
        <div className="flex-1 min-w-0 flex">
          {showLineNumbers && <div className="w-10 flex-shrink-0 border-r border-border/50" />}
          <div className="flex-1 bg-bg-tertiary/40" />
        </div>
      );
    }

    const isChange = line.type === 'added' || line.type === 'removed';
    const segments = side === 'old' ? wordDiff?.oldSegments : wordDiff?.newSegments;

    return (
      <div
        className={`flex-1 min-w-0 flex items-stretch font-mono text-sm cursor-pointer ${
          isChange ? lineBgClass(line.type) : 'hover:bg-bg-secondary'
        }`}
        onClick={() => onClick?.(line, lineIndex)}
      >
        {showLineNumbers && (
          <div className="diff-line-number w-10 flex-shrink-0 text-right pr-2 text-text-faint select-none border-r border-border/50 flex items-center">
            {side === 'old' ? (line.oldLineNumber ?? '') : (line.newLineNumber ?? '')}
          </div>
        )}
        <div
          className={`diff-line-prefix w-5 flex-shrink-0 text-center flex items-center ${linePrefixClass(line.type)}`}
        >
          {linePrefix(line.type)}
        </div>
        <div className="diff-line-content flex-1 whitespace-pre overflow-hidden pl-1.5 flex items-center min-w-0">
          {segments ? (
            segments.map((segment, index) =>
              segment.changed ? (
                <span
                  key={index}
                  className={`rounded-sm ${
                    side === 'old' ? 'bg-red-500/30' : 'bg-green-500/30'
                  }`}
                >
                  {segment.text}
                </span>
              ) : (
                <span key={index}>{segment.text}</span>
              )
            )
          ) : (
            line.content
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex items-stretch border-b border-border/30">
      {renderCell('old')}
      <div className="w-px flex-shrink-0 bg-border" />
      {renderCell('new')}
      {/* Blame gutter applies to the new side (#46). */}
      {(blameActive || onBlameSelect) && (
        <BlameGutterCell
          annotation={blame}
          styleClass={blameStyleClass ?? ''}
          onSelect={onBlameSelect}
        />
      )}
    </div>
  );
});

/**
 * Collapsed context indicator
 */
const CollapsedContextIndicator = memo(function CollapsedContextIndicator({
  count,
}: {
  count: number;
}) {
  return (
    <div className="diff-collapsed-context bg-bg-tertiary px-4 py-1 text-text-muted text-xs text-center italic">
      {count} unchanged {count === 1 ? 'line' : 'lines'} hidden
    </div>
  );
});

// ============================================
// Main Component
// ============================================

/**
 * VirtualizedDiffViewer - Efficiently renders large diffs with virtualization
 *
 * @example
 * ```tsx
 * <VirtualizedDiffViewer
 *   diff={diffResult}
 *   isLoading={loading}
 *   error={error}
 *   collapseContext={true}
 * />
 * ```
 */
export function VirtualizedDiffViewer({
  diff,
  isLoading = false,
  error = null,
  className = '',
  estimatedRowHeight = 24,
  overscan = 15,
  onLineClick,
  showFileHeaders = true,
  collapseContext = false,
  contextLines = 3,
  viewMode: viewModeProp,
  onViewModeChange,
  displayOptions: displayOptionsProp,
  onDisplayOptionsChange,
  showToolbar = true,
  blameLines = null,
  onBlameRevisionClick,
}: VirtualizedDiffViewerProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<FileCollapseState>({});
  const [internalViewMode, setInternalViewMode] = useState<DiffViewMode>('unified');
  const [internalDisplayOptions, setInternalDisplayOptions] =
    useState<DiffDisplayOptions>(DEFAULT_DIFF_DISPLAY_OPTIONS);

  // Controlled when a prop is supplied, self-managed otherwise, so embedders
  // that just want a diff shown get a working toolbar for free.
  const viewMode = viewModeProp ?? internalViewMode;
  const displayOptions = displayOptionsProp ?? internalDisplayOptions;

  const setViewMode = useCallback(
    (mode: DiffViewMode) => {
      if (viewModeProp === undefined) setInternalViewMode(mode);
      onViewModeChange?.(mode);
    },
    [viewModeProp, onViewModeChange]
  );

  const setDisplayOptions = useCallback(
    (options: DiffDisplayOptions) => {
      if (displayOptionsProp === undefined) setInternalDisplayOptions(options);
      onDisplayOptionsChange?.(options);
    },
    [displayOptionsProp, onDisplayOptionsChange]
  );

  const toggleDisplayOption = useCallback(
    (key: keyof DiffDisplayOptions) => {
      setDisplayOptions({ ...displayOptions, [key]: !displayOptions[key] });
    },
    [displayOptions, setDisplayOptions]
  );

  // Whitespace/EOL options are applied to the parsed diff client-side (#47).
  const effectiveDiff = useMemo(
    () => applyDiffOptions(diff, displayOptions),
    [diff, displayOptions]
  );

  // Flatten diff for virtualization
  const flattenedLines = useMemo(() => {
    if (!effectiveDiff) return [];
    return flattenDiff(effectiveDiff, collapseContext, contextLines, viewMode);
  }, [effectiveDiff, collapseContext, contextLines, viewMode]);

  // Filter out lines from collapsed files
  const visibleLines = useMemo(() => {
    return flattenedLines.filter((line) => {
      if (line.type === 'file-header') return true;
      return !collapsedFiles[line.fileIndex];
    });
  }, [flattenedLines, collapsedFiles]);

  // Blame gutter support (#46): map by new-side line number once, plus the
  // age→intensity scale for the whole file.
  const blameByLineNumber = useMemo(() => {
    if (!blameLines) return null;
    const map = new Map<number, BlameAnnotation>();
    for (const annotation of blameLines) map.set(annotation.lineNumber, annotation);
    return map;
  }, [blameLines]);

  const blameScale = useMemo(
    () => (blameLines && blameLines.length > 0 ? blameAgeScale(blameLines) : null),
    [blameLines]
  );

  const resolveBlame = useCallback(
    (line: SvnDiffLine | null | undefined): BlameAnnotation | undefined => {
      if (!blameByLineNumber || !line) return undefined;
      const lineNumber = line.newLineNumber;
      if (lineNumber === undefined) return undefined;
      return blameByLineNumber.get(lineNumber);
    },
    [blameByLineNumber]
  );

  const resolveBlameStyle = useCallback(
    (annotation: BlameAnnotation | undefined): string | undefined => {
      if (!annotation || !blameScale) return undefined;
      return blameScale.styleOf(annotation);
    },
    [blameScale]
  );

  // Create virtualizer
  const rowVirtualizer = useVirtualizer({
    count: visibleLines.length,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => {
      const line = visibleLines[index];
      if (!line) return index;
      return `${viewMode}:${line.type}:${line.fileIndex}:${line.hunkIndex}:${line.lineIndex}`;
    },
    estimateSize: useCallback(
      (index: number) => {
        const line = visibleLines[index];
        if (line.type === 'file-header') return 44;
        if (line.type === 'hunk-header') return 28;
        if (line.type === 'collapsed-context') return 24;
        return estimatedRowHeight;
      },
      [visibleLines, estimatedRowHeight]
    ),
    overscan,
  });

  // Toggle file collapse
  const toggleFileCollapse = useCallback((fileIndex: number) => {
    setCollapsedFiles((prev) => ({
      ...prev,
      [fileIndex]: !prev[fileIndex],
    }));
  }, []);

  // Get virtual items
  const virtualItems = rowVirtualizer.getVirtualItems();

  // Calculate diff stats
  const stats = useMemo(() => {
    if (!effectiveDiff) return { additions: 0, deletions: 0, files: 0 };

    let additions = 0;
    let deletions = 0;

    for (const file of effectiveDiff.files) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.type === 'added') additions++;
          if (line.type === 'removed') deletions++;
        }
      }
    }

    return {
      additions,
      deletions,
      files: effectiveDiff.files.length,
    };
  }, [effectiveDiff]);

  // Loading state
  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
          <span className="text-text-secondary">Loading diff…</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="flex flex-col items-center gap-3 text-center p-8">
          <AlertTriangle className="w-10 h-10 text-warning" />
          <div>
            <p className="text-text font-medium mb-1">Failed to load diff</p>
            <p className="text-text-secondary text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (!effectiveDiff || !effectiveDiff.hasChanges) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        {showToolbar && (
          <DiffToolbar
            viewMode={viewMode}
            onViewMode={setViewMode}
            displayOptions={displayOptions}
            onToggleDisplayOption={toggleDisplayOption}
          />
        )}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center p-8">
            <FileText className="w-10 h-10 text-text-muted" />
            <div>
              <p className="text-text font-medium mb-1">
                {displayOptions.ignoreWhitespace || displayOptions.ignoreEol
                  ? 'No Changes Beyond Whitespace'
                  : 'No Changes'}
              </p>
              <p className="text-text-secondary text-sm">
                {displayOptions.ignoreWhitespace || displayOptions.ignoreEol
                  ? 'Every difference between the two versions is whitespace or line endings only.'
                  : 'This file has no modifications'}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Binary file state
  if (effectiveDiff.isBinary) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="flex flex-col items-center gap-3 text-center p-8">
          <FileText className="w-10 h-10 text-text-muted" />
          <div>
            <p className="text-text font-medium mb-1">Binary File</p>
            <p className="text-text-secondary text-sm">Cannot display diff for binary files</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Toolbar: view mode + whitespace options (#47) */}
      {showToolbar && (
        <DiffToolbar
          viewMode={viewMode}
          onViewMode={setViewMode}
          displayOptions={displayOptions}
          onToggleDisplayOption={toggleDisplayOption}
        />
      )}

      {/* Stats bar */}
      <div className="flex-shrink-0 px-4 py-2 bg-bg-secondary border-b border-border flex items-center gap-4 text-sm">
        <span className="text-text-secondary">
          {stats.files} file{stats.files !== 1 ? 's' : ''} changed
        </span>
        <span className="text-green-600 dark:text-green-400">
          +{stats.additions} addition{stats.additions !== 1 ? 's' : ''}
        </span>
        <span className="text-red-600 dark:text-red-400">
          -{stats.deletions} deletion{stats.deletions !== 1 ? 's' : ''}
        </span>
        <span className="text-text-muted ml-auto text-xs">
          {flattenedLines.length.toLocaleString()} lines
        </span>
      </div>

      {/* Virtualized content */}
      <div ref={parentRef} className="flex-1 overflow-auto bg-bg font-mono">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map((virtualRow) => {
            const line = visibleLines[virtualRow.index];
            const isCollapsed = collapsedFiles[line.fileIndex];

            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {line.type === 'file-header' && showFileHeaders && line.file && (
                  <DiffFileHeader
                    file={line.file}
                    isCollapsed={isCollapsed}
                    onToggle={() => toggleFileCollapse(line.fileIndex)}
                  />
                )}

                {line.type === 'hunk-header' && !isCollapsed && line.hunk && (
                  <DiffHunkHeader hunk={line.hunk} />
                )}

                {line.type === 'collapsed-context' && !isCollapsed && (
                  <CollapsedContextIndicator count={line.collapsedCount ?? 1} />
                )}

                {line.type === 'diff-line' && !isCollapsed && line.line && (
                  <>
                    {line.isCollapsed ? (
                      <CollapsedContextIndicator count={1} />
                    ) : (
                      <DiffLineComponent
                        line={line.line}
                        wordPair={line.wordPair}
                        blame={resolveBlame(line.line)}
                        blameStyleClass={resolveBlameStyle(resolveBlame(line.line))}
                        blameActive={blameByLineNumber !== null}
                        onBlameSelect={onBlameRevisionClick}
                        onClick={() => {
                          if (onLineClick) {
                            onLineClick(
                              line.line!,
                              line.fileIndex,
                              line.hunkIndex,
                              line.lineIndex
                            );
                          }
                        }}
                      />
                    )}
                  </>
                )}

                {line.type === 'diff-pair' && !isCollapsed && line.pair && (
                  <DiffPairComponent
                    pair={line.pair}
                    blame={resolveBlame(line.pair.right)}
                    blameStyleClass={resolveBlameStyle(resolveBlame(line.pair.right))}
                    blameActive={blameByLineNumber !== null}
                    onBlameSelect={onBlameRevisionClick}
                    onClick={(clickedLine) => {
                      if (onLineClick) {
                        onLineClick(clickedLine, line.fileIndex, line.hunkIndex, -1);
                      }
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Toolbar: unified/side-by-side toggle and whitespace/EOL options (#47).
 */
function DiffToolbar({
  viewMode,
  onViewMode,
  displayOptions,
  onToggleDisplayOption,
}: {
  viewMode: DiffViewMode;
  onViewMode: (mode: DiffViewMode) => void;
  displayOptions: DiffDisplayOptions;
  onToggleDisplayOption: (key: keyof DiffDisplayOptions) => void;
}) {
  return (
    <div className="flex-shrink-0 flex items-center gap-3 px-4 py-1.5 bg-bg-tertiary border-b border-border">
      <div
        className="flex items-center bg-bg rounded-md p-0.5"
        role="group"
        aria-label="Diff view mode"
      >
        <button
          type="button"
          onClick={() => onViewMode('unified')}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs transition-fast ${
            viewMode === 'unified' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text'
          }`}
          aria-pressed={viewMode === 'unified'}
          title="Unified diff view"
        >
          <AlignLeft className="w-3.5 h-3.5" aria-hidden="true" />
          Unified
        </button>
        <button
          type="button"
          onClick={() => onViewMode('side-by-side')}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs transition-fast ${
            viewMode === 'side-by-side'
              ? 'bg-accent text-white'
              : 'text-text-secondary hover:text-text'
          }`}
          aria-pressed={viewMode === 'side-by-side'}
          title="Side-by-side diff view"
        >
          <Columns2 className="w-3.5 h-3.5" aria-hidden="true" />
          Split
        </button>
      </div>

      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            className="accent-accent"
            checked={displayOptions.ignoreWhitespace}
            onChange={() => onToggleDisplayOption('ignoreWhitespace')}
          />
          Ignore whitespace
        </label>
        <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            className="accent-accent"
            checked={displayOptions.ignoreEol}
            onChange={() => onToggleDisplayOption('ignoreEol')}
          />
          Ignore EOL
        </label>
      </div>
    </div>
  );
}

// ============================================
// Progressive Image Loading Hook
// ============================================

/**
 * Hook for progressive image loading with lazy loading
 */
export function useProgressiveImageLoad(src: string | null, placeholder?: string) {
  const [imageSrc, setImageSrc] = useState<string | null>(placeholder || null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!src) {
      setImageSrc(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const img = new Image();

    img.onload = () => {
      setImageSrc(src);
      setIsLoading(false);
    };

    img.onerror = () => {
      setError('Failed to load image');
      setIsLoading(false);
    };

    img.src = src;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);

  return { src: imageSrc, isLoading, error };
}

// ============================================
// Export
// ============================================

export default VirtualizedDiffViewer;
