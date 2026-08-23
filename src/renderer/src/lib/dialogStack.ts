import { useEffect } from 'react';

/**
 * Module-level stack of open dialogs.
 *
 * Coordinates behavior that individual dialogs cannot decide on their own:
 *
 * - Only the top-most dialog reacts to Escape, so closing a nested dialog
 *   never closes its parent (#42).
 * - The background scroll lock is reference counted, so closing a nested
 *   dialog keeps the page locked while the parent is still open.
 *
 * Dialogs rendered through `components/ui/DialogBase` register automatically.
 * Hand-rolled modal overlays that are not on DialogBase yet can call
 * `useDialogRegistration` so dialogs below them know they are not top-most.
 */

const stack: string[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Push a dialog onto the stack. Returns a release function that removes it
 * (safe to call more than once).
 */
export function pushDialog(id: string): () => void {
  stack.push(id);
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = stack.lastIndexOf(id);
    if (index !== -1) stack.splice(index, 1);
    notify();
  };
}

/** True when `id` refers to the most recently opened dialog. */
export function isTopDialog(id: string): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

/** Id of the top-most open dialog, if any. */
export function topDialogId(): string | undefined {
  return stack.length > 0 ? stack[stack.length - 1] : undefined;
}

/** Number of currently open, registered dialogs. */
export function dialogStackDepth(): number {
  return stack.length;
}

/** Snapshot of the open dialog ids, bottom-most first. */
export function dialogStackIds(): readonly string[] {
  return [...stack];
}

export function subscribeToDialogStack(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Register a dialog on the stack while `active` is true.
 *
 * For dialogs that render `DialogBase` this happens automatically; the hook
 * exists so hand-rolled modal shells (e.g. ThreeWayMergeEditor) can opt in
 * without a full migration.
 */
export function useDialogRegistration(id: string, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return pushDialog(id);
  }, [id, active]);
}

let scrollLockCount = 0;
let previousBodyOverflow = '';

/**
 * Reference-counted background scroll lock. While any dialog is open the body
 * stays locked; it is restored only when the last one closes.
 */
export function lockBodyScroll(): () => void {
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0) {
      document.body.style.overflow = previousBodyOverflow;
    }
  };
}
