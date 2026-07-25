// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { sendToRenderer } from '../safe-renderer-send';

describe('sendToRenderer', () => {
  it('skips destroyed renderers and absorbs a close race', () => {
    const destroyed = { isDestroyed: () => true, send: vi.fn() };
    expect(sendToRenderer(destroyed, 'event', {})).toBe(false);
    expect(destroyed.send).not.toHaveBeenCalled();

    const closing = {
      isDestroyed: () => false,
      send: vi.fn(() => {
        throw new Error('Object has been destroyed');
      }),
    };
    expect(sendToRenderer(closing, 'event', {})).toBe(false);
  });
});
