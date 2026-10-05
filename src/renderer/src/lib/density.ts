import { useSyncExternalStore } from 'react';

/**
 * Density — the JS-side mirror of the `.density-*` CSS classes.
 *
 * `applyDensity` (lib/appearance.ts) toggles `.density-compact` /
 * `.density-comfortable` on the document root, which retargets the
 * `--row-height` / `--row-height-tree` CSS variables that `h-row` /
 * `h-row-tree` and the `.file-row` / `.tree-item` classes consume. Virtualized
 * lists cannot read those variables — their scroll math needs numbers — so this
 * module publishes the same ladder in px and a hook that tracks the root class.
 *
 * The comfortable values are the historical defaults, so a tree without either
 * density class (tests, jsdom, a cold paint) renders exactly what it did
 * before the density setting existed.
 */

export type Density = 'compact' | 'comfortable';

/**
 * Directory-listing row height in px. Mirrors `--row-height` in
 * styles/global.css (`:root`, `.density-comfortable`, `.density-compact`).
 */
export const ROW_HEIGHTS: Record<Density, number> = {
  comfortable: 38,
  compact: 32,
};

/**
 * Tree-node row height in px. Mirrors `--row-height-tree` in
 * styles/global.css. Keep the two files in lockstep or the virtualizer's
 * offsets drift from what the rows paint.
 */
export const TREE_ROW_HEIGHTS: Record<Density, number> = {
  comfortable: 27,
  compact: 23,
};

/** The class `applyDensity` puts on the root when compact is chosen. */
const DENSITY_COMPACT_CLASS = 'density-compact';

function readDensity(): Density {
  return document.documentElement.classList.contains(DENSITY_COMPACT_CLASS)
    ? 'compact'
    : 'comfortable';
}

/*
 * One shared MutationObserver fans class changes on the root out to every
 * subscriber, so all density-aware virtualizers re-measure together — whether
 * the class came from useVisualSettings (saved settings) or
 * SettingsPreviewContext (live preview).
 */
let densityListeners: Array<() => void> = [];
let densityObserver: MutationObserver | null = null;

function subscribeToDensity(onChange: () => void): () => void {
  densityListeners.push(onChange);
  if (!densityObserver && typeof MutationObserver !== 'undefined') {
    densityObserver = new MutationObserver(() => {
      for (const listener of densityListeners) listener();
    });
    densityObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }
  return () => {
    densityListeners = densityListeners.filter((listener) => listener !== onChange);
  };
}

/**
 * The density currently painted on the document root. Reads the DOM rather
 * than the settings store so presentational components stay presentational —
 * and so the settings dialog's live preview reaches them too.
 */
export function useDensity(): Density {
  return useSyncExternalStore(
    subscribeToDensity,
    readDensity,
    () => 'comfortable' satisfies Density
  );
}
