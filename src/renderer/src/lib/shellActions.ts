/**
 * Shell action dispatchers + open-state hooks.
 *
 * The Layout owns a handful of globally mounted surfaces (the DiffWizard, the
 * ShelfManagerDialog, the notification center panel). Anything else — the
 * command palette, context menus, future surfaces — reaches them through the
 * shell events declared in `lib/svnOperationEvents.ts`, dispatched by the
 * helpers below and consumed by the hooks, which the Layout uses so the
 * listener wiring lives in exactly one place and is testable without mounting
 * the Layout itself.
 */

import { useCallback, useEffect, useState } from 'react';
import type { DiffComparisonSide } from './savedComparisons';
import { SHELL_EVENTS } from './svnOperationEvents';

/** What the DiffWizard should pre-fill when it opens. */
export interface DiffWizardRequest {
  left?: DiffComparisonSide | null;
  right?: DiffComparisonSide | null;
}

/** Ask the shell to open the DiffWizard, optionally pre-filling both sides. */
export function openDiffWizard(defaults: DiffWizardRequest = {}): void {
  window.dispatchEvent(
    new CustomEvent<DiffWizardRequest>(SHELL_EVENTS.OPEN_DIFF_WIZARD, { detail: defaults })
  );
}

/** Ask the shell to open the Shelf Manager for the active working copy. */
export function openShelfManager(): void {
  window.dispatchEvent(new CustomEvent(SHELL_EVENTS.OPEN_SHELF_MANAGER));
}

/** Ask the shell to open the notification center panel (#81). */
export function openNotificationCenter(): void {
  window.dispatchEvent(new CustomEvent(SHELL_EVENTS.OPEN_NOTIFICATION_CENTER));
}

/**
 * Layout-level wiring for the globally mounted DiffWizard: listens for
 * `shellysvn:open-diff-wizard`, exposes the pending request (defaults) while
 * open, and an `open` that other Layout affordances can call directly.
 */
export function useDiffWizardRequest(): {
  isOpen: boolean;
  request: DiffWizardRequest | null;
  open: (defaults?: DiffWizardRequest) => void;
  close: () => void;
} {
  const [request, setRequest] = useState<DiffWizardRequest | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<DiffWizardRequest>).detail;
      setRequest(detail ?? {});
    };
    window.addEventListener(SHELL_EVENTS.OPEN_DIFF_WIZARD, handler);
    return () => window.removeEventListener(SHELL_EVENTS.OPEN_DIFF_WIZARD, handler);
  }, []);

  const open = useCallback((defaults: DiffWizardRequest = {}) => setRequest(defaults), []);
  const close = useCallback(() => setRequest(null), []);

  return { isOpen: request !== null, request, open, close };
}

/**
 * Layout-level wiring for the ShelfManagerDialog mount (HANDOFF 1): listens
 * for `shellysvn:open-shelf-manager` and offers the same open locally.
 */
export function useShelfManagerOpenState(): { isOpen: boolean; open: () => void; close: () => void } {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener(SHELL_EVENTS.OPEN_SHELF_MANAGER, handler);
    return () => window.removeEventListener(SHELL_EVENTS.OPEN_SHELF_MANAGER, handler);
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  return { isOpen, open, close };
}

/**
 * Layout-level wiring for the notification center bell (#81): translates the
 * `shellysvn:open-notification-center` event into the panel's open state.
 */
export function useNotificationCenterOpenEvent(onOpen: () => void): void {
  useEffect(() => {
    window.addEventListener(SHELL_EVENTS.OPEN_NOTIFICATION_CENTER, onOpen);
    return () => window.removeEventListener(SHELL_EVENTS.OPEN_NOTIFICATION_CENTER, onOpen);
  }, [onOpen]);
}
