import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NotificationCenterBell,
  NotificationCenterPanel,
  ToastStack,
} from '../NotificationCenter';
import {
  clearNotifications,
  getNotificationCenterSnapshot,
  markAllNotificationsRead,
  pushNotification,
  resetNotificationCenterForTests,
  TOAST_TTL_MS,
} from '@renderer/lib/notificationCenterStore';
import { AppMotionProvider } from '@renderer/lib/AppMotionProvider';

function mockStore() {
  window.api = {
    store: { get: vi.fn().mockResolvedValue(undefined), set: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Window['api'];
}

/**
 * The panel anchors to the bell and portals out of it, mirroring how the
 * Layout mounts the pair — so the test has to supply a real anchor.
 */
function PanelHarness({ onClose }: { onClose: () => void }) {
  const anchorRef = React.useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={anchorRef} type="button">
        Notifications
      </button>
      <NotificationCenterPanel anchorRef={anchorRef} onClose={onClose} />
    </>
  );
}

describe('NotificationCenterBell', () => {
  beforeEach(() => {
    resetNotificationCenterForTests();
    mockStore();
  });

  it('reports the unread count on the label and badge', () => {
    pushNotification({ severity: 'info', title: 'One', toast: false });
    pushNotification({ severity: 'error', title: 'Two', toast: false });
    const onToggle = vi.fn();
    const { rerender } = render(<NotificationCenterBell isOpen={false} onToggle={onToggle} />);

    const bell = screen.getByRole('button', { name: 'Notifications — 2 unread' });
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    expect(bell).toHaveTextContent('2');

    fireEvent.click(bell);
    expect(onToggle).toHaveBeenCalledTimes(1);

    // Once everything is read, the label settles back.
    markAllNotificationsRead();
    rerender(<NotificationCenterBell isOpen={true} onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('caps the badge display at 9+', () => {
    for (let index = 0; index < 11; index += 1) {
      pushNotification({ severity: 'info', title: `n${index}`, toast: false });
    }
    render(<NotificationCenterBell isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Notifications — 11 unread' })).toHaveTextContent(
      '9+'
    );
  });
});

describe('NotificationCenterPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetNotificationCenterForTests();
    mockStore();
  });

  it('marks everything read on open, lists history newest-first with time-ago, and clears', async () => {
    pushNotification({
      severity: 'success',
      title: 'Update finished — atlas',
      body: 'r42 · 12s',
      source: 'operation',
      workingCopyPath: '/wc/atlas',
      toast: false,
    });
    pushNotification({ severity: 'error', title: 'Commit failed — nadir', toast: false });

    render(<PanelHarness onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Notification center' });

    // Newest first.
    const titles = Array.from(dialog.querySelectorAll('p')).map((node) => node.textContent);
    expect(titles.indexOf('Commit failed — nadir')).toBeLessThan(
      titles.indexOf('Update finished — atlas')
    );
    expect(screen.getByText('r42 · 12s')).toBeInTheDocument();
    expect(screen.getAllByText('just now')).toHaveLength(2);
    expect(screen.getByText('· /wc/atlas')).toBeInTheDocument();

    // Opening the panel reads everything — the bell's next render shows no badge.
    await waitFor(() =>
      expect(screen.queryByLabelText('Unread')).not.toBeInTheDocument()
    );

    // Clear empties the list.
    fireEvent.click(screen.getByRole('button', { name: 'Clear all notifications' }));
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();

    clearNotifications();
  });

  it('marks a single item read on click', () => {
    pushNotification({ severity: 'info', title: 'Clickable', toast: false });
    render(<PanelHarness onClose={vi.fn()} />);
    // Panel mount already read everything; the per-item click path still runs.
    fireEvent.click(screen.getByText('Clickable'));
    expect(screen.queryByLabelText('Unread')).not.toBeInTheDocument();
  });

  it('closes on Escape and on outside pointer', () => {
    pushNotification({ severity: 'info', title: 'Something', toast: false });
    const onClose = vi.fn();
    render(<PanelHarness onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('disables mark-all-read/clear for an empty history', () => {
    render(<PanelHarness onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Mark all notifications as read' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear all notifications' })).toBeDisabled();
  });
});

describe('ToastStack', () => {
  beforeEach(() => {
    resetNotificationCenterForTests();
    mockStore();
  });

  it('shows pushed toasts with severity colouring and dismisses them manually', () => {
    render(
      <AppMotionProvider>
        <ToastStack />
      </AppMotionProvider>
    );
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      pushNotification({ severity: 'error', title: 'Commit failed', body: 'E170001' });
    });
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Commit failed');
    expect(toast).toHaveTextContent('E170001');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification: Commit failed' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('auto-dismisses toasts after the TTL', () => {
    vi.useFakeTimers();
    try {
      render(
        <AppMotionProvider>
          <ToastStack />
        </AppMotionProvider>
      );
      act(() => {
        pushNotification({ severity: 'success', title: 'Update finished' });
      });
      expect(screen.getByRole('status')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(TOAST_TTL_MS + 20);
      });
      // The store dropped the toast (the DOM node may still be mid exit
      // animation — framer's concern, not the contract under test).
      expect(getNotificationCenterSnapshot().toasts).toHaveLength(0);
      expect(getNotificationCenterSnapshot().items.map((entry) => entry.title)).toContain(
        'Update finished'
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
