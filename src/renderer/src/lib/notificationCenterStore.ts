/**
 * Notification center (#81) — one place app events land.
 *
 * The center keeps a capped, persisted history of everything the app surfaced
 * as a toast or an operation outcome (unread tracking, mark-all-read, clear),
 * and a transient toast queue the layout renders as a bottom-right stack.
 * Items are history; toasts are the ephemeral surface of the same event.
 *
 * Persisted through the `window.api.store` bridge, same discipline as
 * `lib/onboardingStore.ts`.
 */

import { useSyncExternalStore } from 'react';

export const NOTIFICATION_CENTER_KEY = 'shellysvn:notification-center:v1';

/** History cap — the oldest items fall off the front. */
export const MAX_NOTIFICATIONS = 50;

/** How long a toast stays on screen before dismissing itself. */
export const TOAST_TTL_MS = 5000;

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export type NotificationSource = 'operation' | 'app' | 'shell';

export interface NotificationCenterItem {
  id: string;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  createdAt: number;
  read: boolean;
  source: NotificationSource;
  workingCopyPath?: string;
}

export interface TransientToast extends NotificationCenterItem {
  expiresAt: number;
}

export interface NotificationCenterState {
  version: 1;
  items: NotificationCenterItem[];
}

export const DEFAULT_NOTIFICATION_CENTER: NotificationCenterState = { version: 1, items: [] };

export interface NotificationInput {
  severity: NotificationSeverity;
  title: string;
  body?: string;
  source?: NotificationSource;
  workingCopyPath?: string;
  /** Suppress the transient toast (history-only). Default false. */
  toast?: boolean;
  /** Override the auto-dismiss delay. */
  ttlMs?: number;
}

/* ── pure helpers ─────────────────────────────────────────────────────────── */

/** Keep the newest {@link MAX_NOTIFICATIONS} items; drop the oldest. */
export function capNotifications(
  items: readonly NotificationCenterItem[],
  cap = MAX_NOTIFICATIONS
): NotificationCenterItem[] {
  return items.length > cap ? items.slice(items.length - cap) : [...items];
}

export function countUnread(items: readonly NotificationCenterItem[]): number {
  return items.reduce((total, item) => total + (item.read ? 0 : 1), 0);
}

/** Coarse, locale-free time-ago for notification rows. */
export function formatTimeAgo(createdAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - createdAt) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(createdAt).toLocaleDateString();
}

function parseItem(value: unknown): NotificationCenterItem | null {
  if (!value || typeof value !== 'object') return null;
  const { id, severity, title, createdAt, read, source, body, workingCopyPath } = value as {
    id?: unknown;
    severity?: unknown;
    title?: unknown;
    createdAt?: unknown;
    read?: unknown;
    source?: unknown;
    body?: unknown;
    workingCopyPath?: unknown;
  };
  if (typeof id !== 'string' || !id) return null;
  if (typeof title !== 'string' || !title) return null;
  if (!['info', 'success', 'warning', 'error'].includes(severity as string)) return null;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  return {
    id,
    severity: severity as NotificationSeverity,
    title,
    body: typeof body === 'string' && body ? body : undefined,
    createdAt,
    read: read === true,
    source: (['operation', 'app', 'shell'] as const).includes(source as NotificationSource)
      ? (source as NotificationSource)
      : 'app',
    workingCopyPath: typeof workingCopyPath === 'string' && workingCopyPath ? workingCopyPath : undefined,
  };
}

/** Strict parse of whatever the store hands back; anything else is defaults. */
export function parseNotificationCenter(value: unknown): NotificationCenterState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_NOTIFICATION_CENTER, items: [] };
  }
  const { items } = value as { items?: unknown };
  if (!Array.isArray(items)) return { ...DEFAULT_NOTIFICATION_CENTER, items: [] };
  const parsed = capNotifications(
    items.map(parseItem).filter((item): item is NotificationCenterItem => item !== null)
  );
  return { version: 1, items: parsed };
}

let notificationIdCounter = 0;
function newNotificationId(): string {
  notificationIdCounter += 1;
  return `ntf-${Date.now().toString(36)}-${notificationIdCounter.toString(36)}`;
}

/* ── module store ─────────────────────────────────────────────────────────── */

let history: NotificationCenterState = { ...DEFAULT_NOTIFICATION_CENTER, items: [] };
let toasts: TransientToast[] = [];
const listeners = new Set<() => void>();
let hydration: Promise<void> | null = null;
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

function emit(): void {
  recomputeSnapshot();
  for (const listener of listeners) listener();
}

function persistHistory(): void {
  void window.api?.store?.set(NOTIFICATION_CENTER_KEY, history).catch(() => {
    // Persistence failure must not unwind the in-session history.
  });
}

/** Read (and hydrate) the persisted history. Safe to call repeatedly. */
export function ensureNotificationCenterHydrated(): Promise<void> {
  if (hydration) return hydration;
  hydration = (async () => {
    try {
      const stored = await window.api?.store?.get<unknown>(NOTIFICATION_CENTER_KEY);
      history = parseNotificationCenter(stored);
      emit();
    } catch {
      // An unreadable store degrades to empty history for this session.
    }
  })();
  return hydration;
}

export function subscribeNotificationCenter(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface NotificationCenterSnapshot {
  items: readonly NotificationCenterItem[];
  toasts: readonly TransientToast[];
  unread: number;
}

/**
 * Cached snapshot — `useSyncExternalStore` demands a stable object from
 * `getSnapshot`, so it is only rebuilt when the underlying arrays change.
 */
let cachedSnapshot: NotificationCenterSnapshot = {
  items: history.items,
  toasts,
  unread: 0,
};

function recomputeSnapshot(): void {
  cachedSnapshot = {
    items: history.items,
    toasts,
    unread: countUnread(history.items),
  };
}

export function getNotificationCenterSnapshot(): NotificationCenterSnapshot {
  return cachedSnapshot;
}

/** React binding for the center. */
export function useNotificationCenter(): NotificationCenterSnapshot {
  return useSyncExternalStore(
    subscribeNotificationCenter,
    getNotificationCenterSnapshot,
    getNotificationCenterSnapshot
  );
}

/* ── actions ──────────────────────────────────────────────────────────────── */

function scheduleToastExpiry(id: string, ttlMs: number): void {
  const existing = toastTimers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    toastTimers.delete(id);
    toasts = toasts.filter((toast) => toast.id !== id);
    emit();
  }, ttlMs);
  toastTimers.set(id, timer);
}

/**
 * Record an app event: appended to the capped history (persisted) and, unless
 * suppressed, surfaced as a transient toast that dismisses itself.
 */
export function pushNotification(input: NotificationInput): NotificationCenterItem {
  const item: NotificationCenterItem = {
    id: newNotificationId(),
    severity: input.severity,
    title: input.title,
    body: input.body,
    createdAt: Date.now(),
    read: false,
    source: input.source ?? 'app',
    workingCopyPath: input.workingCopyPath,
  };

  history = { ...history, items: capNotifications([...history.items, item]) };
  persistHistory();

  if (input.toast !== false) {
    const ttlMs = input.ttlMs ?? TOAST_TTL_MS;
    toasts = [...toasts, { ...item, expiresAt: Date.now() + ttlMs }];
    scheduleToastExpiry(item.id, ttlMs);
  }
  emit();
  return item;
}

/** Remove a toast early (click / Escape / the X button). */
export function dismissToast(id: string): void {
  const timer = toastTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    toastTimers.delete(id);
  }
  if (!toasts.some((toast) => toast.id === id)) return;
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

/** Opening the panel is itself reading it. */
export function markAllNotificationsRead(): void {
  if (history.items.every((item) => item.read)) return;
  history = { ...history, items: history.items.map((item) => ({ ...item, read: true })) };
  persistHistory();
  emit();
}

export function markNotificationRead(id: string): void {
  const item = history.items.find((candidate) => candidate.id === id);
  if (!item || item.read) return;
  history = {
    ...history,
    items: history.items.map((candidate) =>
      candidate.id === id ? { ...candidate, read: true } : candidate
    ),
  };
  persistHistory();
  emit();
}

export function clearNotifications(): void {
  if (history.items.length === 0) return;
  history = { ...history, items: [] };
  persistHistory();
  emit();
}

/** Test helper: reset the in-memory store (no persistence, clears timers). */
export function resetNotificationCenterForTests(): void {
  for (const timer of toastTimers.values()) clearTimeout(timer);
  toastTimers.clear();
  toasts = [];
  history = { ...DEFAULT_NOTIFICATION_CENTER, items: [] };
  hydration = null;
  emit();
}
