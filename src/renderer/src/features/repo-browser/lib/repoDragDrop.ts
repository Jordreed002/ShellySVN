/**
 * Drag-and-drop plumbing for the repository browser (#68).
 *
 * Follows the idioms of `hooks/useDragDrop.tsx` (read-only for this feature) —
 * a custom MIME type carrying the dragged paths, `text/plain` fallback,
 * ctrl/cmd meaning copy — but carries **repository-relative** paths rather
 * than local ones, so a repo-browser drag can never be mistaken for a
 * working-copy drag by a drop target in another surface. Hence a separate
 * MIME type and a feature-local module instead of edits to the shared hook.
 *
 * One piece of state is module-scoped: `dragover` cannot read
 * `dataTransfer.getData` (the DOM only allows that on `drop`), so the dragged
 * paths are remembered here to validate targets *during* the drag.
 */

/** Paths being dragged, alive from `dragstart` to `dragend`. */
let draggingPaths: string[] | null = null;

export const REPO_DRAG_MIME = 'application/x-shellysvn-repo-paths';

/** The drag payload, as written to the custom MIME type. */
export interface RepoDragPayload {
  /** Repository-relative paths of the dragged entries. */
  paths: string[];
  /** Repository root URL, so a cross-pane drop can tell whose paths these are. */
  rootUrl: string;
}

/** Just enough of `DataTransfer` for read/write; jsdom events carry a stub. */
interface DataTransferLike {
  types?: readonly string[];
  setData?(type: string, value: string): void;
  getData?(type: string): string;
  effectAllowed?: string;
  dropEffect?: string;
}

/**
 * The structural shape a drag handler needs. React's synthetic `DragEvent`
 * satisfies it (and is what row/node handlers forward), and so does a plain
 * DOM `DragEvent` — the point is that modifiers survive either way, which
 * forwarding only `.nativeEvent` in jsdom does not guarantee.
 */
export interface RepoDragEventLike {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  preventDefault?(): void;
  dataTransfer?: DataTransferLike;
}

export function writeRepoDragData(
  dataTransfer: DataTransferLike | undefined,
  payload: RepoDragPayload
): void {
  draggingPaths = payload.paths;
  dataTransfer?.setData?.(REPO_DRAG_MIME, JSON.stringify(payload));
  dataTransfer?.setData?.('text/plain', payload.paths.join('\n'));
  // Both are legal: the user may yet hold a modifier, so allow either effect
  // and let `dragover` narrow it.
  if (dataTransfer) dataTransfer.effectAllowed = 'copyMove';
}

/** Paths currently being dragged, or null when no repo drag is in flight. */
export function getDraggingRepoPaths(): string[] | null {
  return draggingPaths;
}

/** Parse the custom MIME payload, tolerating a stub or absent dataTransfer. */
export function readRepoDragData(
  dataTransfer: DataTransferLike | undefined
): RepoDragPayload | null {
  const raw = dataTransfer?.getData?.(REPO_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RepoDragPayload>;
    if (!Array.isArray(parsed.paths)) return null;
    return {
      paths: parsed.paths.filter((path): path is string => typeof path === 'string'),
      rootUrl: typeof parsed.rootUrl === 'string' ? parsed.rootUrl : '',
    };
  } catch {
    return null;
  }
}

/** True when the drag payload (or in-flight state) is a repo-browser drag. */
export function isRepoDrag(dataTransfer: DataTransferLike | undefined): boolean {
  if (dataTransfer?.types?.includes(REPO_DRAG_MIME)) return true;
  return draggingPaths !== null;
}

/** Clear the in-flight drag. Call from `dragend` and after `drop`. */
export function endRepoDrag(): void {
  draggingPaths = null;
}

/**
 * Which operation a drop would perform: ctrl/cmd held means copy, anything
 * else means move. A `copy` `dropEffect` — set by the `dragover` that accepted
 * the drag — counts as copy too: the DOM contract makes `dropEffect` the
 * authoritative answer once modifiers are no longer readable, and jsdom drag
 * events never carry modifiers at all. (`alt`/link has no repository-browser
 * meaning and is treated as move, never silently mapped onto `svn:externals`.)
 */
export function operationForDragEvent(event: RepoDragEventLike): 'move' | 'copy' {
  if (event.ctrlKey === true || event.metaKey === true) return 'copy';
  if (event.dataTransfer?.dropEffect === 'copy') return 'copy';
  return 'move';
}
