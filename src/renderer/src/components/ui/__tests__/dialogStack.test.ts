import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  dialogStackDepth,
  dialogStackIds,
  isTopDialog,
  lockBodyScroll,
  pushDialog,
  subscribeToDialogStack,
  topDialogId,
} from '../../../lib/dialogStack';

describe('dialog stack', () => {
  afterEach(() => {
    // Every test releases what it pushes; a non-empty stack here means a leak.
    expect(dialogStackDepth()).toBe(0);
    document.body.style.overflow = '';
  });

  it('tracks the top-most dialog', () => {
    const releaseA = pushDialog('a');
    expect(isTopDialog('a')).toBe(true);
    expect(topDialogId()).toBe('a');

    const releaseB = pushDialog('b');
    expect(isTopDialog('a')).toBe(false);
    expect(isTopDialog('b')).toBe(true);
    expect(topDialogId()).toBe('b');
    expect(dialogStackIds()).toEqual(['a', 'b']);

    releaseB();
    expect(isTopDialog('a')).toBe(true);
    expect(dialogStackDepth()).toBe(1);

    releaseA();
    expect(topDialogId()).toBeUndefined();
    expect(dialogStackDepth()).toBe(0);
  });

  it('releases are idempotent', () => {
    const release = pushDialog('only');
    release();
    release();
    expect(dialogStackDepth()).toBe(0);
  });

  it('supports the same id on sibling dialogs by removing the newest occurrence', () => {
    const releaseFirst = pushDialog('shared');
    const releaseSecond = pushDialog('shared');
    expect(dialogStackDepth()).toBe(2);

    releaseSecond();
    expect(dialogStackDepth()).toBe(1);
    expect(isTopDialog('shared')).toBe(true);

    releaseFirst();
    expect(dialogStackDepth()).toBe(0);
  });

  it('notifies subscribers when the stack changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToDialogStack(listener);
    expect(listener).not.toHaveBeenCalled();

    const release = pushDialog('notify-me');
    expect(listener).toHaveBeenCalledTimes(1);

    release();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    const releaseLate = pushDialog('after-unsubscribe');
    expect(listener).toHaveBeenCalledTimes(2);
    releaseLate();
  });

  describe('lockBodyScroll', () => {
    it('locks while any dialog holds the lock and restores afterwards', () => {
      expect(document.body.style.overflow).toBe('');

      const unlockOuter = lockBodyScroll();
      expect(document.body.style.overflow).toBe('hidden');

      // A nested dialog locks again; the previous value must not be clobbered.
      document.body.style.overflow = 'hidden';
      const unlockInner = lockBodyScroll();
      expect(document.body.style.overflow).toBe('hidden');

      unlockInner();
      expect(document.body.style.overflow).toBe('hidden');

      unlockOuter();
      expect(document.body.style.overflow).toBe('');
    });

    it('restores the pre-lock value rather than always clearing it', () => {
      document.body.style.overflow = 'scroll';
      const unlock = lockBodyScroll();
      expect(document.body.style.overflow).toBe('hidden');
      unlock();
      expect(document.body.style.overflow).toBe('scroll');
      document.body.style.overflow = '';
    });

    it('tolerates extra unlocks', () => {
      const unlock = lockBodyScroll();
      unlock();
      unlock();
      expect(document.body.style.overflow).toBe('');
    });
  });
});
