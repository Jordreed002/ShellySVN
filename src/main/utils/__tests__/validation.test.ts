/**
 * Security Tests for Input Validation Utilities
 *
 * Tests path validation, URL validation, and other security-critical
 * input sanitization functions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock node:fs module - provide a default export for ESM compatibility
vi.mock('node:fs', () => ({
  default: {},
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

// Import after mocking
import { existsSync, statSync } from 'node:fs';
import {
  validatePath,
  validateUrl,
  validateString,
  validateNumber,
  validateStringArray,
  validateSvnPropertyName,
  validateCommitMessage,
  withValidation,
  InputValidationError,
} from '../../utils/validation';

// Get typed mocks
const mockExistsSync = vi.mocked(existsSync);
const mockStatSync = vi.mocked(statSync);

// Mock constants
vi.mock('@shared/constants', () => ({
  MAX_COMMIT_MESSAGE_LENGTH: 10000,
}));

// Import after mocking
import {
  validatePath,
  validateUrl,
  validateString,
  validateNumber,
  validateStringArray,
  validateSvnPropertyName,
  validateCommitMessage,
  withValidation,
  InputValidationError,
} from '../../utils/validation';

describe('InputValidationError', () => {
  it('should create error with field name', () => {
    const error = new InputValidationError('Test error', 'testField');
    expect(error.message).toBe('Test error');
    expect(error.field).toBe('testField');
    expect(error.name).toBe('InputValidationError');
  });
});

describe('validatePath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('type validation', () => {
    it('should reject non-string paths', () => {
      expect(() => validatePath(null as any)).toThrow(InputValidationError);
      expect(() => validatePath(null as any)).toThrow('Path must be a string');

      expect(() => validatePath(undefined as any)).toThrow('Path must be a string');
      expect(() => validatePath(123 as any)).toThrow('Path must be a string');
      expect(() => validatePath({} as any)).toThrow('Path must be a string');
      expect(() => validatePath([] as any)).toThrow('Path must be a string');
    });

    it('should reject empty paths', () => {
      expect(() => validatePath('')).toThrow('Path cannot be empty');
      expect(() => validatePath('   ')).toThrow('Path cannot be empty');
    });
  });

  describe('path traversal prevention', () => {
    it('should reject paths with .. after normalization', () => {
      // These paths still have .. after normalize()
      expect(() => validatePath('foo/../../bar')).toThrow('Path traversal not allowed');
    });

    it('should reject relative path traversal', () => {
      expect(() => validatePath('../etc/passwd')).toThrow('Path traversal not allowed');
      expect(() => validatePath('path/../../../etc')).toThrow('Path traversal not allowed');
    });

    it('should normalize paths and reject if .. remains', () => {
      // Path with more .. than path segments results in .. after normalization
      expect(() => validatePath('a/b/../../../etc')).toThrow('Path traversal not allowed');
    });
  });

  describe('absolute path restriction', () => {
    it('should reject absolute paths by default', () => {
      expect(() => validatePath('/etc/passwd')).toThrow('Absolute paths not allowed');
      expect(() => validatePath('/home/user/file.txt')).toThrow('Absolute paths not allowed');
    });

    it('should reject absolute paths even if they had .. in the original', () => {
      // /home/user/../etc/passwd normalizes to /home/etc/passwd (no ..)
      // but the ORIGINAL path starts with / so it fails absolute check
      expect(() => validatePath('/home/user/../etc/passwd')).toThrow('Absolute paths not allowed');
    });

    it('should allow absolute paths when allowAbsolute is true', () => {
      // Mock existsSync to return false so we don't check existence
      mockExistsSync.mockReturnValue(false);

      expect(() => validatePath('/home/user/file.txt', { allowAbsolute: true })).not.toThrow();
    });
  });

  describe('existence validation', () => {
    it('should check path existence when mustExist is true', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() =>
        validatePath('/path/to/file', { mustExist: true, allowAbsolute: true })
      ).toThrow('Path does not exist');
    });

    it('should pass when path exists', () => {
      mockExistsSync.mockReturnValue(true);

      expect(() =>
        validatePath('/path/to/file', { mustExist: true, allowAbsolute: true })
      ).not.toThrow();
    });
  });

  describe('directory validation', () => {
    it('should validate directory type', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

      expect(() =>
        validatePath('/path/to/dir', { mustBeDirectory: true, allowAbsolute: true })
      ).not.toThrow();
    });

    it('should reject file when directory expected', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isDirectory: () => false, isFile: () => true } as any);

      expect(() =>
        validatePath('/path/to/file', { mustBeDirectory: true, allowAbsolute: true })
      ).toThrow('Path must be a directory');
    });

    it('should not throw when path does not exist (skips check)', () => {
      mockExistsSync.mockReturnValue(false);

      // mustBeDirectory only checks if path exists
      expect(() =>
        validatePath('/path/to/dir', { mustBeDirectory: true, allowAbsolute: true })
      ).not.toThrow();
    });
  });

  describe('file validation', () => {
    it('should validate file type', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isFile: () => true } as any);

      expect(() =>
        validatePath('/path/to/file.txt', { mustBeFile: true, allowAbsolute: true })
      ).not.toThrow();
    });

    it('should reject directory when file expected', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isFile: () => false, isDirectory: () => true } as any);

      expect(() =>
        validatePath('/path/to/dir', { mustBeFile: true, allowAbsolute: true })
      ).toThrow('Path must be a file');
    });
  });

  describe('file size validation', () => {
    it('should reject files larger than maxSize', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 2048 } as any);

      expect(() =>
        validatePath('/path/to/file', { maxSize: 1024, allowAbsolute: true })
      ).toThrow('File too large');
    });

    it('should allow files within maxSize', () => {
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ size: 512 } as any);

      expect(() =>
        validatePath('/path/to/file', { maxSize: 1024, allowAbsolute: true })
      ).not.toThrow();
    });
  });

  describe('extension validation', () => {
    it('should validate file extensions', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() =>
        validatePath('/path/to/file.txt', {
          allowedExtensions: ['txt', 'md'],
          allowAbsolute: true,
        })
      ).not.toThrow();
    });

    it('should reject disallowed extensions', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() =>
        validatePath('/path/to/file.exe', {
          allowedExtensions: ['txt', 'md'],
          allowAbsolute: true,
        })
      ).toThrow('File extension must be one of');
    });

    it('should be case-insensitive for extensions', () => {
      mockExistsSync.mockReturnValue(false);

      expect(() =>
        validatePath('/path/to/file.TXT', {
          allowedExtensions: ['txt'],
          allowAbsolute: true,
        })
      ).not.toThrow();
    });
  });

  describe('path normalization', () => {
    it('should return normalized path', () => {
      mockExistsSync.mockReturnValue(false);

      // This path doesn't have .. after normalization
      const result = validatePath('./path/to/file', { allowAbsolute: true });
      expect(result).toBe('path/to/file');
    });
  });
});

describe('validateUrl', () => {
  describe('type validation', () => {
    it('should reject non-string URLs', () => {
      expect(() => validateUrl(null as any)).toThrow('URL must be a string');
      expect(() => validateUrl(undefined as any)).toThrow('URL must be a string');
      expect(() => validateUrl(123 as any)).toThrow('URL must be a string');
    });

    it('should reject empty URLs', () => {
      expect(() => validateUrl('')).toThrow('URL cannot be empty');
      expect(() => validateUrl('   ')).toThrow('URL cannot be empty');
    });
  });

  describe('format validation', () => {
    it('should reject invalid URL format', () => {
      expect(() => validateUrl('not-a-url')).toThrow('Invalid URL format');
      expect(() => validateUrl('://missing-protocol.com')).toThrow('Invalid URL format');
    });

    it('should accept valid HTTP URLs', () => {
      expect(() => validateUrl('http://example.com')).not.toThrow();
      expect(() => validateUrl('http://example.com/path?query=1')).not.toThrow();
    });

    it('should accept valid HTTPS URLs', () => {
      expect(() => validateUrl('https://example.com')).not.toThrow();
      expect(() => validateUrl('https://example.com:443/path')).not.toThrow();
    });
  });

  describe('protocol validation', () => {
    it('should reject ftp:// protocol by default', () => {
      // In jsdom, ftp:// URLs fail to parse, so we get 'Invalid URL format'
      // In Node.js, they parse but fail protocol check, so we get 'Protocol must be one of'
      // Either outcome is valid - the URL is rejected
      expect(() => validateUrl('ftp://example.com')).toThrow();
    });

    it('should reject file:// protocol by default', () => {
      // In jsdom, file:// URLs fail to parse, so we get 'Invalid URL format'
      // In Node.js, they parse but fail protocol check, so we get 'Protocol must be one of'
      // Either outcome is valid - the URL is rejected
      expect(() => validateUrl('file:///path/to/file')).toThrow();
    });

    it('should reject javascript: URLs', () => {
      // javascript: URLs may not parse as valid URLs
      expect(() => validateUrl('javascript:alert(1)')).toThrow('Invalid URL format');
    });

    it('should allow custom protocols when specified', () => {
      expect(() => validateUrl('svn://example.com/repo', ['svn:', 'svn+ssh:'])).not.toThrow();
      expect(() => validateUrl('svn+ssh://example.com/repo', ['svn:', 'svn+ssh:'])).not.toThrow();
    });
  });

  describe('SVN URL handling', () => {
    it('should accept svn:// URLs with custom protocols', () => {
      expect(() =>
        validateUrl('svn://svn.example.com/repo/trunk', ['svn:', 'http:', 'https:'])
      ).not.toThrow();
    });

    it('should accept svn+ssh:// URLs with custom protocols', () => {
      expect(() =>
        validateUrl('svn+ssh://user@svn.example.com/repo/trunk', ['svn+ssh:', 'http:', 'https:'])
      ).not.toThrow();
    });
  });
});

describe('validateString', () => {
  describe('type validation', () => {
    it('should reject non-string values', () => {
      expect(() => validateString(null as any, 'field')).toThrow('field must be a string');
      expect(() => validateString(123 as any, 'field')).toThrow('field must be a string');
    });
  });

  describe('length validation', () => {
    it('should enforce minimum length', () => {
      expect(() => validateString('ab', 'field', { minLength: 3 })).toThrow(
        'field must be at least 3 characters'
      );
      expect(() => validateString('abc', 'field', { minLength: 3 })).not.toThrow();
    });

    it('should enforce maximum length', () => {
      expect(() => validateString('abcd', 'field', { maxLength: 3 })).toThrow(
        'field must be at most 3 characters'
      );
      expect(() => validateString('abc', 'field', { maxLength: 3 })).not.toThrow();
    });
  });

  describe('pattern validation', () => {
    it('should enforce pattern matching', () => {
      const alphaPattern = /^[a-z]+$/;

      expect(() => validateString('abc123', 'field', { pattern: alphaPattern })).toThrow(
        'field has invalid format'
      );
      expect(() => validateString('abc', 'field', { pattern: alphaPattern })).not.toThrow();
    });
  });
});

describe('validateNumber', () => {
  describe('type validation', () => {
    it('should reject non-number values', () => {
      expect(() => validateNumber(null as any, 'field')).toThrow('field must be a number');
      expect(() => validateNumber('123' as any, 'field')).toThrow('field must be a number');
      expect(() => validateNumber(NaN, 'field')).toThrow('field must be a number');
    });
  });

  describe('integer validation', () => {
    it('should enforce integer constraint', () => {
      expect(() => validateNumber(1.5, 'field', { integer: true })).toThrow(
        'field must be an integer'
      );
      expect(() => validateNumber(1, 'field', { integer: true })).not.toThrow();
    });
  });

  describe('range validation', () => {
    it('should enforce minimum value', () => {
      expect(() => validateNumber(5, 'field', { min: 10 })).toThrow('field must be at least 10');
      expect(() => validateNumber(10, 'field', { min: 10 })).not.toThrow();
    });

    it('should enforce maximum value', () => {
      expect(() => validateNumber(15, 'field', { max: 10 })).toThrow('field must be at most 10');
      expect(() => validateNumber(10, 'field', { max: 10 })).not.toThrow();
    });
  });
});

describe('validateStringArray', () => {
  describe('type validation', () => {
    it('should reject non-array values', () => {
      expect(() => validateStringArray(null as any, 'field')).toThrow('field must be an array');
      expect(() => validateStringArray('string' as any, 'field')).toThrow('field must be an array');
      expect(() => validateStringArray({} as any, 'field')).toThrow('field must be an array');
    });
  });

  describe('item count validation', () => {
    it('should enforce minimum items', () => {
      expect(() => validateStringArray(['a'], 'field', { minItems: 2 })).toThrow(
        'field must have at least 2 items'
      );
      expect(() => validateStringArray(['a', 'b'], 'field', { minItems: 2 })).not.toThrow();
    });

    it('should enforce maximum items', () => {
      expect(() => validateStringArray(['a', 'b', 'c'], 'field', { maxItems: 2 })).toThrow(
        'field must have at most 2 items'
      );
      expect(() => validateStringArray(['a', 'b'], 'field', { maxItems: 2 })).not.toThrow();
    });
  });

  describe('item validation', () => {
    it('should reject non-string items', () => {
      expect(() => validateStringArray(['a', 123 as any, 'c'], 'field')).toThrow(
        'field[1] must be a string'
      );
    });

    it('should enforce item pattern', () => {
      const pattern = /^[a-z]+$/;
      expect(() => validateStringArray(['abc', '123'], 'field', { itemPattern: pattern })).toThrow(
        'field[1] has invalid format'
      );
    });
  });
});

describe('validateSvnPropertyName', () => {
  it('should accept valid SVN property names', () => {
    expect(() => validateSvnPropertyName('svn:ignore')).not.toThrow();
    expect(() => validateSvnPropertyName('svn:externals')).not.toThrow();
    expect(() => validateSvnPropertyName('my:property')).not.toThrow();
    expect(() => validateSvnPropertyName('custom-property')).not.toThrow();
    expect(() => validateSvnPropertyName('property_name')).not.toThrow();
  });

  it('should reject invalid property names', () => {
    expect(() => validateSvnPropertyName('')).toThrow('propertyName must be at least 1 characters');
    expect(() => validateSvnPropertyName('123property')).toThrow('propertyName has invalid format');
    expect(() => validateSvnPropertyName('property name')).toThrow('propertyName has invalid format');
  });

  it('should reject property names that are too long', () => {
    const longName = 'a'.repeat(257);
    expect(() => validateSvnPropertyName(longName)).toThrow(
      'propertyName must be at most 256 characters'
    );
  });
});

describe('validateCommitMessage', () => {
  it('should accept valid commit messages', () => {
    expect(() => validateCommitMessage('Fixed bug #123')).not.toThrow();
    expect(() => validateCommitMessage('Initial commit')).not.toThrow();
  });

  it('should remove null bytes from messages', () => {
    const message = 'Test\0message';
    const result = validateCommitMessage(message);
    expect(result).toBe('Testmessage');
  });

  it('should reject non-string messages', () => {
    expect(() => validateCommitMessage(null as any)).toThrow('commitMessage must be a string');
  });
});

describe('withValidation', () => {
  it('should return success result for valid handler', async () => {
    const handler = vi.fn().mockResolvedValue({ data: 'test' });
    const result = await withValidation(handler);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ data: 'test' });
  });

  it('should return error result for InputValidationError', async () => {
    const handler = vi.fn().mockRejectedValue(new InputValidationError('Invalid input', 'field'));
    const result = await withValidation(handler);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Validation error: Invalid input');
  });

  it('should return error result for other errors', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Network error'));
    const result = await withValidation(handler);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
  });

  it('should handle non-Error throws', async () => {
    const handler = vi.fn().mockRejectedValue('string error');
    const result = await withValidation(handler);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown error');
  });
});
