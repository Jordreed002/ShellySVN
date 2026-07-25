import { useState, useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SvnStatusEntry, SvnStatusChar } from '@shared/types';
import { assertSuccessfulSvnRead } from '@renderer/utils/svnReadResult';

export interface IncrementalStatusProgress {
  phase: 'idle' | 'scanning' | 'processing' | 'complete' | 'error';
  filesScanned: number;
  totalFiles?: number;
  currentPath?: string;
  startTime: number;
  elapsedTime: number;
  error?: string;
}

export interface IncrementalStatusResult {
  entries: SvnStatusEntry[];
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
  conflictedCount: number;
  unversionedCount: number;
  lockedCount: number;
}

export interface StatusUpdateEvent {
  type: 'progress' | 'entry' | 'complete' | 'error';
  progress?: IncrementalStatusProgress;
  entry?: SvnStatusEntry;
  result?: IncrementalStatusResult;
  error?: string;
}

type StatusUpdateCallback = (event: StatusUpdateEvent) => void;

interface IncrementalStatusOptions {
  /**
   * Path to scan
   */
  path: string;

  /**
   * Whether to include unversioned files
   */
  includeUnversioned?: boolean;

  /**
   * Whether to include external directories
   */
  includeExternals?: boolean;

  /**
   * Depth of scanning ('empty', 'files', 'immediates', 'infinity')
   */
  depth?: 'empty' | 'files' | 'immediates' | 'infinity';

  /**
   * Maximum files to scan before pausing for UI update
   */
  batchSize?: number;

  /**
   * Callback for status updates
   */
  onUpdate?: StatusUpdateCallback;

  /**
   * Enable file system watching for auto-refresh
   */
  enableWatch?: boolean;

  /**
   * Debounce interval for watch updates (ms)
   */
  watchDebounce?: number;
}

/**
 * Hook for incremental/streaming SVN status updates
 *
 * This hook provides real-time status updates as files are scanned,
 * allowing the UI to progressively display results instead of waiting
 * for the entire scan to complete.
 */
export function useIncrementalStatus(options: IncrementalStatusOptions) {
  const { path, batchSize = 100, onUpdate, enableWatch = false, watchDebounce = 1000 } = options;

  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<IncrementalStatusProgress>({
    phase: 'idle',
    filesScanned: 0,
    startTime: 0,
    elapsedTime: 0,
  });
  const [result, setResult] = useState<IncrementalStatusResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const entriesRef = useRef<SvnStatusEntry[]>([]);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  /**
   * Start incremental status scan
   */
  const startScan = useCallback(async () => {
    // Cancel any existing scan
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    entriesRef.current = [];

    const startTime = Date.now();

    setProgress({
      phase: 'scanning',
      filesScanned: 0,
      startTime,
      elapsedTime: 0,
    });
    setIsScanning(true);
    setResult(null);

    try {
      // First, get the raw status output
      const statusResult = await window.api.svn.status(path, {
        signal: abortControllerRef.current.signal,
      });
      assertSuccessfulSvnRead(statusResult);

      if (abortControllerRef.current?.signal.aborted) {
        return;
      }

      const entries = statusResult.entries || [];
      const totalFiles = entries.length;

      setProgress((prev) => ({
        ...prev,
        phase: 'processing',
        totalFiles,
      }));

      // Process entries in batches for smooth UI updates
      for (let i = 0; i < entries.length; i += batchSize) {
        if (abortControllerRef.current?.signal.aborted) {
          return;
        }

        const batch = entries.slice(i, i + batchSize);

        // Add entries to our collection
        entriesRef.current.push(...batch);

        // Calculate counts
        const currentResult = calculateResult(entriesRef.current);
        setResult(currentResult);

        // Update progress
        const progressUpdate: IncrementalStatusProgress = {
          phase: 'processing',
          filesScanned: entriesRef.current.length,
          totalFiles,
          currentPath: batch[batch.length - 1]?.path,
          startTime,
          elapsedTime: Date.now() - startTime,
        };

        setProgress(progressUpdate);

        // Notify callback
        onUpdateRef.current?.({
          type: 'progress',
          progress: progressUpdate,
        });

        // Emit individual entries
        for (const entry of batch) {
          onUpdateRef.current?.({
            type: 'entry',
            entry,
          });
        }

        // Yield to UI thread
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      // Complete
      const finalResult = calculateResult(entriesRef.current);
      const finalProgress: IncrementalStatusProgress = {
        phase: 'complete',
        filesScanned: entriesRef.current.length,
        totalFiles,
        startTime,
        elapsedTime: Date.now() - startTime,
      };

      setProgress(finalProgress);
      setResult(finalResult);
      setIsScanning(false);

      // These fs:* keys contain FsStatusResult, not SvnStatusResult. Mark them
      // stale so active filesystem consumers refetch the correctly shaped data.
      void queryClient.invalidateQueries({ queryKey: ['fs:getStatus', path] });
      void queryClient.invalidateQueries({ queryKey: ['fs:getDeepStatus', path] });

      onUpdateRef.current?.({
        type: 'complete',
        result: finalResult,
        progress: finalProgress,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      setProgress((prev) => ({
        ...prev,
        phase: 'error',
        error: errorMessage,
      }));
      setIsScanning(false);

      onUpdateRef.current?.({
        type: 'error',
        error: errorMessage,
      });
    }
  }, [path, batchSize, queryClient]);

  /**
   * Cancel ongoing scan
   */
  const cancelScan = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setProgress((prev) => ({
      ...prev,
      phase: 'idle',
    }));
    setIsScanning(false);
  }, []);

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    cancelScan();
    entriesRef.current = [];
    setResult(null);
    setProgress({
      phase: 'idle',
      filesScanned: 0,
      startTime: 0,
      elapsedTime: 0,
    });
  }, [cancelScan]);

  // File system watching for auto-refresh
  useEffect(() => {
    if (!enableWatch || !path) return;

    // Debounce function for rapid changes
    const debounce = <T extends (...args: unknown[]) => unknown>(fn: T, delay: number) => {
      let timeoutId: ReturnType<typeof setTimeout>;
      return (...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
      };
    };

    const debouncedScan = debounce(() => {
      startScan();
    }, watchDebounce);

    const cleanup = window.api.fs.watch(path, debouncedScan, { watchSvnOnly: false });

    return () => {
      if (cleanup) cleanup();
    };
  }, [enableWatch, path, watchDebounce, startScan]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    progress,
    result,
    isScanning,
    entries: entriesRef.current,
    startScan,
    cancelScan,
    reset,
  };
}

/**
 * Calculate result statistics from entries
 */
function calculateResult(entries: SvnStatusEntry[]): IncrementalStatusResult {
  let addedCount = 0;
  let modifiedCount = 0;
  let deletedCount = 0;
  let conflictedCount = 0;
  let unversionedCount = 0;
  let lockedCount = 0;

  for (const entry of entries) {
    switch (entry.status) {
      case 'A':
        addedCount++;
        break;
      case 'M':
      case 'R':
        modifiedCount++;
        break;
      case 'D':
        deletedCount++;
        break;
      case 'C':
        conflictedCount++;
        break;
      case '?':
        unversionedCount++;
        break;
    }

    if (entry.lock) {
      lockedCount++;
    }
  }

  return {
    entries,
    addedCount,
    modifiedCount,
    deletedCount,
    conflictedCount,
    unversionedCount,
    lockedCount,
  };
}

/**
 * Get status icon and color based on status character
 */
export function getStatusDisplay(status: SvnStatusChar): {
  icon: string;
  color: string;
  label: string;
} {
  const display: Record<SvnStatusChar, { icon: string; color: string; label: string }> = {
    ' ': { icon: ' ', color: 'text-green-600', label: 'Normal' },
    A: { icon: '+', color: 'text-green-500', label: 'Added' },
    C: { icon: '!', color: 'text-red-500', label: 'Conflicted' },
    D: { icon: '-', color: 'text-red-400', label: 'Deleted' },
    I: { icon: 'i', color: 'text-gray-400', label: 'Ignored' },
    M: { icon: 'M', color: 'text-yellow-500', label: 'Modified' },
    R: { icon: 'R', color: 'text-blue-500', label: 'Replaced' },
    X: { icon: 'X', color: 'text-purple-500', label: 'External' },
    '?': { icon: '?', color: 'text-gray-500', label: 'Unversioned' },
    '!': { icon: '!', color: 'text-red-600', label: 'Missing' },
    '~': { icon: '~', color: 'text-orange-500', label: 'Obstructed' },
    O: { icon: 'O', color: 'text-info', label: 'Remote Only' },
  };

  return display[status] ?? display[' '];

  switch (status) {
    case 'A':
      return { icon: '➕', color: 'text-green-500', label: 'Added' };
    case 'C':
      return { icon: '⚠️', color: 'text-red-500', label: 'Conflicted' };
    case 'D':
      return { icon: '🗑️', color: 'text-red-400', label: 'Deleted' };
    case 'I':
      return { icon: '🚫', color: 'text-gray-400', label: 'Ignored' };
    case 'M':
      return { icon: '✏️', color: 'text-yellow-500', label: 'Modified' };
    case 'R':
      return { icon: '🔄', color: 'text-blue-500', label: 'Replaced' };
    case 'X':
      return { icon: '🔗', color: 'text-purple-500', label: 'External' };
    case '?':
      return { icon: '❓', color: 'text-gray-500', label: 'Unversioned' };
    case '!':
      return { icon: '❌', color: 'text-red-600', label: 'Missing' };
    case '~':
      return { icon: '⛔', color: 'text-orange-500', label: 'Obstructed' };
    default:
      return { icon: '✓', color: 'text-green-600', label: 'Normal' };
  }
}

/**
 * Format elapsed time for display
 */
export function formatElapsedTime(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
