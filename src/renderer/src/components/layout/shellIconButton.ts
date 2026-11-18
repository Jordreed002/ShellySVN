/**
 * The one titlebar icon-button shape: a 28px ghost square with a 6px radius.
 *
 * Idle it is just the glyph; hover fills it with the neutral raised surface;
 * an engaged toggle (or an open menu) keeps that fill and full-strength ink.
 * The accent is deliberately absent — in the shell it marks selection and the
 * primary action only, so an open panel reads as "on", not as "selected".
 *
 * `shell-icon-button` is a semantic hook for global styles; every visual rule
 * here is a Tailwind utility on existing tokens.
 */
const BASE =
  'shell-icon-button titlebar-no-drag relative grid h-7 w-7 flex-shrink-0 place-items-center rounded-md transition-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-40';

const IDLE = 'text-text-muted hover:bg-bg-tertiary hover:text-text';

const ON = 'bg-bg-tertiary text-text';

export function shellIconButtonClass(active = false): string {
  return `${BASE} ${active ? ON : IDLE}`;
}

/** Glyph size used by every titlebar icon button. */
export const SHELL_ICON = 'h-[15px] w-[15px]';
