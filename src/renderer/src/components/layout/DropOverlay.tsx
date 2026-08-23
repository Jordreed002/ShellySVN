import { useCallback, useEffect, useReducer, useRef } from 'react';
import { FolderDown, Loader2, XCircle } from 'lucide-react';
import {
  DROP_OVERLAY_IDLE,
  dropOverlayReducer,
  type DropOverlayState,
} from '@renderer/lib/dropOverlay';

interface FolderDropZoneProps {
  /**
   * Open `path` as a working copy (the Layout routes this through the same
   * open flow the home screen uses: validate → addRecentRepo → navigate).
   */
  onOpenWorkingCopy: (path: string) => Promise<void> | void;
}

/** True when the drag carries something other than our internal rows. */
function isExternalDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  return types.includes('Files') && !types.includes('application/x-shellysvn-paths');
}

/**
 * Window-level folder drag & drop (#85): dropping a working-copy folder
 * anywhere on the app offers to open it as a working copy. While a drag is
 * live a full-window overlay says what will happen; the drop is then checked
 * (`svn info`, same rule as the home screen) before the open flow runs, and
 * failures stay visible until dismissed.
 */
export function FolderDropZone({ onOpenWorkingCopy }: FolderDropZoneProps) {
  const [state, dispatch] = useReducer(dropOverlayReducer, DROP_OVERLAY_IDLE);
  const stateRef = useRef<DropOverlayState>(DROP_OVERLAY_IDLE);
  stateRef.current = state;

  const handleOpen = useCallback(
    async (path: string) => {
      dispatch({ type: 'drop', path });
      try {
        const info = await window.api.svn.info(path);
        if (!info) {
          dispatch({
            type: 'inspect-fail',
            message: `${path} is not a Subversion working copy — svn info found nothing there.`,
          });
          return;
        }
        await onOpenWorkingCopy(path);
        dispatch({ type: 'inspect-ok' });
      } catch (error) {
        dispatch({
          type: 'inspect-fail',
          message:
            error instanceof Error
              ? `${path} could not be opened: ${error.message}`
              : `${path} could not be opened.`,
        });
      }
    },
    [onOpenWorkingCopy]
  );

  useEffect(() => {
    // dragleave fires on every child boundary; only the window-level leave
    // (no related target, or one outside the document) ends the overlay.
    const handleDragOver = (event: DragEvent) => {
      if (!isExternalDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'link';
      if (stateRef.current.phase === 'idle' || stateRef.current.phase === 'error') {
        dispatch({ type: 'drag-enter' });
      }
    };
    const handleDragLeave = (event: DragEvent) => {
      if (event.relatedTarget) return;
      dispatch({ type: 'drag-leave' });
    };
    const handleDrop = (event: DragEvent) => {
      if (!isExternalDrag(event)) return;
      event.preventDefault();
      if (stateRef.current.phase !== 'dragging') return;
      const file = event.dataTransfer?.files.item(0);
      const path = file ? window.api.dialog.getPathForFile(file) : undefined;
      if (!path) {
        dispatch({ type: 'drop' });
        return;
      }
      void handleOpen(path);
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handleOpen, stateRef]);

  if (state.phase === 'idle') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[60] grid place-items-center bg-bg/70 backdrop-blur-[2px] p-6"
    >
      <div className="max-w-md w-full p-5 rounded-2xl border border-accent/50 bg-bg-elevated shadow-card text-center">
        {state.phase === 'dragging' && (
          <>
            <FolderDown className="mx-auto h-8 w-8 text-accent" aria-hidden="true" />
            <p className="mt-3 text-14 font-semibold text-text">Drop to open a working copy</p>
            <p className="mt-1 text-12.5 text-text-muted">
              Drop a Subversion working-copy folder to open it in a tab.
            </p>
          </>
        )}
        {state.phase === 'inspecting' && (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" aria-hidden="true" />
            <p className="mt-3 text-14 font-semibold text-text">Checking {state.path}…</p>
            <p className="mt-1 text-12.5 text-text-muted">Running svn info before opening.</p>
          </>
        )}
        {state.phase === 'error' && (
          <>
            <XCircle className="mx-auto h-8 w-8 text-error" aria-hidden="true" />
            <p className="mt-3 text-14 font-semibold text-text">Cannot open that folder</p>
            <p className="mt-1 text-12.5 text-text-muted break-words">{state.message}</p>
            <button
              type="button"
              onClick={() => dispatch({ type: 'dismiss' })}
              className="btn btn-secondary btn-sm mt-4"
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}
