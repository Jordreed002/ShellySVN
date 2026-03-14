import { describe, it, expect } from 'vitest';
import { formatBytes, type FormatBytesOptions } from '../utils/formatBytes';

describe('formatBytes', () => {
  describe('basic functionality', () => {
    it('should format 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('should format bytes', () => {
      expect(formatBytes(512)).toBe('512 B');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1536)).toBe('2 KB'); // 1.5 KB rounded
    });

    it('should format megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
      expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    });

    it('should format gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    });

    it('should format terabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB');
    });
  });

  describe('precision option', () => {
    it('should use fixed precision', () => {
      expect(formatBytes(1536, { precision: 2 })).toBe('1.50 KB');
    });

    it('should use fixed precision for MB', () => {
      expect(formatBytes(1.5 * 1024 * 1024, { precision: 2 })).toBe('1.50 MB');
    });
  });

  describe('trimZeros option', () => {
    it('should trim trailing zeros', () => {
      expect(formatBytes(1024 * 1024, { trimZeros: true })).toBe('1 MB');
      expect(formatBytes(1.5 * 1024 * 1024, { trimZeros: true })).toBe('1.5 MB');
    });
  });

  describe('maxUnit option', () => {
    it('should limit to GB', () => {
      expect(formatBytes(1024 * 1024 * 1024 * 1024, { maxUnit: 'GB' })).toBe('1024.0 GB');
    });

    it('should limit to MB', () => {
      expect(formatBytes(1024 * 1024 * 1024, { maxUnit: 'MB' })).toBe('1024.0 MB');
    });
  });
});
