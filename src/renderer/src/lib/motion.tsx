import { type ReactNode, useSyncExternalStore } from 'react';
import {
  AnimatePresence,
  LazyMotion,
  MotionConfig,
  m,
  type Transition,
  type Variants,
} from 'framer-motion';

/**
 * Motion foundation for the app.
 *
 * We use Framer Motion's `LazyMotion` with a *lazily loaded* feature bundle so
 * the always-resident app shell only pays for the tiny `m` core in the initial
 * renderer chunk (the `domAnimation` features ~15KB load on demand). This keeps
 * us under the renderer bundle budget (see .spec/performance-budgets.md).
 *
 * Because we run in `strict` mode, components MUST use `m.*` (e.g. `m.div`),
 * never `motion.*`.
 */
const loadFeatures = () => import('framer-motion').then((mod) => mod.domAnimation);

export { m, AnimatePresence };

/**
 * Shared spring/timing tokens. Keep motion physical and snappy (Raycast-grade)
 * rather than long and floaty.
 */
export const springs = {
  /** Quick, tight — buttons, toggles, selection highlights. */
  snappy: { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 } satisfies Transition,
  /** Smooth — panels, list items, content transitions. */
  smooth: { type: 'spring', stiffness: 320, damping: 32, mass: 0.9 } satisfies Transition,
  /** Overlay — command palette / dialogs entering. */
  overlay: { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 } satisfies Transition,
} as const;

/** Easing curve matching the CSS `out-quart` used elsewhere. */
export const easeOutQuart: Transition['ease'] = [0.25, 1, 0.5, 1];

export const variants = {
  /** Generic fade + lift for content/route transitions. */
  fadeUp: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 6 },
  } satisfies Variants,
  /** Overlay panel (command palette, dialogs) scale-in. */
  overlayPanel: {
    initial: { opacity: 0, y: -8, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -6, scale: 0.98 },
  } satisfies Variants,
  /** Backdrop fade. */
  backdrop: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  } satisfies Variants,
  /** Right inspector / side panel slide. */
  sidePanel: {
    initial: { opacity: 0, x: 24 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 24 },
  } satisfies Variants,
  /** Container that staggers its children in. */
  staggerList: {
    animate: { transition: { staggerChildren: 0.025, delayChildren: 0.02 } },
  } satisfies Variants,
  /** Individual list row used inside `staggerList`. */
  listItem: {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
  } satisfies Variants,
} as const;

/**
 * Whether motion is currently enabled, derived from the `animations-none` class
 * that `useVisualSettings` toggles on <html> from the user's animationSpeed
 * setting. Components can use this to skip orchestration/initial animations.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function getSnapshot(): boolean {
  return !document.documentElement.classList.contains('animations-none');
}

export function useMotionEnabled(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}

/**
 * Mount once near the root. Wraps the tree in LazyMotion (deferred features) and
 * a MotionConfig that honours the OS "reduce motion" preference.
 */
export function AppMotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user" transition={springs.smooth}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
