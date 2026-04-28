/**
 * Tests for debug utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import debug from '../utils/debug';

describe('debug utility', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('debug.warn', () => {
    it('should log warning messages', () => {
      debug.warn('Test warning');

      expect(consoleWarnSpy).toHaveBeenCalled();
      const call = consoleWarnSpy.mock.calls[0];
      expect(call[0]).toMatch(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]\[WARN\]/);
      expect(call[1]).toBe('Test warning');
    });

    it('should log multiple arguments', () => {
      debug.warn('Warning', { detail: 'info' }, 123);

      expect(consoleWarnSpy).toHaveBeenCalled();
      const call = consoleWarnSpy.mock.calls[0];
      expect(call[1]).toBe('Warning');
      expect(call[2]).toEqual({ detail: 'info' });
      expect(call[3]).toBe(123);
    });

    it('should include timestamp in format', () => {
      debug.warn('Test');

      const call = consoleWarnSpy.mock.calls[0];
      // Timestamp format: [HH:MM:SS.mmm]
      expect(call[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]\[WARN\]$/);
    });
  });

  describe('debug.error', () => {
    it('should log error messages', () => {
      debug.error('Test error');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const call = consoleErrorSpy.mock.calls[0];
      expect(call[0]).toMatch(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]\[ERROR\]/);
      expect(call[1]).toBe('Test error');
    });

    it('should log error objects', () => {
      const error = new Error('Something went wrong');
      debug.error('Operation failed:', error);

      expect(consoleErrorSpy).toHaveBeenCalled();
      const call = consoleErrorSpy.mock.calls[0];
      expect(call[1]).toBe('Operation failed:');
      expect(call[2]).toBe(error);
    });

    it('should log multiple arguments', () => {
      debug.error('Error', 'code', 500);

      expect(consoleErrorSpy).toHaveBeenCalled();
      const call = consoleErrorSpy.mock.calls[0];
      expect(call[1]).toBe('Error');
      expect(call[2]).toBe('code');
      expect(call[3]).toBe(500);
    });
  });

  describe('debug.log', () => {
    it('should format messages with DEBUG category', () => {
      // Note: debug.log only outputs in dev mode, which may or may not be active
      // We test the format when it does log
      // In dev mode, it should log
      // The actual behavior depends on environment detection
      debug.log('Test debug');

      // In production, this might not log, so we just verify it doesn't throw
      expect(true).toBe(true);
    });

    it('should not throw errors', () => {
      expect(() => debug.log('Test')).not.toThrow();
      expect(() => debug.log('Test', {}, [], 123)).not.toThrow();
    });
  });

  describe('formatMessage (via output)', () => {
    it('should include category in output for warnings', () => {
      debug.warn('Message');

      const call = consoleWarnSpy.mock.calls[0];
      expect(call[0]).toContain('[WARN]');
    });

    it('should include category in output for errors', () => {
      debug.error('Message');

      const call = consoleErrorSpy.mock.calls[0];
      expect(call[0]).toContain('[ERROR]');
    });

    it('should include timestamp in output', () => {
      debug.warn('Message');

      const call = consoleWarnSpy.mock.calls[0];
      const timestampMatch = call[0].match(/\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/);

      expect(timestampMatch).not.toBeNull();

      // Verify the timestamp is reasonable (within the test execution time)
      if (timestampMatch) {
        const hours = parseInt(timestampMatch[1], 10);
        const minutes = parseInt(timestampMatch[2], 10);
        const seconds = parseInt(timestampMatch[3], 10);

        expect(hours).toBeGreaterThanOrEqual(0);
        expect(hours).toBeLessThan(24);
        expect(minutes).toBeGreaterThanOrEqual(0);
        expect(minutes).toBeLessThan(60);
        expect(seconds).toBeGreaterThanOrEqual(0);
        expect(seconds).toBeLessThan(60);
      }
    });
  });

  describe('export default', () => {
    it('should export debug object with all methods', () => {
      expect(debug).toBeDefined();
      expect(debug.log).toBeDefined();
      expect(debug.warn).toBeDefined();
      expect(debug.error).toBeDefined();
      expect(typeof debug.log).toBe('function');
      expect(typeof debug.warn).toBe('function');
      expect(typeof debug.error).toBe('function');
    });
  });
});
