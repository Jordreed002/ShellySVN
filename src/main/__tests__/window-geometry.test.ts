// @vitest-environment node

/*
 * Unit coverage for main-window geometry persistence (#40 main half / Track B
 * item #5). Electron's `screen` and the SimpleStore are mocked; only the pure
 * validation/selection logic and the debounce/flush listener wiring run for
 * real.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const screenMock = vi.hoisted(() => ({
  getAllDisplays: vi.fn(),
  getPrimaryDisplay: vi.fn(),
  getDisplayMatching: vi.fn(),
}));

vi.mock('electron', () => ({ screen: screenMock }));

const storeGet = vi.hoisted(() => vi.fn());
const storeSet = vi.hoisted(() => vi.fn());
vi.mock('../ipc/store', () => ({
  getStore: vi.fn(async () => ({ get: storeGet, set: storeSet })),
}));

import {
  isBoundsSufficientlyVisible,
  parseWindowGeometry,
  restoreMainWindowGeometry,
  trackMainWindowGeometry,
} from '../window-geometry';
import type { BrowserWindow } from 'electron';

const STORE_KEY = 'shellysvn:main-window-bounds:v1';

const PRIMARY = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
const SECONDARY = { id: 2, workArea: { x: 1920, y: 0, width: 1920, height: 1080 } };

const entryOnPrimary = { x: 100, y: 50, width: 1400, height: 900, maximized: false };
const entryOnSecondary = { x: 2100, y: 50, width: 1200, height: 800, maximized: true };

beforeEach(() => {
  vi.clearAllMocks();
  screenMock.getAllDisplays.mockReturnValue([PRIMARY, SECONDARY]);
  screenMock.getPrimaryDisplay.mockReturnValue(PRIMARY);
  screenMock.getDisplayMatching.mockReturnValue(PRIMARY);
  storeGet.mockResolvedValue(undefined);
  storeSet.mockResolvedValue(undefined);
});

describe('parseWindowGeometry', () => {
  it('accepts a valid per-display map with a last marker', () => {
    const geometry = parseWindowGeometry({
      displays: { '1': entryOnPrimary, '2': entryOnSecondary },
      lastDisplayId: '2',
    });
    expect(geometry.displays['1']).toMatchObject(entryOnPrimary);
    expect(geometry.displays['2']).toMatchObject(entryOnSecondary);
    expect(geometry.lastDisplayId).toBe('2');
  });

  it('drops malformed entries and non-object payloads', () => {
    expect(
      parseWindowGeometry({
        displays: { ok: entryOnPrimary, bad: { x: 'nope' }, worse: 42 },
        lastDisplayId: 'bad',
      })
    ).toEqual({ displays: { ok: expect.objectContaining(entryOnPrimary) } });
    expect(parseWindowGeometry(null)).toEqual({ displays: {} });
    expect(parseWindowGeometry([entryOnPrimary])).toEqual({ displays: {} });
  });

  it('clamps undersized bounds up to the minimum window size', () => {
    const geometry = parseWindowGeometry({
      displays: { '1': { x: 0, y: 0, width: 10, height: 10, maximized: false } },
    });
    expect(geometry.displays['1']).toMatchObject({ width: 900, height: 600 });
  });
});

describe('isBoundsSufficientlyVisible', () => {
  it('accepts bounds fully on a display', () => {
    expect(isBoundsSufficientlyVisible({ x: 0, y: 0, width: 800, height: 600 }, [PRIMARY])).toBe(
      true
    );
  });

  it('rejects fully off-screen and barely-visible bounds', () => {
    expect(
      isBoundsSufficientlyVisible({ x: 50000, y: 50000, width: 800, height: 600 }, [PRIMARY])
    ).toBe(false);
    // Only a 50x50 sliver overlaps the primary display.
    expect(
      isBoundsSufficientlyVisible({ x: -750, y: 0, width: 800, height: 600 }, [PRIMARY])
    ).toBe(false);
  });
});

describe('restoreMainWindowGeometry', () => {
  it('prefers the last-used display entry and honors its maximized flag', async () => {
    storeGet.mockResolvedValue({
      displays: { '1': entryOnPrimary, '2': entryOnSecondary },
      lastDisplayId: '2',
    });

    const restored = await restoreMainWindowGeometry();

    expect(storeGet).toHaveBeenCalledWith(STORE_KEY);
    expect(restored).toEqual({
      bounds: { x: 2100, y: 50, width: 1200, height: 800 },
      maximized: true,
    });
  });

  it('falls back to the primary display entry when the last monitor is gone', async () => {
    storeGet.mockResolvedValue({
      displays: { '1': entryOnPrimary },
      lastDisplayId: '42',
    });

    expect(await restoreMainWindowGeometry()).toEqual({
      bounds: { x: 100, y: 50, width: 1400, height: 900 },
      maximized: false,
    });
  });

  it('returns default geometry when no attached display has an entry', async () => {
    storeGet.mockResolvedValue({
      displays: { '2': entryOnSecondary },
      lastDisplayId: '2',
    });
    // Only the primary display is attached now.
    screenMock.getAllDisplays.mockReturnValue([PRIMARY]);

    expect(await restoreMainWindowGeometry()).toEqual({ bounds: null, maximized: false });
  });

  it('returns default geometry for off-screen saved bounds', async () => {
    storeGet.mockResolvedValue({
      displays: { '1': { x: 9000, y: 9000, width: 1400, height: 900, maximized: true } },
      lastDisplayId: '1',
    });

    expect(await restoreMainWindowGeometry()).toEqual({ bounds: null, maximized: false });
  });

  it('degrades to defaults when the store fails', async () => {
    storeGet.mockRejectedValue(new Error('disk gone'));

    expect(await restoreMainWindowGeometry()).toEqual({ bounds: null, maximized: false });
  });
});

function fakeWindow(bounds: { x: number; y: number; width: number; height: number }) {
  const listeners = new Map<string, () => void>();
  return {
    isDestroyed: () => false,
    isMaximized: () => false,
    getNormalBounds: () => ({ ...bounds }),
    on: (event: string, callback: () => void) => listeners.set(event, callback),
    emit: (event: string) => listeners.get(event)?.(),
  };
}

describe('trackMainWindowGeometry', () => {  it('debounces move/resize saves and keys them by display id', async () => {
    vi.useFakeTimers();
    try {
      const win = fakeWindow({ x: 10, y: 20, width: 1000, height: 700 });
      trackMainWindowGeometry(win as unknown as BrowserWindow);

      win.emit('resize');
      win.emit('move');
      await vi.advanceTimersByTimeAsync(200);
      expect(storeSet).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(400);
      expect(storeSet).toHaveBeenCalledTimes(1);
      expect(storeSet).toHaveBeenCalledWith(STORE_KEY, {
        displays: {
          '1': expect.objectContaining({ x: 10, y: 20, width: 1000, height: 700, maximized: false }),
        },
        lastDisplayId: '1',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes pending saves immediately on close', async () => {
    vi.useFakeTimers();
    try {
      const win = fakeWindow({ x: 0, y: 0, width: 1200, height: 800 });
      trackMainWindowGeometry(win as unknown as BrowserWindow);

      win.emit('resize');
      win.emit('close');
      await vi.advanceTimersByTimeAsync(0);

      expect(storeSet).toHaveBeenCalledTimes(1);
      expect(storeSet.mock.calls[0][1].lastDisplayId).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });
});
