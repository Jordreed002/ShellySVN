import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SvnStatusEntry } from '@shared/types';

type SelectEvent = {
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
};

type VirtualizerLike = {
  scrollToIndex: (index: number, options?: { align?: 'auto' | 'start' | 'center' | 'end' }) => void;
};

export function useFileExplorerSelection(entries: SvnStatusEntry[]) {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const pathIndex = useMemo(() => {
    const indexByPath = new Map<string, number>();
    entries.forEach((entry, index) => {
      indexByPath.set(entry.path, index);
    });
    return indexByPath;
  }, [entries]);

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
    setFocusedIndex(-1);
    setLastSelectedIndex(-1);
  }, []);

  const handleSelect = useCallback(
    (entry: SvnStatusEntry, event?: SelectEvent) => {
      const entryIndex = pathIndex.get(entry.path) ?? -1;
      if (entryIndex < 0) return;

      if (event?.shiftKey && lastSelectedIndex >= 0) {
        const start = Math.min(lastSelectedIndex, entryIndex);
        const end = Math.max(lastSelectedIndex, entryIndex);
        const rangePaths = new Set<string>();
        for (let index = start; index <= end; index++) {
          rangePaths.add(entries[index].path);
        }
        setSelectedPaths(rangePaths);
        setFocusedIndex(entryIndex);
        return;
      }

      if (event?.ctrlKey || event?.metaKey) {
        setSelectedPaths((previous) => {
          const next = new Set(previous);
          if (next.has(entry.path)) {
            next.delete(entry.path);
          } else {
            next.add(entry.path);
          }
          return next;
        });
        setLastSelectedIndex(entryIndex);
        setFocusedIndex(entryIndex);
        return;
      }

      setSelectedPaths(new Set([entry.path]));
      setLastSelectedIndex(entryIndex);
      setFocusedIndex(entryIndex);
    },
    [entries, lastSelectedIndex, pathIndex]
  );

  return {
    selectedPaths,
    focusedIndex,
    setSelectedPaths,
    setFocusedIndex,
    clearSelection,
    handleSelect,
  };
}

interface KeyboardNavigationOptions {
  entries: SvnStatusEntry[];
  selectedPaths: Set<string>;
  focusedIndex: number;
  virtualizer: VirtualizerLike;
  disabled: boolean;
  onNavigateToEntry: (entry: SvnStatusEntry) => void;
  setSelectedPaths: (paths: Set<string> | ((previous: Set<string>) => Set<string>)) => void;
  setFocusedIndex: (index: number) => void;
}

export function useFileExplorerKeyboardNavigation({
  entries,
  selectedPaths,
  focusedIndex,
  virtualizer,
  disabled,
  onNavigateToEntry,
  setSelectedPaths,
  setFocusedIndex,
}: KeyboardNavigationOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (disabled) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();

        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex =
          focusedIndex < 0
            ? direction === 1
              ? 0
              : entries.length - 1
            : Math.max(0, Math.min(entries.length - 1, focusedIndex + direction));

        if (entries.length === 0) return;

        if (event.shiftKey) {
          setSelectedPaths((previous) => {
            const next = new Set(previous);
            next.add(entries[nextIndex].path);
            return next;
          });
        } else {
          setSelectedPaths(new Set([entries[nextIndex].path]));
        }

        setFocusedIndex(nextIndex);
        virtualizer.scrollToIndex(nextIndex, { align: 'auto' });
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        setSelectedPaths(new Set(entries.map((entry) => entry.path)));
      }

      if (event.key === 'Escape') {
        setSelectedPaths(new Set());
        setFocusedIndex(-1);
      }

      if (event.key === 'Enter' && focusedIndex >= 0) {
        const entry = entries[focusedIndex];
        if (entry?.isDirectory) {
          onNavigateToEntry(entry);
        }
      }

      if (event.key === 'Delete' && selectedPaths.size > 0) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    disabled,
    entries,
    focusedIndex,
    onNavigateToEntry,
    selectedPaths.size,
    setFocusedIndex,
    setSelectedPaths,
    virtualizer,
  ]);
}
