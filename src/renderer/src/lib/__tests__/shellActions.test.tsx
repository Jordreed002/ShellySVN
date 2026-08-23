import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  openDiffWizard,
  openNotificationCenter,
  openShelfManager,
  useDiffWizardRequest,
  useNotificationCenterOpenEvent,
  useShelfManagerOpenState,
} from '../shellActions';
import { SHELL_EVENTS } from '../svnOperationEvents';

describe('shell action dispatchers', () => {
  it('dispatches the diff-wizard event with its prefill payload', () => {
    const listener = vi.fn();
    window.addEventListener(SHELL_EVENTS.OPEN_DIFF_WIZARD, listener);

    openDiffWizard();
    openDiffWizard({ left: { kind: 'url', target: 'https://s/trunk', revision: 'HEAD' } });

    expect(listener).toHaveBeenCalledTimes(2);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({});
    expect((listener.mock.calls[1][0] as CustomEvent).detail).toMatchObject({
      left: { kind: 'url', target: 'https://s/trunk' },
    });
    window.removeEventListener(SHELL_EVENTS.OPEN_DIFF_WIZARD, listener);
  });

  it('dispatches the shelf-manager and notification-center events', () => {
    const shelf = vi.fn();
    const center = vi.fn();
    window.addEventListener(SHELL_EVENTS.OPEN_SHELF_MANAGER, shelf);
    window.addEventListener(SHELL_EVENTS.OPEN_NOTIFICATION_CENTER, center);

    openShelfManager();
    openNotificationCenter();

    expect(shelf).toHaveBeenCalledTimes(1);
    expect(center).toHaveBeenCalledTimes(1);
    window.removeEventListener(SHELL_EVENTS.OPEN_SHELF_MANAGER, shelf);
    window.removeEventListener(SHELL_EVENTS.OPEN_NOTIFICATION_CENTER, center);
  });
});

describe('shell open-state hooks (the Layout-level wiring)', () => {
  it('useDiffWizardRequest opens from the event, carries the request and closes', () => {
    const { result } = renderHook(() => useDiffWizardRequest());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.request).toBeNull();

    act(() => {
      openDiffWizard({ right: { kind: 'url', target: 'https://s/branches/x', revision: '12' } });
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.request).toMatchObject({ right: { target: 'https://s/branches/x' } });

    act(() => {
      result.current.close();
    });
    expect(result.current.isOpen).toBe(false);

    // Local open works for Layout-owned affordances too.
    act(() => {
      result.current.open({ left: { kind: 'url', target: 'a', revision: 'HEAD' } });
    });
    expect(result.current.isOpen).toBe(true);
  });

  it('useShelfManagerOpenState toggles from the event', () => {
    const { result } = renderHook(() => useShelfManagerOpenState());
    expect(result.current.isOpen).toBe(false);

    act(() => {
      openShelfManager();
    });
    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.close();
    });
    expect(result.current.isOpen).toBe(false);
  });

  it('useNotificationCenterOpenEvent translates the event into the open callback', () => {
    const onOpen = vi.fn();
    renderHook(() => useNotificationCenterOpenEvent(onOpen));
    act(() => {
      openNotificationCenter();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
