/**
 * Main-window geometry persistence (beta #40 main half / Track B item #5).
 *
 * Persists the window's bounds (x, y, width, height) plus its maximized state,
 * keyed by the Electron display id of the monitor the window sits on. On
 * restore the entry for the last-used display is preferred (falling back to
 * the primary display's entry); when that monitor is no longer attached or the
 * saved bounds would land essentially off-screen, callers get `bounds: null`
 * and fall back to Electron's default centered geometry.
 *
 * Persistence rides the existing `SimpleStore` (`shellysvn-config.json`, the
 * same file/bridge the renderer's `window.api.store` uses) under a
 * `shellysvn:*` key — no new dependency, and writes stay atomic/0600 via
 * `writeSecureJson`. Renderer-side dialog geometry (`useDialogGeometry`) is a
 * separate mechanism and is intentionally untouched.
 *
 * All persisted input is re-validated on read: coordinates must be finite
 * numbers and the map is capped so stale monitor entries cannot grow forever.
 */

import { screen, type BrowserWindow, type Display, type Rectangle } from 'electron';
import { getStore } from './ipc/store';

/** SimpleStore keys must start with `shellysvn` (see ipc/store.ts validation). */
const STORE_KEY = 'shellysvn:main-window-bounds:v1';

/** Collapse bursts of move/resize events into one write. */
const SAVE_DEBOUNCE_MS = 500;

/** Keep entries for at most this many displays, pruning the least-recent. */
const MAX_TRACKED_DISPLAYS = 8;

/** A saved window must keep at least this many visible pixels per axis. */
const MIN_VISIBLE_EDGE_PX = 100;

export const DEFAULT_WINDOW_WIDTH = 1400;
export const DEFAULT_WINDOW_HEIGHT = 900;
export const MIN_WINDOW_WIDTH = 900;
export const MIN_WINDOW_HEIGHT = 600;

/** What is stored per display id. `savedAt` is only for prune ordering. */
export interface MainWindowBoundsEntry {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
  savedAt?: number;
}

interface WindowGeometryStore {
  displays: Record<string, MainWindowBoundsEntry>;
  lastDisplayId?: string;
}

/** Result handed to window creation: null bounds means "use defaults". */
export interface RestoredWindowGeometry {
  bounds: Rectangle | null;
  maximized: boolean;
}

function parseEntry(value: unknown): MainWindowBoundsEntry | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height, maximized, savedAt } = value as Record<string, unknown>;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    ![x, y, width, height].every((n) => Number.isFinite(n))
  ) {
    return null;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(Math.round(width), MIN_WINDOW_WIDTH),
    height: Math.max(Math.round(height), MIN_WINDOW_HEIGHT),
    maximized: maximized === true,
    ...(typeof savedAt === 'number' && Number.isFinite(savedAt) ? { savedAt } : {}),
  };
}

/** Validate an unknown persisted payload; anything malformed is empty. */
export function parseWindowGeometry(value: unknown): WindowGeometryStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { displays: {} };
  const { displays, lastDisplayId } = value as Record<string, unknown>;
  if (!displays || typeof displays !== 'object' || Array.isArray(displays)) {
    return { displays: {} };
  }
  const result: WindowGeometryStore = { displays: {} };
  for (const [id, entry] of Object.entries(displays as Record<string, unknown>)) {
    const parsed = parseEntry(entry);
    if (parsed) result.displays[id] = parsed;
  }
  if (typeof lastDisplayId === 'string' && lastDisplayId in result.displays) {
    result.lastDisplayId = lastDisplayId;
  }
  return result;
}

/** True when at least a MIN_VISIBLE_EDGE_PX² patch of the bounds is on a display. */
export function isBoundsSufficientlyVisible(
  bounds: Rectangle,
  displays: Display[]
): boolean {
  return displays.some(({ workArea }) => {
    const overlapWidth =
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x, workArea.x);
    const overlapHeight =
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
      Math.max(bounds.y, workArea.y);
    return overlapWidth >= MIN_VISIBLE_EDGE_PX && overlapHeight >= MIN_VISIBLE_EDGE_PX;
  });
}

function pickRestoredEntry(geometry: WindowGeometryStore): MainWindowBoundsEntry | null {
  const displays = screen.getAllDisplays();
  const attachedIds = new Set(displays.map((display) => String(display.id)));

  const lastId = geometry.lastDisplayId;
  if (lastId && attachedIds.has(lastId)) return geometry.displays[lastId];

  const primaryId = String(screen.getPrimaryDisplay().id);
  if (attachedIds.has(primaryId)) return geometry.displays[primaryId] ?? null;
  return null;
}

/**
 * Load the persisted geometry and resolve it against the current monitor
 * layout. Never throws — any failure degrades to default geometry.
 */
export async function restoreMainWindowGeometry(): Promise<RestoredWindowGeometry> {
  try {
    const store = await getStore();
    const geometry = parseWindowGeometry(await store.get<unknown>(STORE_KEY));
    const entry = pickRestoredEntry(geometry);
    if (!entry) return { bounds: null, maximized: false };
    const bounds: Rectangle = {
      x: entry.x,
      y: entry.y,
      width: entry.width,
      height: entry.height,
    };
    if (!isBoundsSufficientlyVisible(bounds, screen.getAllDisplays())) {
      return { bounds: null, maximized: false };
    }
    return { bounds, maximized: entry.maximized };
  } catch (error) {
    console.error('[window-geometry] Failed to restore window geometry:', error);
    return { bounds: null, maximized: false };
  }
}

async function persistEntry(entry: MainWindowBoundsEntry, displayId: string): Promise<void> {
  const store = await getStore();
  const existing = parseWindowGeometry(await store.get<unknown>(STORE_KEY));
  const stamped = { ...entry, savedAt: Date.now() };

  const displays = { ...existing.displays, [displayId]: stamped };
  // Cap the map: drop the least-recently-saved entries beyond the newest few
  // so unplugged monitors don't accumulate forever.
  const ids = Object.keys(displays);
  if (ids.length > MAX_TRACKED_DISPLAYS) {
    const kept = ids
      .toSorted((a, b) => (displays[b].savedAt ?? 0) - (displays[a].savedAt ?? 0))
      .slice(0, MAX_TRACKED_DISPLAYS);
    for (const id of ids) {
      if (!kept.includes(id)) delete displays[id];
    }
  }

  await store.set(STORE_KEY, { displays, lastDisplayId: displayId });
}

/**
 * Attach move/resize/close listeners that persist the window's geometry,
 * debounced during interactive drags and flushed once on close.
 */
export function trackMainWindowGeometry(win: BrowserWindow): void {
  let saveTimer: NodeJS.Timeout | null = null;

  const captureEntry = (): MainWindowBoundsEntry => {
    // getNormalBounds() reports the restore rectangle even while maximized, so
    // maximizing never overwrites the remembered un-maximized size.
    const normal = win.getNormalBounds();
    return {
      x: normal.x,
      y: normal.y,
      width: Math.max(normal.width, MIN_WINDOW_WIDTH),
      height: Math.max(normal.height, MIN_WINDOW_HEIGHT),
      maximized: win.isMaximized(),
    };
  };

  const persistNow = (): void => {
    if (win.isDestroyed()) return;
    const entry = captureEntry();
    const displayId = String(screen.getDisplayMatching(entry).id);
    persistEntry(entry, displayId).catch((error) => {
      console.error('[window-geometry] Failed to persist window geometry:', error);
    });
  };

  const schedulePersist = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistNow();
    }, SAVE_DEBOUNCE_MS);
  };

  win.on('resize', schedulePersist);
  win.on('move', schedulePersist);
  win.on('maximize', schedulePersist);
  win.on('unmaximize', schedulePersist);
  // Last chance: flush whatever the debounce still held when closing/quitting.
  win.on('close', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persistNow();
  });
}
