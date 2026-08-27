import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react';
import { Popover } from '@renderer/components/ui/Popover';
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Info,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  formatTimeAgo,
  useNotificationCenter,
  clearNotifications,
  dismissToast,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationCenterItem,
  type NotificationSeverity,
} from '@renderer/lib/notificationCenterStore';
import { AnimatePresence, m } from '@renderer/lib/motion';

const SEVERITY_ICON: Record<NotificationSeverity, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const SEVERITY_CLASS: Record<NotificationSeverity, string> = {
  info: 'text-accent',
  success: 'text-svn-normal',
  warning: 'text-warning',
  error: 'text-error',
};

function NotificationRow({ item }: { item: NotificationCenterItem }) {
  const Icon = SEVERITY_ICON[item.severity];
  return (
    <li
      className={`flex gap-2.5 px-3 py-2.5 transition-fast hover:bg-bg-tertiary ${
        item.read ? '' : 'bg-accent/[0.04]'
      }`}
    >
      <Icon className={`h-4 w-4 flex-shrink-0 mt-0.5 ${SEVERITY_CLASS[item.severity]}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className={`text-12.5 leading-snug ${item.read ? 'text-text-secondary' : 'text-text font-medium'}`}>
          {item.title}
        </p>
        {item.body && (
          <p className="mt-0.5 text-11.5 text-text-muted break-words">{item.body}</p>
        )}
        <p className="mt-1 flex items-center gap-1.5 text-10.5 text-text-faint">
          <span>{formatTimeAgo(item.createdAt)}</span>
          {item.workingCopyPath && (
            <span className="truncate" title={item.workingCopyPath}>
              · {item.workingCopyPath}
            </span>
          )}
        </p>
      </div>
      {!item.read && (
        <span aria-label="Unread" className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent flex-shrink-0" />
      )}
    </li>
  );
}

interface NotificationCenterBellProps {
  isOpen: boolean;
  onToggle: () => void;
  /** The panel anchors to this button, so the Layout holds its node. */
  buttonRef?: MutableRefObject<HTMLButtonElement | null>;
}

/**
 * The bell affordance (#81): unread badge over a Bell icon, opening the
 * notification center panel. Purely presentational — state lives in the
 * Layout so the `shellysvn:open-notification-center` event can open it too.
 */
export function NotificationCenterBell({
  isOpen,
  onToggle,
  buttonRef,
}: NotificationCenterBellProps) {
  const { unread } = useNotificationCenter();
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onToggle}
      aria-label={unread > 0 ? `Notifications — ${unread} unread` : 'Notifications'}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      title="Notifications"
      className={`titlebar-no-drag relative w-8 h-8 grid place-items-center rounded-lg border transition-fast ${
        isOpen
          ? 'bg-accent/10 border-accent/40 text-accent'
          : 'bg-transparent border-transparent text-text-secondary hover:bg-bg-tertiary hover:border-border hover:text-text'
      }`}
    >
      <Bell className="w-4 h-4" aria-hidden="true" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 grid place-items-center rounded-full bg-accent text-white text-[10px] font-bold leading-none ${
            unread > 9 ? 'px-0.5' : ''
          }`}
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}

/**
 * The notification center panel (#81): the consolidated, capped history of
 * app events with unread tracking, mark-all-read and clear.
 */
export function NotificationCenterPanel({
  onClose,
  anchorRef,
}: {
  onClose: () => void;
  /** The bell this panel hangs from. */
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const { items } = useNotificationCenter();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Opening the panel is reading it — the badge should settle immediately.
    markAllNotificationsRead();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // The panel portals out of the bell's box, so both count as "inside":
      // otherwise a panel click would dismiss before it landed, and a bell
      // click would close here and immediately reopen via its own toggle.
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, anchorRef]);

  return (
    <Popover
      anchorRef={anchorRef}
      panelRef={panelRef}
      onClose={onClose}
      align="end"
      role="dialog"
      ariaLabel="Notification center"
      className="flex w-[380px] max-w-[calc(100vw-24px)] flex-col rounded-xl border border-border bg-bg-elevated shadow-card"
    >
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <h2 className="text-12.5 font-semibold text-text">Notifications</h2>
        <span className="text-10.5 text-text-faint">{items.length}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={markAllNotificationsRead}
            disabled={items.length === 0}
            className="flex items-center gap-1 px-1.5 py-1 rounded-md text-11 text-text-secondary hover:bg-bg-tertiary hover:text-text transition-fast disabled:opacity-50 disabled:pointer-events-none"
            aria-label="Mark all notifications as read"
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" /> Mark all read
          </button>
          <button
            type="button"
            onClick={clearNotifications}
            disabled={items.length === 0}
            className="flex items-center gap-1 px-1.5 py-1 rounded-md text-11 text-text-secondary hover:bg-error/10 hover:text-error transition-fast disabled:opacity-50 disabled:pointer-events-none"
            aria-label="Clear all notifications"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Clear
          </button>
        </div>
      </header>
      {items.length === 0 ? (
        <p className="px-3 py-8 text-center text-12 text-text-muted" role="status">
          No notifications yet.
        </p>
      ) : (
        <ul className="max-h-[420px] overflow-y-auto divide-y divide-border">
          {items.toReversed().map((item) => (
            <button
              key={item.id}
              type="button"
              className="block w-full text-left"
              onClick={() => markNotificationRead(item.id)}
              title={item.read ? undefined : 'Mark as read'}
            >
              <NotificationRow item={item} />
            </button>
          ))}
        </ul>
      )}
    </Popover>
  );
}

/**
 * The transient surface (#81): a bottom-right stack of toasts that dismiss
 * themselves (timers live in the store). Rendered through the app's `m`/`
 * AnimatePresence` foundation, so reduced-motion is honoured via the root
 * `MotionConfig reducedMotion="user"`.
 */
export function ToastStack() {
  const { toasts } = useNotificationCenter();
  const dismiss = useCallback((id: string) => dismissToast(id), []);

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 w-[340px] max-w-[calc(100vw-24px)] pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = SEVERITY_ICON[toast.severity];
          return (
            <m.div
              key={toast.id}
              initial={{ opacity: 0, x: 24, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 16, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.8 }}
              role="status"
              className="pointer-events-auto flex gap-2.5 p-3 rounded-xl border border-border bg-bg-elevated/95 shadow-card backdrop-blur"
            >
              <Icon
                className={`h-4 w-4 flex-shrink-0 mt-0.5 ${SEVERITY_CLASS[toast.severity]}`}
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <p className="text-12.5 font-medium text-text leading-snug">{toast.title}</p>
                {toast.body && (
                  <p className="mt-0.5 text-11.5 text-text-muted break-words">{toast.body}</p>
                )}
              </div>
              <button
                type="button"
                aria-label={`Dismiss notification: ${toast.title}`}
                onClick={() => dismiss(toast.id)}
                className="h-5 w-5 -mr-1 -mt-1 grid place-items-center rounded text-text-faint hover:text-text hover:bg-bg-tertiary transition-fast"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </m.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
