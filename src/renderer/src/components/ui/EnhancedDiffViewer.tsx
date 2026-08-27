import { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Columns2,
  AlignLeft,
  ChevronDown,
  Copy,
  Check,
  Search,
  X,
  ExternalLink,
} from 'lucide-react';
import type { SvnDiffResult, SvnDiffHunk, SvnDiffLine } from '@shared/types';
import { detectLanguage } from '../../utils/detectLanguage';
import { useSettings } from '@renderer/hooks/useSettings';
import {
  applyDiffOptions,
  DEFAULT_DIFF_DISPLAY_OPTIONS,
  type DiffDisplayOptions,
} from '@renderer/lib/diffOptions';
import { computeWordDiff, type WordDiffSegment } from '@renderer/lib/wordDiff';
import { buildSideBySideRows, pairUnifiedLines, type UnifiedWordPair } from './diffRows';

export type DiffViewMode = 'unified' | 'side-by-side';

interface EnhancedDiffViewerProps {
  diff: SvnDiffResult;
  filePath: string;
  mode?: DiffViewMode;
  onModeChange?: (mode: DiffViewMode) => void;
  showLineNumbers?: boolean;
  className?: string;
  onOpenExternal?: () => void;
  /** Whitespace/EOL options (#47); uncontrolled when omitted. */
  displayOptions?: DiffDisplayOptions;
  onDisplayOptionsChange?: (options: DiffDisplayOptions) => void;
  /**
   * Show the built-in toolbar (view mode, stats, whitespace options, search).
   * Hosts that already own those controls — the commit dialog owns a single
   * toolbar for its whole diff pane — pass false and drive them by prop.
   */
  showToolbar?: boolean;
  /** Show the per-file path header above each file's hunks. Default true. */
  showFileHeaders?: boolean;
  /** Search query; uncontrolled when omitted. */
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  /** Match tally, reported so a host toolbar can render the "2/7" counter. */
  onSearchStateChange?: (state: { matchCount: number; currentIndex: number }) => void;
}

/**
 * Enhanced Diff Viewer with side-by-side and unified views
 * Includes syntax highlighting and navigation
 */
export function EnhancedDiffViewer({
  diff,
  filePath,
  mode = 'unified',
  onModeChange,
  showLineNumbers = true,
  className = '',
  onOpenExternal,
  displayOptions: displayOptionsProp,
  onDisplayOptionsChange,
  showToolbar = true,
  showFileHeaders = true,
  searchQuery: searchQueryProp,
  onSearchQueryChange,
  onSearchStateChange,
}: EnhancedDiffViewerProps) {
  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [copiedLine, setCopiedLine] = useState<number | null>(null);
  const [internalDisplayOptions, setInternalDisplayOptions] =
    useState<DiffDisplayOptions>(DEFAULT_DIFF_DISPLAY_OPTIONS);
  const contentRef = useRef<HTMLDivElement>(null);

  // Controlled when supplied, self-managed otherwise (#47).
  const displayOptions = displayOptionsProp ?? internalDisplayOptions;
  const setDisplayOptions = useCallback(
    (options: DiffDisplayOptions) => {
      if (displayOptionsProp === undefined) setInternalDisplayOptions(options);
      onDisplayOptionsChange?.(options);
    },
    [displayOptionsProp, onDisplayOptionsChange]
  );

  // Controlled when supplied, self-managed otherwise — same shape as the
  // display options above.
  const searchQuery = searchQueryProp ?? internalSearchQuery;
  const setSearchQuery = useCallback(
    (query: string) => {
      if (searchQueryProp === undefined) setInternalSearchQuery(query);
      onSearchQueryChange?.(query);
      setCurrentMatchIndex(0);
    },
    [searchQueryProp, onSearchQueryChange]
  );

  // Whitespace/EOL options re-compute the parsed diff client-side (#47). The
  // input is non-null here, so the result never actually falls back.
  const effectiveDiff = useMemo(
    () => applyDiffOptions(diff, displayOptions) ?? diff,
    [diff, displayOptions]
  );

  const { settings } = useSettings();
  const isDarkTheme =
    settings.theme === 'dark' ||
    (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Detect language from file path
  const language = useMemo(() => detectLanguage(filePath), [filePath]);

  // Calculate diff statistics
  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    let unchanged = 0;

    for (const file of effectiveDiff.files) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.type === 'added') additions++;
          else if (line.type === 'removed') deletions++;
          else if (line.type === 'context') unchanged++;
        }
      }
    }

    return { additions, deletions, unchanged };
  }, [effectiveDiff]);

  // Search matches
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const matches: Array<{ fileIndex: number; hunkIndex: number; lineIndex: number }> = [];
    const query = searchQuery.toLowerCase();

    effectiveDiff.files.forEach((file, fileIndex) => {
      file.hunks.forEach((hunk, hunkIndex) => {
        hunk.lines.forEach((line, lineIndex) => {
          if (line.content.toLowerCase().includes(query)) {
            matches.push({ fileIndex, hunkIndex, lineIndex });
          }
        });
      });
    });

    return matches;
  }, [effectiveDiff, searchQuery]);

  // Navigate to match
  const navigateMatch = useCallback(
    (direction: 'next' | 'prev') => {
      if (searchMatches.length === 0) return;

      setCurrentMatchIndex((prev) =>
        direction === 'next'
          ? prev < searchMatches.length - 1
            ? prev + 1
            : 0
          : prev > 0
            ? prev - 1
            : searchMatches.length - 1
      );
    },
    [searchMatches.length]
  );

  useEffect(() => {
    onSearchStateChange?.({ matchCount: searchMatches.length, currentIndex: currentMatchIndex });
  }, [searchMatches.length, currentMatchIndex, onSearchStateChange]);

  useEffect(() => {
    if (searchMatches.length === 0) return;
    const frame = requestAnimationFrame(() => {
      const matchElement = contentRef.current?.querySelector(
        `[data-match-index="${currentMatchIndex}"]`
      );
      matchElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentMatchIndex, searchMatches.length]);

  // Copy line content
  const copyLine = useCallback(async (content: string, lineNum: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedLine(lineNum);
      setTimeout(() => setCopiedLine(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && searchQuery !== '') {
        e.preventDefault();
        const input = contentRef.current?.querySelector('input[type="text"]') as HTMLInputElement;
        input?.focus();
      }

      if (searchQuery && searchMatches.length > 0) {
        if (e.key === 'F3' || ((e.metaKey || e.ctrlKey) && e.key === 'g')) {
          e.preventDefault();
          navigateMatch(e.shiftKey ? 'prev' : 'next');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery, searchMatches.length, navigateMatch]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Toolbar — suppressed when the host owns the diff controls. */}
      {showToolbar && (
        <div className="flex items-center justify-between px-4 py-2 bg-bg-tertiary border-b border-border">
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex items-center bg-bg rounded-md p-0.5">
              <button
                type="button"
                onClick={() => onModeChange?.('unified')}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-fast ${
                  mode === 'unified'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text'
                }`}
                aria-pressed={mode === 'unified'}
                title="Unified diff view"
              >
                <AlignLeft className="w-3.5 h-3.5" />
                Unified
              </button>
              <button
                type="button"
                onClick={() => onModeChange?.('side-by-side')}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-fast ${
                  mode === 'side-by-side'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text'
                }`}
                aria-pressed={mode === 'side-by-side'}
                title="Side-by-side diff view"
              >
                <Columns2 className="w-3.5 h-3.5" />
                Split
              </button>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-3 text-xs ml-3">
              <span className="text-success">+{stats.additions}</span>
              <span className="text-error">-{stats.deletions}</span>
              {stats.unchanged > 0 && (
                <span className="text-text-muted">{stats.unchanged} unchanged</span>
              )}
            </div>

            {/* Whitespace options (#47) */}
            <div className="flex items-center gap-3 text-xs ml-3">
              <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={displayOptions.ignoreWhitespace}
                  onChange={() =>
                    setDisplayOptions({
                      ...displayOptions,
                      ignoreWhitespace: !displayOptions.ignoreWhitespace,
                    })
                  }
                />
                Ignore whitespace
              </label>
              <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={displayOptions.ignoreEol}
                  onChange={() =>
                    setDisplayOptions({
                      ...displayOptions,
                      ignoreEol: !displayOptions.ignoreEol,
                    })
                  }
                />
                Ignore EOL
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search diff…"
                className="input text-xs py-1 pl-7 pr-8 w-40"
              />
              {searchQuery && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {searchMatches.length > 0 && (
                    <span className="text-xs text-text-muted">
                      {currentMatchIndex + 1}/{searchMatches.length}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="p-0.5 hover:bg-bg-tertiary rounded"
                  >
                    <X className="w-3 h-3 text-text-muted" />
                  </button>
                </div>
              )}
            </div>

            {/* External diff button */}
            {onOpenExternal && (
              <button
                type="button"
                onClick={onOpenExternal}
                className="btn btn-secondary btn-sm text-xs"
                title="Open in external diff tool"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div ref={contentRef} className="flex-1 overflow-auto font-mono text-xs">
        {mode === 'unified' ? (
          <UnifiedDiffView
            diff={effectiveDiff}
            language={language}
            showLineNumbers={showLineNumbers}
            showFileHeaders={showFileHeaders}
            searchQuery={searchQuery}
            searchMatches={searchMatches}
            currentMatchIndex={currentMatchIndex}
            onCopyLine={copyLine}
            copiedLine={copiedLine}
            isDarkTheme={isDarkTheme}
          />
        ) : (
          <SideBySideDiffView
            diff={effectiveDiff}
            language={language}
            showLineNumbers={showLineNumbers}
            showFileHeaders={showFileHeaders}
            searchQuery={searchQuery}
            searchMatches={searchMatches}
            currentMatchIndex={currentMatchIndex}
            onCopyLine={copyLine}
            copiedLine={copiedLine}
            isDarkTheme={isDarkTheme}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Unified diff view (single column with +/- prefixes)
 */
interface DiffViewProps {
  diff: SvnDiffResult;
  language: string;
  showLineNumbers: boolean;
  showFileHeaders?: boolean;
  searchQuery: string;
  searchMatches: Array<{ fileIndex: number; hunkIndex: number; lineIndex: number }>;
  currentMatchIndex: number;
  onCopyLine: (content: string, lineNum: number) => void;
  copiedLine: number | null;
  isDarkTheme: boolean;
}

const UnifiedDiffView = memo(function UnifiedDiffView({
  diff,
  language,
  showLineNumbers,
  showFileHeaders = true,
  searchQuery,
  searchMatches,
  currentMatchIndex,
  onCopyLine,
  copiedLine,
  isDarkTheme,
}: DiffViewProps) {
  const highlightStyle = isDarkTheme ? oneDark : oneLight;

  return (
    <div className="min-w-max">
      {diff.files.map((file, fileIndex) => (
        <div key={fileIndex} className="mb-4">
          {/* File header */}
          {showFileHeaders && (
            <div className="diff-file-header sticky top-0 bg-bg-elevated px-4 py-2 border-b border-border z-10 flex items-center justify-between">
              <span className="text-text font-medium">{file.newPath || file.oldPath}</span>
              {file.oldPath !== file.newPath && file.oldPath && (
                <span className="text-text-muted text-xs ml-2">renamed from {file.oldPath}</span>
              )}
            </div>
          )}

          {/* Hunks */}
          {file.hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex}>
              {/* Hunk header */}
              <button
                type="button"
                className="diff-hunk-header w-full text-left bg-bg-tertiary px-4 py-1 text-text-muted text-xs hover:bg-bg-elevated transition-fast flex items-center gap-2"
                title="Click to expand/collapse"
              >
                <ChevronDown className="w-3 h-3" />
                @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              </button>

              {/* Lines */}
              <div className="relative">
                {pairUnifiedLines(hunk.lines).map(({ line, lineIndex, wordPair }) => {
                  const matchIndex = searchMatches.findIndex(
                    (m) =>
                      m.fileIndex === fileIndex &&
                      m.hunkIndex === hunkIndex &&
                      m.lineIndex === lineIndex
                  );
                  const isMatch = matchIndex !== -1;
                  const isCurrentMatch =
                    searchMatches[currentMatchIndex]?.fileIndex === fileIndex &&
                    searchMatches[currentMatchIndex]?.hunkIndex === hunkIndex &&
                    searchMatches[currentMatchIndex]?.lineIndex === lineIndex;

                  return (
                    <UnifiedDiffLine
                      key={lineIndex}
                      line={line}
                      lineIndex={lineIndex}
                      wordPair={wordPair}
                      language={language}
                      showLineNumbers={showLineNumbers}
                      searchQuery={searchQuery}
                      isMatch={isMatch}
                      isCurrentMatch={isCurrentMatch}
                      matchIndex={matchIndex}
                      highlightStyle={highlightStyle}
                      onCopyLine={onCopyLine}
                      copiedLine={copiedLine}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});

/**
 * Single line in unified diff view
 */
interface UnifiedDiffLineProps {
  line: SvnDiffLine;
  lineIndex: number;
  /** Counterpart text for word-level highlighting of changed lines (#47). */
  wordPair?: UnifiedWordPair;
  language: string;
  showLineNumbers: boolean;
  searchQuery: string;
  isMatch: boolean;
  isCurrentMatch: boolean;
  matchIndex: number;
  highlightStyle: typeof oneDark;
  onCopyLine: (content: string, lineNum: number) => void;
  copiedLine: number | null;
}

const UnifiedDiffLine = memo(function UnifiedDiffLine({
  line,
  lineIndex,
  wordPair,
  language,
  showLineNumbers,
  searchQuery,
  isMatch,
  isCurrentMatch,
  matchIndex,
  highlightStyle,
  onCopyLine,
  copiedLine,
}: UnifiedDiffLineProps) {
  const lineNum = line.oldLineNumber ?? line.newLineNumber ?? lineIndex;

  const getLineClass = () => {
    switch (line.type) {
      case 'added':
        return 'diff-line-added bg-svn-added/10';
      case 'removed':
        return 'diff-line-removed bg-svn-deleted/10';
      case 'hunk':
        return 'diff-line-hunk';
      default:
        return 'diff-line-context';
    }
  };

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

  const getPrefix = () => {
    switch (line.type) {
      case 'added':
        return '+';
      case 'removed':
        return '-';
      case 'hunk':
        return '';
      default:
        return ' ';
    }
  };

  // Highlight search match
  const highlightContent = (content: string) => {
    if (!searchQuery || !isMatch) return content;

    const parts = content.split(new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase() ? (
        <mark
          key={i}
          className={`${isCurrentMatch ? 'bg-accent text-white' : 'bg-warning/30'} px-0.5 rounded`}
        >
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  // Syntax highlight the content (without prefix)
  const renderContent = () => {
    if (line.type === 'hunk') {
      return <span className="text-text-muted">{line.content}</span>;
    }

    // Changed line with a counterpart: token-level highlight of the changed
    // part (#47). Takes precedence over syntax colours — which token changed
    // is the question this line exists to answer.
    if (wordPair && (line.type === 'added' || line.type === 'removed')) {
      const segments: WordDiffSegment[] =
        wordPair.side === 'old'
          ? computeWordDiff(wordPair.oldText, wordPair.newText).oldSegments
          : computeWordDiff(wordPair.oldText, wordPair.newText).newSegments;
      return (
        <span className={line.type === 'removed' ? 'text-svn-deleted' : ''}>
          {segments.map((segment, index) =>
            segment.changed ? (
              <span
                key={index}
                className={`rounded-sm ${
                  line.type === 'removed' ? 'bg-red-500/30' : 'bg-green-500/30'
                }`}
              >
                {segment.text}
              </span>
            ) : (
              segment.text
            )
          )}
        </span>
      );
    }

    // For code lines, apply syntax highlighting
    if (language !== 'text' && (line.type === 'added' || line.type === 'context')) {
      return (
        <SyntaxHighlighter
          language={language}
          style={highlightStyle}
          PreTag="span"
          CodeTag="span"
          customStyle={{
            margin: 0,
            padding: 0,
            background: 'transparent',
            fontSize: 'inherit',
            display: 'inline',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'inherit',
              display: 'inline',
            },
          }}
        >
          {line.content}
        </SyntaxHighlighter>
      );
    }

    return (
      <span className={line.type === 'removed' ? 'text-svn-deleted' : ''}>
        {highlightContent(line.content)}
      </span>
    );
  };

  return (
    <div
      className={`${getLineClass()} flex group relative`}
      data-match-index={isMatch ? matchIndex : undefined}
    >
      {/* Line number */}
      {showLineNumbers && (
        <div className="diff-line-number w-12 flex-shrink-0 text-right pr-3 text-text-faint select-none">
          {getLineNumber()}
        </div>
      )}

      {/* Prefix */}
      <div
        className={`diff-line-prefix w-4 flex-shrink-0 select-none ${
          line.type === 'added'
            ? 'text-svn-added'
            : line.type === 'removed'
              ? 'text-svn-deleted'
              : 'text-text-muted'
        }`}
      >
        {getPrefix()}
      </div>

      {/* Content */}
      <div className="diff-line-content flex-1 whitespace-pre overflow-x-auto pr-8">
        {renderContent()}
      </div>

      {/* Copy button on hover */}
      {line.type !== 'hunk' && (
        <button
          type="button"
          onClick={() => onCopyLine(line.content, lineNum)}
          className="absolute right-2 top-0 p-1 bg-bg-elevated border border-border rounded opacity-0 group-hover:opacity-100 hover:bg-bg-tertiary transition-fast"
          title="Copy line"
        >
          {copiedLine === lineNum ? (
            <Check className="w-3 h-3 text-success" />
          ) : (
            <Copy className="w-3 h-3 text-text-muted" />
          )}
        </button>
      )}
    </div>
  );
});

/**
 * Side-by-side diff view (two columns)
 */
const SideBySideDiffView = memo(function SideBySideDiffView({
  diff,
  language,
  showLineNumbers,
  showFileHeaders = true,
  searchQuery,
  searchMatches,
  currentMatchIndex,
  onCopyLine,
  copiedLine,
  isDarkTheme,
}: DiffViewProps) {
  const highlightStyle = isDarkTheme ? oneDark : oneLight;

  return (
    <div className="min-w-max">
      {diff.files.map((file, fileIndex) => (
        <div key={fileIndex} className="mb-4">
          {/* File header */}
          {showFileHeaders && (
            <div className="diff-file-header sticky top-0 bg-bg-elevated px-4 py-2 border-b border-border z-10">
              <span className="text-text font-medium">{file.newPath || file.oldPath}</span>
            </div>
          )}

          {/* Side-by-side hunks */}
          {file.hunks.map((hunk, hunkIndex) => (
            <SideBySideHunk
              key={hunkIndex}
              hunk={hunk}
              hunkIndex={hunkIndex}
              fileIndex={fileIndex}
              language={language}
              showLineNumbers={showLineNumbers}
              searchQuery={searchQuery}
              searchMatches={searchMatches}
              currentMatchIndex={currentMatchIndex}
              highlightStyle={highlightStyle}
              onCopyLine={onCopyLine}
              copiedLine={copiedLine}
              isDarkTheme={isDarkTheme}
            />
          ))}
        </div>
      ))}
    </div>
  );
});

/**
 * Side-by-side hunk view
 */
interface SideBySideHunkProps {
  hunk: SvnDiffHunk;
  hunkIndex: number;
  fileIndex: number;
  language: string;
  showLineNumbers: boolean;
  searchQuery: string;
  searchMatches: Array<{ fileIndex: number; hunkIndex: number; lineIndex: number }>;
  currentMatchIndex: number;
  highlightStyle: typeof oneDark;
  onCopyLine: (content: string, lineNum: number) => void;
  copiedLine: number | null;
  isDarkTheme: boolean;
}

const SideBySideHunk = memo(function SideBySideHunk({
  hunk,
  hunkIndex,
  fileIndex,
  language,
  showLineNumbers,
  searchQuery,
  searchMatches,
  currentMatchIndex,
  highlightStyle,
  onCopyLine,
  copiedLine,
  isDarkTheme,
}: SideBySideHunkProps) {
  // Aligned rows with gap filling, shared with the VirtualizedDiffViewer (#47).
  const pairedLines = useMemo(() => buildSideBySideRows(hunk.lines), [hunk.lines]);

  // Word-diff segments per row, computed once for both sides (#47).
  const wordDiffs = useMemo(() => {
    return pairedLines.map((pair) => {
      if (!pair.paired || !pair.left || !pair.right) return null;
      if (pair.left.content === pair.right.content) return null;
      return computeWordDiff(pair.left.content, pair.right.content);
    });
  }, [pairedLines]);

  return (
    <div>
      {/* Hunk header */}
      <div className="diff-hunk-header bg-bg-tertiary px-4 py-1 text-text-muted text-xs">
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </div>

      {/* Side-by-side content */}
      <div className="flex">
        {/* Left (old) side */}
        <div className="flex-1 border-r border-border">
          <div className="bg-bg-secondary/50 px-2 py-1 text-xs text-text-muted border-b border-border text-center">
            Original
          </div>
          {pairedLines.map((pair, idx) => (
            <SideBySideLine
              key={`old-${idx}`}
              line={pair.left}
              side="old"
              lineIndex={pair.leftIndex}
              wordSegments={wordDiffs[idx]?.oldSegments}
              language={language}
              showLineNumbers={showLineNumbers}
              searchQuery={searchQuery}
              isMatch={
                pair.leftIndex >= 0 &&
                searchMatches.some(
                  (m) =>
                    m.fileIndex === fileIndex &&
                    m.hunkIndex === hunkIndex &&
                    m.lineIndex === pair.leftIndex
                )
              }
              isCurrentMatch={
                pair.leftIndex >= 0 &&
                searchMatches[currentMatchIndex]?.fileIndex === fileIndex &&
                searchMatches[currentMatchIndex]?.hunkIndex === hunkIndex &&
                searchMatches[currentMatchIndex]?.lineIndex === pair.leftIndex
              }
              highlightStyle={highlightStyle}
              onCopyLine={onCopyLine}
              copiedLine={copiedLine}
              isDarkTheme={isDarkTheme}
            />
          ))}
        </div>

        {/* Right (new) side */}
        <div className="flex-1">
          <div className="bg-bg-secondary/50 px-2 py-1 text-xs text-text-muted border-b border-border text-center">
            Modified
          </div>
          {pairedLines.map((pair, idx) => (
            <SideBySideLine
              key={`new-${idx}`}
              line={pair.right}
              side="new"
              lineIndex={pair.rightIndex}
              wordSegments={wordDiffs[idx]?.newSegments}
              language={language}
              showLineNumbers={showLineNumbers}
              searchQuery={searchQuery}
              isMatch={
                pair.rightIndex >= 0 &&
                searchMatches.some(
                  (m) =>
                    m.fileIndex === fileIndex &&
                    m.hunkIndex === hunkIndex &&
                    m.lineIndex === pair.rightIndex
                )
              }
              isCurrentMatch={
                pair.rightIndex >= 0 &&
                searchMatches[currentMatchIndex]?.fileIndex === fileIndex &&
                searchMatches[currentMatchIndex]?.hunkIndex === hunkIndex &&
                searchMatches[currentMatchIndex]?.lineIndex === pair.rightIndex
              }
              highlightStyle={highlightStyle}
              onCopyLine={onCopyLine}
              copiedLine={copiedLine}
              isDarkTheme={isDarkTheme}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

/**
 * Single line in side-by-side diff view
 */
interface SideBySideLineProps {
  line: SvnDiffLine | null;
  side: 'old' | 'new';
  lineIndex: number;
  /** Token segments for the changed part of a changed pair (#47). */
  wordSegments?: WordDiffSegment[];
  language: string;
  showLineNumbers: boolean;
  searchQuery: string;
  isMatch: boolean;
  isCurrentMatch: boolean;
  highlightStyle: typeof oneDark;
  onCopyLine: (content: string, lineNum: number) => void;
  copiedLine: number | null;
  isDarkTheme: boolean;
}

const SideBySideLine = memo(function SideBySideLine({
  line,
  side,
  lineIndex: _lineIndex,
  wordSegments,
  language,
  showLineNumbers,
  searchQuery: _searchQuery,
  isMatch,
  isCurrentMatch,
  highlightStyle,
  onCopyLine,
  copiedLine,
  isDarkTheme: _isDarkTheme,
}: SideBySideLineProps) {
  if (!line) {
    // Empty cell for alignment
    return (
      <div className="flex min-h-[20px] bg-bg-tertiary/30">
        {showLineNumbers && <div className="w-10 flex-shrink-0" />}
        <div className="flex-1" />
      </div>
    );
  }

  const getLineClass = () => {
    if (side === 'old' && line.type === 'removed') {
      return 'bg-svn-deleted/15';
    }
    if (side === 'new' && line.type === 'added') {
      return 'bg-svn-added/15';
    }
    if (line.type === 'hunk') {
      return 'bg-bg-tertiary';
    }
    return '';
  };

  const getLineNumber = () => {
    if (side === 'old' && line.oldLineNumber !== undefined) {
      return line.oldLineNumber;
    }
    if (side === 'new' && line.newLineNumber !== undefined) {
      return line.newLineNumber;
    }
    if (line.type === 'context') {
      return side === 'old' ? line.oldLineNumber : line.newLineNumber;
    }
    return '';
  };

  // Syntax highlight for added/context lines
  const renderContent = () => {
    if (line.type === 'hunk') {
      return <span className="text-text-muted">{line.content}</span>;
    }

    // Token-level highlight of the changed part of a changed pair (#47).
    if (wordSegments && wordSegments.some((segment) => segment.changed)) {
      return (
        <span className={line.type === 'removed' ? 'text-svn-deleted' : ''}>
          {wordSegments.map((segment, index) =>
            segment.changed ? (
              <span
                key={index}
                className={`rounded-sm ${
                  line.type === 'removed' ? 'bg-red-500/30' : 'bg-green-500/30'
                }`}
              >
                {segment.text}
              </span>
            ) : (
              segment.text
            )
          )}
        </span>
      );
    }

    if (language !== 'text' && line.type !== 'removed') {
      return (
        <SyntaxHighlighter
          language={language}
          style={highlightStyle}
          PreTag="span"
          CodeTag="span"
          customStyle={{
            margin: 0,
            padding: 0,
            background: 'transparent',
            fontSize: 'inherit',
            display: 'inline',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'inherit',
              display: 'inline',
            },
          }}
        >
          {line.content}
        </SyntaxHighlighter>
      );
    }

    return (
      <span className={line.type === 'removed' ? 'text-svn-deleted' : ''}>{line.content}</span>
    );
  };

  const lineNum = getLineNumber();

  return (
    <div className={`flex min-h-[20px] group relative ${getLineClass()}`}>
      {/* Line number */}
      {showLineNumbers && (
        <div className="w-10 flex-shrink-0 text-right pr-2 text-text-faint select-none text-[10px]">
          {lineNum}
        </div>
      )}

      {/* Content */}
      <div
        className={`flex-1 whitespace-pre overflow-hidden px-1 ${
          isCurrentMatch ? 'bg-accent/30' : isMatch ? 'bg-warning/20' : ''
        }`}
      >
        {renderContent()}
      </div>

      {/* Copy button */}
      {line.type !== 'hunk' && (
        <button
          type="button"
          onClick={() => onCopyLine(line.content, lineNum as number)}
          className="absolute right-1 top-0 p-0.5 bg-bg-elevated border border-border rounded opacity-0 group-hover:opacity-100 hover:bg-bg-tertiary transition-fast"
          title="Copy line"
        >
          {copiedLine === lineNum ? (
            <Check className="w-3 h-3 text-success" />
          ) : (
            <Copy className="w-3 h-3 text-text-muted" />
          )}
        </button>
      )}
    </div>
  );
});

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default EnhancedDiffViewer;
