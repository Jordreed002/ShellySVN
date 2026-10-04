/**
 * Persistence for user-remappable keyboard shortcuts (#78).
 *
 * Only the deltas from the defaults are stored — a map of
 * `binding id -> { key, enabled }` — so new bindings introduced by app updates
 * keep working and removed bindings disappear cleanly. A legacy payload that
 * stored the full binding array is still understood and converted on load.
 *
 * Persisted through the same `window.api.store` bridge as the AI review center
 * workspaces.
 */

import type { ShortcutBinding } from '../hooks/useShortcutBindings';

export const SHORTCUT_OVERRIDES_KEY = 'shellysvn:shortcut-overrides:v1';

/**
 * Fired on `window` after overrides are saved so every mounted
 * `useShortcutBindings` instance (the Layout shell included) reloads and a
 * remap made in the customize tab takes effect app-wide immediately.
 */
export const SHORTCUT_OVERRIDES_CHANGED_EVENT = 'shellysvn:shortcut-overrides-changed';

/** Pre-#78 storage wrote the entire binding array under this key. */
const LEGACY_SHORTCUTS_KEY = 'shellysvn-shortcut-bindings';

/** What is persisted per remapped binding. */
export interface PersistedShortcutOverride {
  key: string;
  enabled: boolean;
}

export type ShortcutOverrideMap = Record<string, PersistedShortcutOverride>;

/** A key claimed by more than one enabled binding. */
export interface ShortcutConflict {
  key: string;
  bindingIds: string[];
}

const MODIFIER_ALIASES: Record<string, 'ctrl' | 'alt' | 'shift'> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  meta: 'ctrl',
  cmd: 'ctrl',
  command: 'ctrl',
  '⌘': 'ctrl',
  win: 'ctrl',
  super: 'ctrl',
  alt: 'alt',
  option: 'alt',
  '⌥': 'alt',
  shift: 'shift',
  '⇧': 'shift',
};

/**
 * Canonical form for a shortcut: modifiers in `Ctrl+Alt+Shift+key` order with
 * the key capitalized (`Ctrl+Shift+K`, `Alt+F5`, `Ctrl+,`). This is the format
 * the defaults use and the cheat sheet displays, so equality checks after
 * recording catch conflicts regardless of modifier order or platform naming.
 */
export function normalizeShortcutKey(key: string): string {
  // Symbol modifiers (⌘⇧⌥) can arrive without "+" separators, e.g. "⌘⇧A".
  const symbolModifiers = key.match(/[⌘⇧⌥]/g) ?? [];
  const separated = key.replace(/[⌘⇧⌥]/g, '');

  const parts = separated
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  const modifiers = new Set<string>();
  for (const symbol of symbolModifiers) {
    const modifier = MODIFIER_ALIASES[symbol];
    if (modifier) modifiers.add(modifier);
  }
  const rest: string[] = [];
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) modifiers.add(modifier);
    else rest.push(part);
  }
  if (rest.length === 0 && modifiers.size === 0) return '';

  const ordered = [
    ...(modifiers.has('ctrl') ? ['Ctrl'] : []),
    ...(modifiers.has('alt') ? ['Alt'] : []),
    ...(modifiers.has('shift') ? ['Shift'] : []),
  ];

  const main = rest[rest.length - 1] ?? '';
  const canonicalMain =
    main.length === 1 ? main.toUpperCase() : main.charAt(0).toUpperCase() + main.slice(1);

  return [...ordered, canonicalMain].filter(Boolean).join('+');
}

/** Modifier-only keys that never complete a combo on their own. */
const BARE_MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

/** The fields of KeyboardEvent the combo builder reads. */
export interface ShortcutEventInput {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
}

/**
 * Build the canonical combo a key press represents, in the same normalized
 * form bindings use, so runtime handlers can compare live events against a
 * binding's `currentKey` regardless of platform modifier naming (Cmd and Ctrl
 * both normalize to `Ctrl`, which is how the defaults stay cross-platform).
 *
 * A shifted printable character (`?`, `!`) already encodes Shift in the
 * character itself, so the explicit modifier is dropped for non-alphanumeric
 * keys — pressing `Shift+/` produces key `?` and matches a `?` binding. This
 * is the same shape the customize tab records, so recorded keys always match
 * the keys the handlers fire on.
 */
export function shortcutComboFromEvent(event: ShortcutEventInput): string {
  if (!event.key || BARE_MODIFIER_KEYS.has(event.key)) return '';

  const isPrintable = event.key.length === 1;
  const main = isPrintable ? event.key.toLowerCase() : event.key;
  // Keep Shift only when it isn't already baked into the produced character.
  const keepShift = !isPrintable || /[a-z0-9]/i.test(event.key);

  return normalizeShortcutKey(
    [
      ...(event.ctrlKey || event.metaKey ? ['Ctrl'] : []),
      ...(event.altKey ? ['Alt'] : []),
      ...(event.shiftKey && keepShift ? ['Shift'] : []),
      main,
    ].join('+')
  );
}

/** Validate an unknown payload as the v1 override map; anything else is empty. */
export function parseShortcutOverrides(value: unknown): ShortcutOverrideMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: ShortcutOverrideMap = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const { key, enabled } = entry as { key?: unknown; enabled?: unknown };
    if (typeof key !== 'string') continue;
    const normalized = normalizeShortcutKey(key);
    if (!normalized) continue;
    result[id] = { key: normalized, enabled: enabled !== false };
  }
  return result;
}

/** Convert a legacy full-array payload into an override map (changed entries only). */
export function parseLegacyShortcutBindings(value: unknown): ShortcutOverrideMap {
  if (!Array.isArray(value)) return {};
  const result: ShortcutOverrideMap = {};
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, currentKey, enabled } = entry as {
      id?: unknown;
      currentKey?: unknown;
      enabled?: unknown;
    };
    if (typeof id !== 'string' || typeof currentKey !== 'string') continue;
    const normalized = normalizeShortcutKey(currentKey);
    if (!normalized) continue;
    result[id] = { key: normalized, enabled: enabled !== false };
  }
  return result;
}

/**
 * Apply an override map to the defaults. Unknown ids are ignored so stale
 * entries from older versions never surface in the UI.
 */
export function resolveBindings(
  defaults: ShortcutBinding[],
  overrides: ShortcutOverrideMap
): ShortcutBinding[] {
  return defaults.map((binding) => {
    const override = overrides[binding.id];
    if (!override) return binding;
    return { ...binding, currentKey: override.key, enabled: override.enabled };
  });
}

/** Keys claimed by more than one enabled binding, for conflict warnings. */
export function findConflicts(bindings: ShortcutBinding[]): ShortcutConflict[] {
  const byKey = new Map<string, string[]>();
  for (const binding of bindings) {
    if (!binding.enabled) continue;
    const key = normalizeShortcutKey(binding.currentKey);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), binding.id]);
  }
  return [...byKey.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, bindingIds]) => ({ key, bindingIds }));
}

/** The other enabled binding already using `key`, if any. */
export function findConflictingBinding(
  bindings: ShortcutBinding[],
  bindingId: string,
  key: string
): ShortcutBinding | undefined {
  const normalized = normalizeShortcutKey(key);
  return bindings.find(
    (binding) =>
      binding.id !== bindingId && binding.enabled && normalizeShortcutKey(binding.currentKey) === normalized
  );
}

/** Derive the override map to persist from the current binding state. */
export function toOverrideMap(bindings: ShortcutBinding[]): ShortcutOverrideMap {
  const overrides: ShortcutOverrideMap = {};
  for (const binding of bindings) {
    const keyChanged = normalizeShortcutKey(binding.currentKey) !== normalizeShortcutKey(binding.defaultKey);
    if (keyChanged || !binding.enabled) {
      overrides[binding.id] = { key: normalizeShortcutKey(binding.currentKey), enabled: binding.enabled };
    }
  }
  return overrides;
}

/**
 * Load persisted overrides. Reads the v1 override map first, then falls back to
 * the legacy full-array payload. Storage failures degrade to defaults.
 */
export async function loadShortcutOverrides(): Promise<ShortcutOverrideMap> {
  try {
    const stored = await window.api?.store?.get<unknown>(SHORTCUT_OVERRIDES_KEY);
    if (stored !== undefined && stored !== null) return parseShortcutOverrides(stored);
    const legacy = await window.api?.store?.get<unknown>(LEGACY_SHORTCUTS_KEY);
    return parseLegacyShortcutBindings(legacy);
  } catch {
    return {};
  }
}

/**
 * Persist the override map; callers decide how to surface failures.
 * `origin` is echoed on the change event so a saver (e.g. the bindings hook)
 * can skip reloading in response to its own write.
 */
export async function saveShortcutOverrides(
  overrides: ShortcutOverrideMap,
  origin?: string
): Promise<void> {
  await window.api?.store?.set(SHORTCUT_OVERRIDES_KEY, overrides);
  window.dispatchEvent(
    new CustomEvent(SHORTCUT_OVERRIDES_CHANGED_EVENT, { detail: { origin } })
  );
}
