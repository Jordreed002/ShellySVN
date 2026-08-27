/**
 * A popover anchored to a trigger button, rendered through a portal on
 * document.body.
 *
 * Why a portal: hosts clip absolutely-positioned children — `.modal` carries
 * `overflow-hidden` for its rounded corners, and its `glass-strong` surface
 * is a containing block, so even `position: fixed` panels born inside it are
 * cropped to the modal's box (this is why the context menu is `fixed` and
 * z-[800]). Portaling to body escapes every ancestor; the panel is then
 * placed in viewport coordinates.
 *
 * Placement: below the anchor by default, aligned to the `align` edge,
 * flipping to the opposite edge when that would cross the viewport and then
 * clamped to the side margins. Vertically it flips above the anchor when
 * there is more room there, and caps its height against whichever edge it
 * settles on (scrolling internally when capped). Re-places on resize, on any
 * scroll in the tree, and whenever the panel's own content resizes — so a
 * menu that grows after opening cannot grow off-screen.
 *
 * Escape is the host's business: React bubbles portal events through the
 * React tree, so a wrapper owning both the trigger and this popover (see
 * `LogFilterBar`) receives it wherever focus sits.
 */

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

/** Smallest gap kept between the panel and any viewport edge. */
const MARGIN = 8;

/** Gap between the anchor and the panel. */
const GAP = 6;

/** A capped panel never shrinks below this — below it, menus stop being usable. */
const MIN_HEIGHT = 160;

interface Placement {
  left: number;
  top: number;
  maxHeight: number | null;
  width: number | null;
}

function same(a: Placement, b: Placement): boolean {
  return (
    a.left === b.left && a.top === b.top && a.maxHeight === b.maxHeight && a.width === b.width
  );
}

export interface PopoverProps {
  /** The trigger this panel is anchored to. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /**
   * Omit both this and `role` when the child already carries the menu
   * semantics — the panel is then a transparent positioning shell.
   */
  ariaLabel?: string;
  role?: string;
  /**
   * Which edge to line up with the anchor's matching edge. `end` is the
   * right-aligned form used by trailing controls; both flip when they would
   * cross the viewport, so this is a preference, not a guarantee.
   */
  align?: 'start' | 'end';
  /** Size the panel to the anchor — for select-like dropdowns. */
  matchAnchorWidth?: boolean;
  /** Surface styling — border, background, radius, shadow. */
  className?: string;
  /** Receives the panel node, for hosts that move focus into it on open. */
  panelRef?: MutableRefObject<HTMLDivElement | null>;
  children: ReactNode;
}

export function Popover({
  anchorRef,
  onClose,
  ariaLabel,
  role,
  align = 'start',
  matchAnchorWidth = false,
  className = '',
  panelRef: externalPanelRef,
  children,
}: PopoverProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Stable, so React does not detach/reattach the node on every render.
  const setPanel = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      if (externalPanelRef) externalPanelRef.current = node;
    },
    [externalPanelRef]
  );
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;

    const place = () => {
      const a = anchor.getBoundingClientRect();
      const rect = panel.getBoundingClientRect();

      // Natural height read from content, never by clearing the cap: the
      // ResizeObserver below watches this element, so mutating its size here
      // would feed itself. `offsetHeight - clientHeight` is the border box.
      const natural = panel.scrollHeight + (panel.offsetHeight - panel.clientHeight);
      const width = matchAnchorWidth ? a.width : rect.width;

      // Horizontal: preferred edge, then the opposite edge if that overflows,
      // then clamped so a panel wider than the viewport still starts on-screen.
      const fromStart = a.left;
      const fromEnd = a.right - width;
      let left = align === 'end' ? fromEnd : fromStart;
      if (align === 'end' ? left < MARGIN : left + width > window.innerWidth - MARGIN) {
        left = align === 'end' ? fromStart : fromEnd;
      }
      left = Math.min(
        Math.max(MARGIN, left),
        Math.max(MARGIN, window.innerWidth - width - MARGIN)
      );

      // Vertical: below unless above is genuinely roomier. Either way the
      // panel caps to the room it has, floored at MIN_HEIGHT so it stays
      // usable — and the floor is then absorbed by shifting, not by
      // overflowing the edge.
      const roomBelow = window.innerHeight - MARGIN - (a.bottom + GAP);
      const roomAbove = a.top - GAP - MARGIN;
      const flipUp = natural > roomBelow && roomAbove > roomBelow;
      const room = Math.max(MIN_HEIGHT, flipUp ? roomAbove : roomBelow);
      const height = Math.min(natural, room);
      const top = flipUp
        ? Math.max(MARGIN, a.top - GAP - height)
        : Math.min(a.bottom + GAP, Math.max(MARGIN, window.innerHeight - height - MARGIN));

      const next: Placement = {
        left: Math.round(left),
        top: Math.round(top),
        maxHeight: natural > room ? Math.round(room) : null,
        width: matchAnchorWidth ? Math.round(width) : null,
      };
      // Scroll fires `place` continuously and the observer feeds back on its
      // own cap, so only commit real movement.
      setPlacement((prev) => (prev && same(prev, next) ? prev : next));
    };

    place();

    // `capture` so scrolling in any ancestor container re-places, not just the
    // window — the anchor moves with it.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { capture: true, passive: true });

    // Guarded: jsdom has no ResizeObserver, and it is only an optimisation
    // here — the listeners above still cover the common cases without it.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(panel);
    observer?.observe(anchor);

    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, { capture: true });
      observer?.disconnect();
    };
  }, [anchorRef, align, matchAnchorWidth]);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[790]" onClick={onClose} aria-hidden="true" />
      <div
        ref={setPanel}
        role={role}
        aria-label={ariaLabel}
        style={{
          position: 'fixed',
          left: placement?.left ?? 0,
          top: placement?.top ?? 0,
          maxHeight: placement?.maxHeight ?? undefined,
          width: placement?.width ?? undefined,
          // Hidden until measured; the layout effect positions before paint,
          // so the (0,0) frame is never shown.
          visibility: placement ? 'visible' : 'hidden',
        }}
        className={`scrollbar-overlay z-[800] overflow-y-auto ${className}`}
      >
        {children}
      </div>
    </>,
    document.body
  );
}
