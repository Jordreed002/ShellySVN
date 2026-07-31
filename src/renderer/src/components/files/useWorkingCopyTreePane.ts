/**
 * Collapsed state and width of the working-copy tree pane on `/files`.
 *
 * Persisted through `window.api.store`, the same way `Layout` persists
 * `shellysvn:sidebar-collapsed`: read once on mount, written on every change.
 * The store is asynchronous, so the pane renders at its default size for the
 * first frame and settles once the stored value arrives.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export const TREE_PANE_COLLAPSED_KEY = 'shellysvn:files-tree-collapsed';
export const TREE_PANE_WIDTH_KEY = 'shellysvn:files-tree-width';

export const TREE_PANE_MIN_WIDTH = 180;
export const TREE_PANE_MAX_WIDTH = 480;
export const TREE_PANE_DEFAULT_WIDTH = 240;
/** Pixels an arrow key moves the divider. */
const KEYBOARD_STEP = 16;

function clampWidth(width: number): number {
  return Math.min(TREE_PANE_MAX_WIDTH, Math.max(TREE_PANE_MIN_WIDTH, Math.round(width)));
}

export interface WorkingCopyTreePaneState {
  collapsed: boolean;
  toggleCollapsed: () => void;
  width: number;
  /** Pointer drag on the divider. */
  beginResize: (event: React.MouseEvent) => void;
  /** Keyboard resize, in pixels; negative narrows. */
  nudgeWidth: (delta: number) => void;
  keyboardStep: number;
}

export function useWorkingCopyTreePane(): WorkingCopyTreePaneState {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(TREE_PANE_DEFAULT_WIDTH);
  const widthRef = useRef(TREE_PANE_DEFAULT_WIDTH);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  useEffect(() => {
    let cancelled = false;
    window.api.store
      .get<boolean>(TREE_PANE_COLLAPSED_KEY)
      .then((value) => {
        if (!cancelled && typeof value === 'boolean') setCollapsed(value);
      })
      .catch(() => {});
    window.api.store
      .get<number>(TREE_PANE_WIDTH_KEY)
      .then((value) => {
        if (!cancelled && typeof value === 'number' && Number.isFinite(value)) {
          setWidth(clampWidth(value));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      void window.api.store.set(TREE_PANE_COLLAPSED_KEY, next);
      return next;
    });
  }, []);

  const commitWidth = useCallback((next: number) => {
    void window.api.store.set(TREE_PANE_WIDTH_KEY, next);
  }, []);

  const beginResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = widthRef.current;

      const handleMouseMove = (moveEvent: MouseEvent): void => {
        setWidth(clampWidth(startWidth + (moveEvent.clientX - startX)));
      };
      const handleMouseUp = (): void => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        commitWidth(widthRef.current);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
    },
    [commitWidth]
  );

  const nudgeWidth = useCallback(
    (delta: number) => {
      setWidth((previous) => {
        const next = clampWidth(previous + delta);
        commitWidth(next);
        return next;
      });
    },
    [commitWidth]
  );

  return {
    collapsed,
    toggleCollapsed,
    width,
    beginResize,
    nudgeWidth,
    keyboardStep: KEYBOARD_STEP,
  };
}
