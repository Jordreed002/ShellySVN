import { describe, it, expect } from 'vitest';
import { formatTime, formatDuration } from '../utils/formatTime';

describe('formatTime', () => {
  it('should format seconds', () => {
    expect(formatTime(30)).toBe('30s');
    expect(formatTime(59)).toBe('59s');
  });

  it('should format minutes', () => {
    expect(formatTime(60)).toBe('1m');
    expect(formatTime(90)).toBe('1m 30s');
    expect(formatTime(120)).toBe('2m');
  });

  it('should format hours', () => {
    expect(formatTime(3600)).toBe('1h');
    expect(formatTime(3661)).toBe('1h 1m');
    expect(formatTime(7200)).toBe('2h');
  });
});

describe('formatDuration', () => {
  describe('short style (default)', () => {
    it('should format microseconds', () => {
      expect(formatDuration(0.5)).toBe('500μs');
    });

    it('should format milliseconds', () => {
      expect(formatDuration(100)).toBe('100ms');
      expect(formatDuration(500)).toBe('500ms');
    });

    it('should format seconds', () => {
      expect(formatDuration(1500)).toBe('1.50s');
    });

    it('should format minutes', () => {
      expect(formatDuration(90000)).toBe('1m 30s');
    });
  });

  describe('long style', () => {
    it('should format under a minute', () => {
      expect(formatDuration(30000, 'long')).toBe('< 1 minute');
    });

    it('should format minutes', () => {
      expect(formatDuration(120000, 'long')).toBe('2 minutes');
    });

    it('should format hours', () => {
      expect(formatDuration(3600000, 'long')).toBe('1 hours');
    });

    it('should format days', () => {
      expect(formatDuration(86400000, 'long')).toBe('1 days');
    });
  });
});
