import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_NOTIFICATIONS,
  NOTIFICATION_CENTER_KEY,
  TOAST_TTL_MS,
  capNotifications,
  clearNotifications,
  countUnread,
  dismissToast,
  ensureNotificationCenterHydrated,
  formatTimeAgo,
  getNotificationCenterSnapshot,
  markAllNotificationsRead,
  markNotificationRead,
  parseNotificationCenter,
  pushNotification,
  resetNotificationCenterForTests,
  type NotificationCenterItem,
} from '../notificationCenterStore';

function mockStore(initial: unknown = undefined) {
  const set = vi.fn().mockResolvedValue(undefined);
  const get = vi.fn().mockResolvedValue(initial);
  window.api = { store: { get, set } } as unknown as Window['api'];
  return { set, get };
}

function item(overrides: Partial<NotificationCenterItem> = {}): NotificationCenterItem {
  return {
    id: `i-${Math.random().toString(36).slice(2)}`,
    severity: 'info',
    title: 'Something happened',
    createdAt: Date.now(),
    read: false,
    source: 'app',
    ...overrides,
  };
}

describe('pure helpers', () => {
  it('caps the history at MAX_NOTIFICATIONS, dropping the oldest', () => {
    const items = Array.from({ length: MAX_NOTIFICATIONS + 20 }, (_, index) =>
      item({ id: `n${index}`, createdAt: index })
    );
    const capped = capNotifications(items);
    expect(capped).toHaveLength(MAX_NOTIFICATIONS);
    expect(capped[0].id).toBe(`n${20}`);
    expect(capped[capped.length - 1].id).toBe(`n${MAX_NOTIFICATIONS + 19}`);
    // A shorter list is returned untouched (as a copy).
    const short = [item(), item()];
    expect(capNotifications(short)).not.toBe(short);
    expect(capNotifications(short)).toHaveLength(2);
  });

  it('counts unread items', () => {
    expect(countUnread([])).toBe(0);
    expect(countUnread([item(), item({ read: true }), item()])).toBe(2);
  });

  it('formats coarse time-ago buckets', () => {
    const now = Date.now();
    expect(formatTimeAgo(now - 10_000, now)).toBe('just now');
    expect(formatTimeAgo(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatTimeAgo(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatTimeAgo(now - 2 * 86_400_000, now)).toBe('2d ago');
    expect(formatTimeAgo(now - 30 * 86_400_000, now)).toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
  });

  it('parses persisted history strictly', () => {
    const good = item({ id: 'good', severity: 'error', read: true });
    const parsed = parseNotificationCenter({
      items: [
        good,
        { id: 'no-severity', title: 'x', createdAt: 1 },
        { id: 'no-title', severity: 'info', createdAt: 1 },
        'garbage',
        { id: 'also-good', severity: 'success', title: 'y', createdAt: 2, source: 'operation' },
      ],
    });
    expect(parsed.items.map((entry) => entry.id)).toEqual(['good', 'also-good']);
    expect(parsed.items[0].read).toBe(true);
    expect(parsed.items[1].source).toBe('operation');
    expect(parseNotificationCenter(null).items).toEqual([]);
    expect(parseNotificationCenter({ items: 'nope' }).items).toEqual([]);
  });
});

describe('notification center store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetNotificationCenterForTests();
    mockStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushes to the history and surfaces a transient toast that dismisses itself', () => {
    const pushed = pushNotification({
      severity: 'success',
      title: 'Update finished',
      body: 'r42 · 12.3s',
      source: 'operation',
      workingCopyPath: '/wc/atlas',
    });

    let snapshot = getNotificationCenterSnapshot();
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]).toMatchObject({
      id: pushed.id,
      severity: 'success',
      read: false,
      workingCopyPath: '/wc/atlas',
    });
    expect(snapshot.unread).toBe(1);
    expect(snapshot.toasts).toHaveLength(1);
    expect(window.api.store.set).toHaveBeenCalledWith(
      NOTIFICATION_CENTER_KEY,
      expect.objectContaining({ items: expect.any(Array) })
    );

    // Auto-dismiss after the TTL.
    vi.advanceTimersByTime(TOAST_TTL_MS + 10);
    snapshot = getNotificationCenterSnapshot();
    expect(snapshot.toasts).toHaveLength(0);
    // …while the history entry stays.
    expect(snapshot.items).toHaveLength(1);
  });

  it('supports toast-less pushes (history-only) and manual dismissal', () => {
    pushNotification({ severity: 'info', title: 'Quiet', toast: false });
    expect(getNotificationCenterSnapshot().toasts).toHaveLength(0);

    const loud = pushNotification({ severity: 'error', title: 'Loud' });
    expect(getNotificationCenterSnapshot().toasts).toHaveLength(1);
    dismissToast(loud.id);
    expect(getNotificationCenterSnapshot().toasts).toHaveLength(0);
    expect(getNotificationCenterSnapshot().items).toHaveLength(2);
  });

  it('caps the persisted history at 50 entries as pushes accumulate', () => {
    for (let index = 0; index < MAX_NOTIFICATIONS + 10; index += 1) {
      pushNotification({ severity: 'info', title: `Event ${index}`, toast: false });
    }
    const { items } = getNotificationCenterSnapshot();
    expect(items).toHaveLength(MAX_NOTIFICATIONS);
    expect(items[0].title).toBe('Event 10');
    expect(items[items.length - 1].title).toBe(`Event ${MAX_NOTIFICATIONS + 9}`);
  });

  it('tracks unread and clears it via mark-all-read / per-item read', () => {
    const first = pushNotification({ severity: 'info', title: 'One', toast: false });
    pushNotification({ severity: 'info', title: 'Two', toast: false });
    expect(getNotificationCenterSnapshot().unread).toBe(2);

    markNotificationRead(first.id);
    expect(getNotificationCenterSnapshot().unread).toBe(1);

    markAllNotificationsRead();
    expect(getNotificationCenterSnapshot().unread).toBe(0);
    expect(
      (window.api.store.set as ReturnType<typeof vi.fn>).mock.calls.at(-1)[1].items.every(
        (entry: NotificationCenterItem) => entry.read
      )
    ).toBe(true);
  });

  it('clears the whole history and persists the empty state', () => {
    pushNotification({ severity: 'info', title: 'One', toast: false });
    clearNotifications();
    const snapshot = getNotificationCenterSnapshot();
    expect(snapshot.items).toHaveLength(0);
    expect(snapshot.unread).toBe(0);
    expect(window.api.store.set).toHaveBeenLastCalledWith(
      NOTIFICATION_CENTER_KEY,
      expect.objectContaining({ items: [] })
    );
  });

  it('hydrates the persisted history once', async () => {
    resetNotificationCenterForTests();
    mockStore({
      items: [item({ id: 'restored', severity: 'warning', title: 'From last time' })],
    });
    await ensureNotificationCenterHydrated();
    const snapshot = getNotificationCenterSnapshot();
    expect(snapshot.items.map((entry) => entry.id)).toEqual(['restored']);
    expect(snapshot.unread).toBe(1);
  });
});
