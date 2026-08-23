import { useState, useEffect, useMemo, memo, useRef, useCallback, lazy, Suspense } from 'react';
import {
  X,
  FileText,
  FileImage,
  FileCode,
  File,
  Copy,
  Check,
  ChevronRight,
  RotateCw,
  GitCompare,
  Maximize2,
  FileX,
} from 'lucide-react';
import type { SvnDiffResult } from '@shared/types';
import { detectLanguage } from '../../utils/detectLanguage';
import { withIpcTimeout } from '../../lib/queryTimeout';
import {
  applyDiffOptions,
  DEFAULT_DIFF_DISPLAY_OPTIONS,
  type DiffDisplayOptions,
} from '../../lib/diffOptions';
import { ErrorPanel } from './ErrorPanel';

const CodeHighlighter = lazy(() =>
  import('./CodeHighlighter').then((m) => ({ default: m.CodeHighlighter }))
);

export interface FilePreviewProps {
  filePath: string | null;
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void;
  onDiff?: (filePath: string) => void;
  className?: string;
}

type ImageZoomLevel = 'fit' | '100' | '200';

// Binary file extensions that should not be displayed as text
const BINARY_EXTENSIONS = new Set([
  // Executables
  'exe',
  'dll',
  'so',
  'dylib',
  'app',
  'dmg',
  'msi',
  // Archives
  'zip',
  'tar',
  'gz',
  'rar',
  '7z',
  'bz2',
  'xz',
  // Documents
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  // Media (non-previewable)
  'mp3',
  'mp4',
  'wav',
  'avi',
  'mov',
  'mkv',
  'flac',
  'ogg',
  'wma',
  'wmv',
  // Database
  'db',
  'sqlite',
  'sqlite3',
  // Fonts
  'ttf',
  'otf',
  'woff',
  'woff2',
  'eot',
  // Other binary
  'bin',
  'iso',
  'img',
  'class',
  'jar',
  'war',
  'ear',
  'pyc',
  'pyo',
]);

export const FilePreview = memo(function FilePreview({
  filePath,
  isOpen,
  onClose,
  onOpen,
  onDiff,
  className = '',
}: FilePreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Image state
  const [imageZoom, setImageZoom] = useState<ImageZoomLevel>('fit');
  const [imageRotation, setImageRotation] = useState(0);

  // Diff state
  const [diffContent, setDiffContent] = useState<string | null>(null);
  /** Parsed diff, kept so the whitespace options can re-compute it (#47). */
  const [diffResult, setDiffResult] = useState<SvnDiffResult | null>(null);
  const [diffDisplayOptions, setDiffDisplayOptions] =
    useState<DiffDisplayOptions>(DEFAULT_DIFF_DISPLAY_OPTIONS);
  const [isDiffLoading, setIsDiffLoading] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  /** Bumped by the error panel's Retry to re-run the content read. */
  const [contentReloadNonce, setContentReloadNonce] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setActiveFilePath(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setActiveFilePath(filePath);
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [filePath, isOpen]);

  const fileType = useMemo(() => {
    if (!activeFilePath) return null;
    const ext = activeFilePath.split('.').pop()?.toLowerCase() || '';

    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg', 'bmp'].includes(ext)) {
      return 'image';
    }
    if (BINARY_EXTENSIONS.has(ext)) {
      return 'binary';
    }
    if (
      [
        'ts',
        'tsx',
        'js',
        'jsx',
        'py',
        'rb',
        'go',
        'rs',
        'java',
        'c',
        'cpp',
        'h',
        'cs',
        'swift',
        'kt',
        'php',
        'vue',
        'svelte',
      ].includes(ext)
    ) {
      return 'code';
    }
    if (['json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env', 'config'].includes(ext)) {
      return 'config';
    }
    if (['md', 'txt', 'rst', 'log'].includes(ext)) {
      return 'text';
    }
    return 'unknown';
  }, [activeFilePath]);

  // Get syntax highlighting language
  const language = useMemo(() => {
    if (!activeFilePath || (fileType !== 'code' && fileType !== 'config')) return 'text';
    return detectLanguage(activeFilePath);
  }, [activeFilePath, fileType]);

  // Reset state when file changes
  useEffect(() => {
    setImageZoom('fit');
    setImageRotation(0);
    setShowDiff(false);
    setDiffContent(null);
    setDiffResult(null);
    setDiffDisplayOptions(DEFAULT_DIFF_DISPLAY_OPTIONS);
    setDiffError(null);
    setError(null);
  }, [activeFilePath]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeFilePath || !isOpen || fileType === 'image' || fileType === 'binary') {
      setContent(null);
      return;
    }

    let cancelled = false;

    const loadContent = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // The deadline makes a wedged read an error the panel can show (and
        // retry) rather than a spinner that never resolves.
        const result = await withIpcTimeout(
          () => window.api.fs.readFile(activeFilePath),
          undefined,
          'fs:readFile'
        );
        if (cancelled) return;
        if (result.success && result.content) {
          setContent(result.content);
        } else {
          setError(result.error || 'Failed to read file');
        }
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadContent();

    return () => {
      cancelled = true;
    };
  }, [activeFilePath, isOpen, fileType, contentReloadNonce]);

  // Load diff when requested
  const loadDiff = useCallback(async () => {
    if (!activeFilePath || isDiffLoading) return;

    setIsDiffLoading(true);
    setDiffError(null);
    try {
      const result = await withIpcTimeout(
        () => window.api.svn.diff(activeFilePath),
        undefined,
        'svn:diff'
      );
      if (result && result.files && result.files.length > 0) {
        setDiffResult(result);
        // Format diff content for the clipboard copy
        const diffText = result.files
          .map((file) => {
            const hunks = file.hunks
              .map((hunk) => {
                const lines = hunk.lines
                  .map((line) => {
                    const prefix =
                      line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
                    return `${prefix}${line.content}`;
                  })
                  .join('\n');
                return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${lines}`;
              })
              .join('\n');
            return `--- ${file.oldPath}\n+++ ${file.newPath}\n${hunks}`;
          })
          .join('\n');
        setDiffContent(diffText);
        setShowDiff(true);
      } else {
        setDiffResult(result ?? null);
        setDiffContent('No changes detected');
        setShowDiff(true);
      }
    } catch (err) {
      setDiffError((err as Error).message);
    } finally {
      setIsDiffLoading(false);
    }
  }, [activeFilePath, isDiffLoading]);

  const handleCopy = async () => {
    const textToCopy = showDiff && diffContent ? diffContent : content;
    if (textToCopy) {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleImageZoom = (level: ImageZoomLevel) => {
    setImageZoom(level);
  };

  const handleImageRotate = () => {
    setImageRotation((prev) => (prev + 90) % 360);
  };

  const handleToggleDiff = () => {
    if (showDiff) {
      setShowDiff(false);
      setDiffContent(null);
    } else {
      loadDiff();
    }
  };

  const handleOpenFullDiff = () => {
    if (activeFilePath && onDiff) {
      onDiff(activeFilePath);
    }
  };

  const filename = activeFilePath
    ? activeFilePath.split(/[/\\]/).pop() || activeFilePath
    : 'Preview';

  // Memoize truncated content for performance
  const displayContent = useMemo(() => {
    const textContent = showDiff && diffContent ? diffContent : content;
    if (!textContent) return null;
    // Limit to 30KB for better performance
    if (textContent.length > 30000) {
      return textContent.slice(0, 30000) + '\n\n... (content truncated)';
    }
    return textContent;
  }, [content, diffContent, showDiff]);

  // Image zoom style
  const imageStyle = useMemo(() => {
    const baseStyle: React.CSSProperties = {
      transform: `rotate(${imageRotation}deg)`,
    };

    if (imageZoom === 'fit') {
      return {
        ...baseStyle,
        maxWidth: '100%',
        maxHeight: '100%',
        objectFit: 'contain' as const,
      };
    }

    const scale = imageZoom === '100' ? 1 : 2;
    return {
      ...baseStyle,
      transform: `rotate(${imageRotation}deg) scale(${scale})`,
      transformOrigin: 'center center',
    };
  }, [imageZoom, imageRotation]);

  if (!isOpen) {
    return onOpen ? (
      <button
        onClick={onOpen}
        className="absolute right-0 top-1/2 z-30 -translate-y-1/2 p-2 bg-bg-tertiary border border-border rounded-l hover:bg-bg-elevated transition-fast"
        title="Open preview panel"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    ) : null;
  }

  return (
    <div
      className={`
        absolute right-0 top-0 bottom-0 z-20 w-80
        flex flex-col bg-bg-secondary border-l border-border shadow-xl
        transition-transform duration-150 ease-out overflow-hidden
        will-change-transform min-h-0
        translate-x-0
        ${className}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-bg-tertiary border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          {fileType === 'image' && <FileImage className="w-4 h-4 text-accent flex-shrink-0" />}
          {fileType === 'code' && <FileCode className="w-4 h-4 text-accent flex-shrink-0" />}
          {fileType === 'config' && <FileText className="w-4 h-4 text-warning flex-shrink-0" />}
          {fileType === 'text' && <FileText className="w-4 h-4 text-text-muted flex-shrink-0" />}
          {fileType === 'binary' && <FileX className="w-4 h-4 text-text-muted flex-shrink-0" />}
          {fileType === 'unknown' && <File className="w-4 h-4 text-text-muted flex-shrink-0" />}
          <span className="text-sm font-medium text-text truncate">{filename}</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Diff button for text-based files */}
          {fileType !== 'image' && fileType !== 'binary' && content && onDiff && (
            <button
              onClick={handleToggleDiff}
              className={`btn-icon-sm ${showDiff ? 'bg-accent/20 text-accent' : ''}`}
              title={showDiff ? 'Show file content' : 'Quick diff against BASE'}
              disabled={isDiffLoading}
            >
              <GitCompare className="w-3.5 h-3.5" />
            </button>
          )}
          {/* Open in full diff viewer */}
          {showDiff && onDiff && (
            <button
              onClick={handleOpenFullDiff}
              className="btn-icon-sm"
              title="Open in full diff viewer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}
          {(content || diffContent) && (
            <button onClick={handleCopy} className="btn-icon-sm" title="Copy content">
              {copied ? (
                <Check className="w-3.5 h-3.5 text-success" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}
          <button onClick={onClose} className="btn-icon-sm" title="Close preview">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Image Controls */}
      {fileType === 'image' && isOpen && (
        <div className="flex items-center gap-1 px-4 py-2 bg-bg-tertiary border-b border-border">
          <button
            onClick={() => handleImageZoom('fit')}
            className={`btn-icon-sm text-xs px-2 ${imageZoom === 'fit' ? 'bg-accent/20 text-accent' : ''}`}
            title="Fit to panel"
          >
            Fit
          </button>
          <button
            onClick={() => handleImageZoom('100')}
            className={`btn-icon-sm text-xs px-2 ${imageZoom === '100' ? 'bg-accent/20 text-accent' : ''}`}
            title="100% zoom"
          >
            100%
          </button>
          <button
            onClick={() => handleImageZoom('200')}
            className={`btn-icon-sm text-xs px-2 ${imageZoom === '200' ? 'bg-accent/20 text-accent' : ''}`}
            title="200% zoom"
          >
            200%
          </button>
          <div className="w-px h-4 bg-border mx-1" />
          <button onClick={handleImageRotate} className="btn-icon-sm" title="Rotate 90°">
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {!activeFilePath ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <File className="w-12 h-12 text-text-muted mb-3" />
            <p className="text-sm text-text-muted">Select a file to preview</p>
          </div>
        ) : isLoading || isDiffLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="spinner" />
          </div>
        ) : error ? (
          <ErrorPanel
            title="Preview unavailable"
            message={error}
            onRetry={() => setContentReloadNonce((nonce) => nonce + 1)}
          />
        ) : diffError ? (
          <ErrorPanel
            title="Diff unavailable"
            message={diffError}
            onRetry={() => void loadDiff()}
          />
        ) : fileType === 'binary' ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <FileX className="w-12 h-12 text-text-muted mb-3" />
            <p className="text-sm text-text-muted mb-1">Binary file</p>
            <p className="text-xs text-text-muted">Cannot preview binary content</p>
          </div>
        ) : fileType === 'image' ? (
          <div
            ref={imageContainerRef}
            className="flex items-center justify-center h-full p-4 overflow-auto"
          >
            <img
              src={`file://${activeFilePath}`}
              alt={filename}
              style={imageStyle}
              className="rounded transition-transform duration-200"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                setError('Failed to load image');
              }}
            />
          </div>
        ) : showDiff && diffResult ? (
          <QuickDiff result={diffResult} options={diffDisplayOptions} onOptionsChange={setDiffDisplayOptions} />
        ) : showDiff && diffContent ? (
          <div className="h-full overflow-auto font-mono text-xs">
            <pre className="p-4 text-text-secondary whitespace-pre-wrap break-all leading-relaxed">
              {displayContent}
            </pre>
          </div>
        ) : displayContent && (fileType === 'code' || fileType === 'config') ? (
          <Suspense
            fallback={
              <pre className="p-4 text-xs font-mono text-text-secondary whitespace-pre-wrap break-all leading-relaxed">
                {displayContent}
              </pre>
            }
          >
            <CodeHighlighter
              code={displayContent}
              language={language}
              showLineNumbers={true}
              maxHeight="100%"
            />
          </Suspense>
        ) : displayContent ? (
          <pre className="p-4 text-xs font-mono text-text-secondary whitespace-pre-wrap break-all leading-relaxed">
            {displayContent}
          </pre>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <File className="w-12 h-12 text-text-muted mb-3" />
            <p className="text-sm text-text-muted">No content available</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-bg-tertiary border-t border-border text-xs text-text-muted truncate">
        {showDiff
          ? `Diff: ${activeFilePath || 'No file selected'}`
          : activeFilePath || 'No file selected'}
      </div>
    </div>
  );
});

/**
 * Quick diff for the narrow preview panel: the parsed hunks rendered with
 * add/remove colouring, plus the ignore-whitespace / ignore-EOL options that
 * re-compute the hunks client-side (#47). The full viewer is one click away
 * via the expand button.
 */
function QuickDiff({
  result,
  options,
  onOptionsChange,
}: {
  result: SvnDiffResult;
  options: DiffDisplayOptions;
  onOptionsChange: (options: DiffDisplayOptions) => void;
}) {
  const effective = useMemo(
    () => applyDiffOptions(result, options) ?? result,
    [result, options]
  );

  const rows = useMemo(() => {
    const out: Array<{ kind: 'context' | 'added' | 'removed'; text: string }> = [];
    for (const file of effective.files) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.type === 'context' || line.type === 'added' || line.type === 'removed') {
            out.push({ kind: line.type, text: line.content });
          }
        }
      }
    }
    return out;
  }, [effective]);

  if (!effective.hasChanges || rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <FileText className="h-8 w-8 text-text-muted" aria-hidden="true" />
        <p className="text-xs text-text-muted">
          {options.ignoreWhitespace || options.ignoreEol
            ? 'No differences beyond whitespace'
            : 'No changes detected'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col min-h-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-tertiary px-3 py-1.5 text-[11px] text-text-secondary">
        <label className="flex cursor-pointer items-center gap-1">
          <input
            type="checkbox"
            className="accent-accent"
            checked={options.ignoreWhitespace}
            onChange={() =>
              onOptionsChange({ ...options, ignoreWhitespace: !options.ignoreWhitespace })
            }
          />
          Ignore whitespace
        </label>
        <label className="flex cursor-pointer items-center gap-1">
          <input
            type="checkbox"
            className="accent-accent"
            checked={options.ignoreEol}
            onChange={() => onOptionsChange({ ...options, ignoreEol: !options.ignoreEol })}
          />
          Ignore EOL
        </label>
      </div>
      <div className="flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed">
        {rows.map((row, index) => (
          <div
            key={index}
            className={`whitespace-pre-wrap break-all border-l-2 pl-1.5 ${
              row.kind === 'added'
                ? 'border-svn-added bg-svn-added/10 text-text'
                : row.kind === 'removed'
                  ? 'border-svn-deleted bg-svn-deleted/10 text-text'
                  : 'border-transparent text-text-secondary'
            }`}
          >
            {row.kind === 'added' ? '+ ' : row.kind === 'removed' ? '- ' : '  '}
            {row.text === '' ? ' ' : row.text}
          </div>
        ))}
      </div>
    </div>
  );
}
