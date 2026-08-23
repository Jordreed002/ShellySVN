import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

/**
 * Persistent dialog geometry (#40 renderer half).
 *
 * Restores the last saved size/position for a dialog id via the store bridge
 * (`window.api.store`), keeps the dialog fully on screen (clamped to the
 * viewport) and persists the geometry when a move or resize gesture ends.
 */

export const DIALOG_GEOMETRY_PREFIX = 'shellysvn:dialog-geometry:v1:';

export function dialogGeometryStorageKey(dialogId: string): string {
  return `${DIALOG_GEOMETRY_PREFIX}${dialogId}`;
}

export interface DialogGeometry {
  /** Viewport-relative panel position. */
  x: number;
  y: number;
  /** Panel size in px; null means "use the CSS-driven size". */
  width: number | null;
  height: number | null;
}

export interface DialogGeometryConstraints {
  viewportWidth: number;
  viewportHeight: number;
  minWidth?: number;
  minHeight?: number;
}

export const DEFAULT_DIALOG_MIN_WIDTH = 320;
export const DEFAULT_DIALOG_MIN_HEIGHT = 200;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Clamp a geometry so the panel stays fully inside the viewport and never
 * smaller than its minimum size. Positions are rounded to integers so we do
 * not persist sub-pixel jitter from pointer moves.
 */
export function clampDialogGeometry(
  geometry: DialogGeometry,
  constraints: DialogGeometryConstraints
): DialogGeometry {
  const minWidth = Math.max(1, constraints.minWidth ?? DEFAULT_DIALOG_MIN_WIDTH);
  const minHeight = Math.max(1, constraints.minHeight ?? DEFAULT_DIALOG_MIN_HEIGHT);
  const viewportWidth = Math.max(minWidth, constraints.viewportWidth);
  const viewportHeight = Math.max(minHeight, constraints.viewportHeight);

  const width =
    geometry.width == null ? null : Math.round(clampNumber(geometry.width, minWidth, viewportWidth));
  const height =
    geometry.height == null
      ? null
      : Math.round(clampNumber(geometry.height, minHeight, viewportHeight));

  const maxX = viewportWidth - (width ?? minWidth);
  const maxY = viewportHeight - (height ?? minHeight);

  return {
    x: Math.round(clampNumber(geometry.x, 0, Math.max(0, maxX))),
    y: Math.round(clampNumber(geometry.y, 0, Math.max(0, maxY))),
    width,
    height,
  };
}

function optionalSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Validate an untrusted stored value; returns null when it is not usable. */
export function sanitizeDialogGeometry(value: unknown): DialogGeometry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.x !== 'number' ||
    !Number.isFinite(candidate.x) ||
    typeof candidate.y !== 'number' ||
    !Number.isFinite(candidate.y)
  ) {
    return null;
  }
  return {
    x: candidate.x,
    y: candidate.y,
    width: optionalSize(candidate.width),
    height: optionalSize(candidate.height),
  };
}

export interface UseDialogGeometryOptions {
  /** Whether the dialog is currently open. Loading and listeners are skipped while closed. */
  active: boolean;
  /** Enable moving the panel by dragging its header. */
  draggable?: boolean;
  /** Enable resizing the panel from a corner handle; persisted size is restored on reopen. */
  resizable?: boolean;
  minWidth?: number;
  minHeight?: number;
  /** The panel element; seeds geometry on the first drag/resize of a centered dialog. */
  panelRef: RefObject<HTMLElement | null>;
}

export interface UseDialogGeometryResult {
  geometry: DialogGeometry | null;
  /** Inline style to spread on the panel element. Empty while centered/unsized. */
  panelStyle: CSSProperties;
  /** Attach to the dialog header's pointerdown event. Undefined when not draggable. */
  handleHeaderPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Attach to the resize handle's pointerdown event. Undefined when not resizable. */
  handleResizeHandlePointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
}

function getStoreApi(): { get: <T>(key: string) => Promise<T | undefined>; set: (key: string, value: unknown) => Promise<unknown> } | undefined {
  // Optional chaining keeps dialogs renderable in tests that do not stub the
  // preload bridge; geometry simply does not persist there.
  return window.api?.store;
}

function geometryFromPanel(panel: HTMLElement | null): DialogGeometry | null {
  if (!panel) return null;
  const rect = panel.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/** Elements inside the header that must not start a drag. */
const NO_DRAG_SELECTOR = 'button, a, input, select, textarea, label, [data-dialog-no-drag]';

export function useDialogGeometry(
  dialogId: string,
  {
    active,
    draggable = false,
    resizable = false,
    minWidth,
    minHeight,
    panelRef,
  }: UseDialogGeometryOptions
): UseDialogGeometryResult {
  const enabled = draggable || resizable;
  const [geometry, setGeometry] = useState<DialogGeometry | null>(null);
  const geometryRef = useRef<DialogGeometry | null>(null);

  useLayoutEffect(() => {
    geometryRef.current = geometry;
  }, [geometry]);

  const constraintsRef = useRef({ minWidth, minHeight });
  constraintsRef.current = { minWidth, minHeight };

  const currentConstraints = useCallback(
    (): DialogGeometryConstraints => ({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      minWidth: constraintsRef.current.minWidth,
      minHeight: constraintsRef.current.minHeight,
    }),
    []
  );

  // Restore the persisted geometry when the dialog opens.
  useEffect(() => {
    if (!active || !enabled) return;
    const store = getStoreApi();
    if (!store) return;
    let cancelled = false;
    store
      .get(dialogGeometryStorageKey(dialogId))
      .then((value) => {
        if (cancelled) return;
        const sanitized = sanitizeDialogGeometry(value);
        if (!sanitized) return;
        setGeometry(clampDialogGeometry(sanitized, currentConstraints()));
      })
      .catch(() => {
        // Store is best-effort; fall back to the centered default.
      });
    return () => {
      cancelled = true;
    };
  }, [dialogId, active, enabled, currentConstraints]);

  // Keep the dialog fully on screen when the viewport shrinks.
  useEffect(() => {
    if (!active || !enabled || !geometry) return;
    const handleWindowResize = () => {
      setGeometry((previous) =>
        previous ? clampDialogGeometry(previous, currentConstraints()) : previous
      );
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [active, enabled, geometry, currentConstraints]);

  const persist = useCallback(
    (next: DialogGeometry) => {
      const clamped = clampDialogGeometry(next, currentConstraints());
      setGeometry(clamped);
      geometryRef.current = clamped;
      getStoreApi()
        ?.set(dialogGeometryStorageKey(dialogId), clamped)
        .catch(() => {
          // Persisting geometry is best-effort.
        });
    },
    [dialogId, currentConstraints]
  );

  const beginInteraction = useCallback(
    (mode: 'move' | 'resize') => (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0 || event.defaultPrevented) return;
      if (mode === 'move') {
        const target = event.target as HTMLElement | null;
        if (target?.closest(NO_DRAG_SELECTOR)) return;
      }
      event.preventDefault();

      // Seed the interaction from the persisted geometry, or — on the first
      // gesture of a centered dialog — from the panel's rect. A move-only
      // gesture records position and leaves the size CSS-driven.
      const seeded = geometryFromPanel(panelRef.current);
      const startGeometry =
        geometryRef.current ??
        (mode === 'move' && seeded ? { ...seeded, width: null, height: null } : seeded) ?? {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        };
      const startX = event.clientX;
      const startY = event.clientY;

      const handleMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        const candidate: DialogGeometry =
          mode === 'move'
            ? { ...startGeometry, x: startGeometry.x + deltaX, y: startGeometry.y + deltaY }
            : {
                ...startGeometry,
                width: Math.max(0, (startGeometry.width ?? 0) + deltaX),
                height: Math.max(0, (startGeometry.height ?? 0) + deltaY),
              };
        const clamped = clampDialogGeometry(candidate, currentConstraints());
        setGeometry(clamped);
        geometryRef.current = clamped;
      };

      const handleEnd = () => {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleEnd);
        window.removeEventListener('pointercancel', handleEnd);
        const latest = geometryRef.current;
        if (latest) persist(latest);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleEnd);
      window.addEventListener('pointercancel', handleEnd);
    },
    [enabled, panelRef, currentConstraints, persist]
  );

  const handleHeaderPointerDown = useMemo(
    () => (draggable ? beginInteraction('move') : undefined),
    [draggable, beginInteraction]
  );
  const handleResizeHandlePointerDown = useMemo(
    () => (resizable ? beginInteraction('resize') : undefined),
    [resizable, beginInteraction]
  );

  const panelStyle = useMemo<CSSProperties>(() => {
    if (!geometry) return {};
    const style: CSSProperties = {};
    if (draggable) {
      style.position = 'fixed';
      style.left = geometry.x;
      style.top = geometry.y;
      style.margin = 0;
    }
    if (resizable) {
      if (geometry.width != null) style.width = geometry.width;
      if (geometry.height != null) {
        style.height = geometry.height;
        // The .modal class caps height at 90vh; an explicit resized height
        // may legitimately exceed that, so relax the cap to the viewport.
        style.maxHeight = '100vh';
      }
    }
    return style;
  }, [geometry, draggable, resizable]);

  return { geometry, panelStyle, handleHeaderPointerDown, handleResizeHandlePointerDown };
}
