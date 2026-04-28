/**
 * Tests for standardized error types and utilities
 */

import { describe, it, expect } from 'vitest';
import {
  ErrorCode,
  success,
  failure,
  ERROR_MESSAGES,
  parseSvnError,
  IpcError,
  type IpcResult,
  type AppError,
} from '../errors';

describe('ErrorCode', () => {
  it('should have general error codes', () => {
    expect(ErrorCode.UNKNOWN).toBe('UNKNOWN');
    expect(ErrorCode.INVALID_INPUT).toBe('INVALID_INPUT');
    expect(ErrorCode.PERMISSION_DENIED).toBe('PERMISSION_DENIED');
    expect(ErrorCode.TIMEOUT).toBe('TIMEOUT');
    expect(ErrorCode.NOT_FOUND).toBe('NOT_FOUND');
  });

  it('should have SVN error codes', () => {
    expect(ErrorCode.SVN_NOT_FOUND).toBe('SVN_NOT_FOUND');
    expect(ErrorCode.SVN_NOT_WORKING_COPY).toBe('SVN_NOT_WORKING_COPY');
    expect(ErrorCode.SVN_CONFLICT).toBe('SVN_CONFLICT');
    expect(ErrorCode.SVN_AUTH_FAILED).toBe('SVN_AUTH_FAILED');
    expect(ErrorCode.SVN_NETWORK_ERROR).toBe('SVN_NETWORK_ERROR');
    expect(ErrorCode.SVN_LOCKED).toBe('SVN_LOCKED');
    expect(ErrorCode.SVN_OUT_OF_DATE).toBe('SVN_OUT_OF_DATE');
    expect(ErrorCode.SVN_MERGE_CONFLICT).toBe('SVN_MERGE_CONFLICT');
    expect(ErrorCode.SVN_PROPERTY_ERROR).toBe('SVN_PROPERTY_ERROR');
  });

  it('should have file system error codes', () => {
    expect(ErrorCode.FILE_NOT_FOUND).toBe('FILE_NOT_FOUND');
    expect(ErrorCode.FILE_TOO_LARGE).toBe('FILE_TOO_LARGE');
    expect(ErrorCode.FILE_READ_ERROR).toBe('FILE_READ_ERROR');
    expect(ErrorCode.FILE_WRITE_ERROR).toBe('FILE_WRITE_ERROR');
    expect(ErrorCode.PATH_NOT_FOUND).toBe('PATH_NOT_FOUND');
    expect(ErrorCode.PATH_TRAVERSAL).toBe('PATH_TRAVERSAL');
  });

  it('should have external tool error codes', () => {
    expect(ErrorCode.TOOL_NOT_FOUND).toBe('TOOL_NOT_FOUND');
    expect(ErrorCode.TOOL_LAUNCH_FAILED).toBe('TOOL_LAUNCH_FAILED');
  });

  it('should have auth error codes', () => {
    expect(ErrorCode.AUTH_ENCRYPTION_UNAVAILABLE).toBe('AUTH_ENCRYPTION_UNAVAILABLE');
    expect(ErrorCode.AUTH_STORAGE_ERROR).toBe('AUTH_STORAGE_ERROR');
  });
});

describe('success', () => {
  it('should create a success result with data', () => {
    const result = success({ name: 'test' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ name: 'test' });
    expect(result.error).toBeUndefined();
  });

  it('should create a success result with primitive data', () => {
    const result = success('hello');

    expect(result.success).toBe(true);
    expect(result.data).toBe('hello');
  });

  it('should create a success result with null data', () => {
    const result = success(null);

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it('should create a success result with array data', () => {
    const result = success([1, 2, 3]);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([1, 2, 3]);
  });
});

describe('failure', () => {
  it('should create a failure result with code and message', () => {
    const result = failure(ErrorCode.NOT_FOUND, 'Resource not found');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.NOT_FOUND);
    expect(result.error?.message).toBe('Resource not found');
    expect(result.error?.details).toBeUndefined();
  });

  it('should create a failure result with details', () => {
    const result = failure(ErrorCode.INVALID_INPUT, 'Invalid path', {
      path: '/invalid/path',
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.INVALID_INPUT);
    expect(result.error?.details).toEqual({ path: '/invalid/path' });
  });

  it('should create a failure result with complex details', () => {
    const result = failure(ErrorCode.SVN_CONFLICT, 'Merge conflict', {
      files: ['file1.txt', 'file2.txt'],
      revision: 123,
      resolved: false,
    });

    expect(result.success).toBe(false);
    expect(result.error?.details?.files).toEqual(['file1.txt', 'file2.txt']);
    expect(result.error?.details?.revision).toBe(123);
  });
});

describe('ERROR_MESSAGES', () => {
  it('should have messages for all error codes', () => {
    const codes = Object.values(ErrorCode);

    for (const code of codes) {
      expect(ERROR_MESSAGES[code]).toBeDefined();
      expect(typeof ERROR_MESSAGES[code]).toBe('string');
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
  });

  it('should have descriptive SVN messages', () => {
    expect(ERROR_MESSAGES[ErrorCode.SVN_NOT_FOUND]).toContain('SVN');
    expect(ERROR_MESSAGES[ErrorCode.SVN_AUTH_FAILED]).toContain('Authentication');
    expect(ERROR_MESSAGES[ErrorCode.SVN_NETWORK_ERROR]).toContain('Network');
  });

  it('should have descriptive file system messages', () => {
    expect(ERROR_MESSAGES[ErrorCode.FILE_NOT_FOUND]).toContain('File');
    expect(ERROR_MESSAGES[ErrorCode.FILE_TOO_LARGE]).toContain('large');
    expect(ERROR_MESSAGES[ErrorCode.PATH_TRAVERSAL]).toContain('traversal');
  });
});

describe('parseSvnError', () => {
  it('should parse "not a working copy" error', () => {
    const error = parseSvnError('/path is not a working copy', 'update');

    expect(error.code).toBe(ErrorCode.SVN_NOT_WORKING_COPY);
    expect(error.message).toBe(ERROR_MESSAGES[ErrorCode.SVN_NOT_WORKING_COPY]);
  });

  it('should parse authentication failed error', () => {
    const error = parseSvnError('Authentication failed for user', 'commit');

    expect(error.code).toBe(ErrorCode.SVN_AUTH_FAILED);
    expect(error.message).toBe(ERROR_MESSAGES[ErrorCode.SVN_AUTH_FAILED]);
  });

  it('should parse authorization failed error', () => {
    const error = parseSvnError('Authorization failed', 'checkout');

    expect(error.code).toBe(ErrorCode.SVN_AUTH_FAILED);
  });

  it('should parse conflict error', () => {
    const error = parseSvnError('A conflict occurred during merge', 'merge');

    expect(error.code).toBe(ErrorCode.SVN_CONFLICT);
    expect(error.details?.operation).toBe('merge');
  });

  it('should parse network error', () => {
    const error = parseSvnError('Network connection timed out', 'update');

    expect(error.code).toBe(ErrorCode.SVN_NETWORK_ERROR);
  });

  it('should parse connection timed out error', () => {
    const error = parseSvnError('Connection timed out', 'status');

    expect(error.code).toBe(ErrorCode.SVN_NETWORK_ERROR);
  });

  it('should parse locked error', () => {
    const error = parseSvnError('File is locked by another user', 'commit');

    expect(error.code).toBe(ErrorCode.SVN_LOCKED);
  });

  it('should parse out of date error', () => {
    const error = parseSvnError('Working copy is out of date', 'commit');

    expect(error.code).toBe(ErrorCode.SVN_OUT_OF_DATE);
  });

  it('should return unknown error for unrecognized patterns', () => {
    const error = parseSvnError('Some random error message', 'status');

    expect(error.code).toBe(ErrorCode.UNKNOWN);
    expect(error.message).toContain('status failed');
    expect(error.details?.operation).toBe('status');
    expect(error.details?.stderr).toBe('Some random error message');
  });

  it('should handle empty stderr', () => {
    const error = parseSvnError('', 'update');

    expect(error.code).toBe(ErrorCode.UNKNOWN);
    expect(error.details?.stderr).toBe('');
  });

  it('should be case-insensitive', () => {
    const error = parseSvnError('FILE IS LOCKED', 'commit');

    expect(error.code).toBe(ErrorCode.SVN_LOCKED);
  });
});

describe('IpcError', () => {
  it('should create an error with code and message', () => {
    const error = new IpcError(ErrorCode.NOT_FOUND, 'Resource not found');

    expect(error.code).toBe(ErrorCode.NOT_FOUND);
    expect(error.message).toBe('Resource not found');
    expect(error.name).toBe('IpcError');
  });

  it('should create an error with details', () => {
    const error = new IpcError(ErrorCode.INVALID_INPUT, 'Invalid input', {
      field: 'path',
    });

    expect(error.details).toEqual({ field: 'path' });
  });

  it('should serialize to JSON correctly', () => {
    const error = new IpcError(ErrorCode.SVN_CONFLICT, 'Conflict detected', {
      file: 'test.txt',
    });

    const json = error.toJSON();

    expect(json.code).toBe(ErrorCode.SVN_CONFLICT);
    expect(json.message).toBe('Conflict detected');
    expect(json.details).toEqual({ file: 'test.txt' });
  });

  it('should serialize to JSON without details', () => {
    const error = new IpcError(ErrorCode.UNKNOWN, 'Unknown error');

    const json = error.toJSON();

    expect(json.code).toBe(ErrorCode.UNKNOWN);
    expect(json.message).toBe('Unknown error');
    expect(json.details).toBeUndefined();
  });

  it('should be an instance of Error', () => {
    const error = new IpcError(ErrorCode.NOT_FOUND, 'Not found');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(IpcError);
  });

  it('should have correct prototype chain', () => {
    const error = new IpcError(ErrorCode.TIMEOUT, 'Timed out');

    expect(Object.getPrototypeOf(error)).toBe(IpcError.prototype);
  });
});

describe('IpcResult type', () => {
  it('should be usable as a return type with success', () => {
    function getData(): IpcResult<string> {
      return success('data');
    }

    const result = getData();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('data');
    }
  });

  it('should be usable as a return type with failure', () => {
    function getData(): IpcResult<string> {
      return failure(ErrorCode.NOT_FOUND, 'Not found');
    }

    const result = getData();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error?.code).toBe(ErrorCode.NOT_FOUND);
    }
  });
});

describe('AppError type', () => {
  it('should support all error properties', () => {
    const error: AppError = {
      code: ErrorCode.SVN_CONFLICT,
      message: 'Conflict',
      details: { file: 'test.txt' },
      cause: 'user edit',
    };

    expect(error.code).toBe(ErrorCode.SVN_CONFLICT);
    expect(error.message).toBe('Conflict');
    expect(error.details).toEqual({ file: 'test.txt' });
    expect(error.cause).toBe('user edit');
  });

  it('should work with minimal properties', () => {
    const error: AppError = {
      code: ErrorCode.UNKNOWN,
      message: 'Unknown',
    };

    expect(error.code).toBe(ErrorCode.UNKNOWN);
    expect(error.message).toBe('Unknown');
    expect(error.details).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });
});
