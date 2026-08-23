/**
 * Drop overlay state machine (#85).
 *
 * Pure reducer behind the full-window overlay shown while a folder is dragged
 * over the app. The component layer owns the DOM events; this owns the
 * discipline: only folders dropped from outside count, inspecting is a
 * distinct phase (the `svn info` check is async), and failures stay on screen
 * until dismissed instead of flashing away.
 */

export type DropOverlayPhase = 'idle' | 'dragging' | 'inspecting' | 'error';

export interface DropOverlayState {
  phase: DropOverlayPhase;
  /** The dropped folder being inspected. */
  path?: string;
  /** Failure message once the phase is `error`. */
  message?: string;
}

export const DROP_OVERLAY_IDLE: DropOverlayState = { phase: 'idle' };

export type DropOverlayEvent =
  | { type: 'drag-enter' }
  | { type: 'drag-leave' }
  | { type: 'drop'; path?: string }
  | { type: 'inspect-ok' }
  | { type: 'inspect-fail'; message: string }
  | { type: 'dismiss' };

export function dropOverlayReducer(
  state: DropOverlayState,
  event: DropOverlayEvent
): DropOverlayState {
  switch (event.type) {
    case 'drag-enter': {
      // A new drag can interrupt an error message; inspecting cannot.
      if (state.phase === 'inspecting') return state;
      return { phase: 'dragging' };
    }
    case 'drag-leave': {
      if (state.phase !== 'dragging') return state;
      return DROP_OVERLAY_IDLE;
    }
    case 'drop': {
      if (state.phase !== 'dragging') return state;
      if (!event.path) {
        return { phase: 'error', message: 'Drop a working-copy folder to open it.' };
      }
      return { phase: 'inspecting', path: event.path };
    }
    case 'inspect-ok': {
      if (state.phase !== 'inspecting') return state;
      return DROP_OVERLAY_IDLE;
    }
    case 'inspect-fail': {
      if (state.phase !== 'inspecting') return state;
      return { phase: 'error', path: state.path, message: event.message };
    }
    case 'dismiss': {
      return DROP_OVERLAY_IDLE;
    }
  }
}
