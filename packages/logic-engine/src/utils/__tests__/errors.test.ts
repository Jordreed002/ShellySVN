/**
 * Tests for Error Handling Utilities
 *
 * Tests error classes, parsing, and utility functions.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ShellySVNError,
  SvnExecutionError,
  WorkingCopyError,
  ConflictError,
  AuthenticationError,
  NetworkError,
  parseSvnError,
  isErrorResult,
  isSuccessResult,
  withErrorHandling,
  withRetry,
  type Result,
} from '../errors';

describe('Error Classes', () => {
  describe('ShellySVNError', () => {
    it('should create error with message and code', () => {
      const error = new ShellySVNError('Test error', 'TEST_CODE');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('ShellySVNError');
      expect(error.details).toBeUndefined();
    });

    it('should create error with details', () => {
      const details = { key: 'value', count: 42 };
      const error = new ShellySVNError('Test error', 'TEST_CODE', details);

      expect(error.details).toEqual(details);
    });
  });

  describe('SvnExecutionError', () => {
    it('should create error with exit code', () => {
      const error = new SvnExecutionError('Command failed', 1);

      expect(error.message).toBe('Command failed');
      expect(error.exitCode).toBe(1);
      expect(error.code).toBe('SVN_EXECUTION_ERROR');
      expect(error.name).toBe('SvnExecutionError');
    });

    it('should create error with stdout and stderr', () => {
      const error = new SvnExecutionError('Command failed', 1, 'stdout output', 'stderr output');

      expect(error.stdout).toBe('stdout output');
      expect(error.stderr).toBe('stderr output');
      expect(error.details).toEqual({
        exitCode: 1,
        stdout: 'stdout output',
        stderr: 'stderr output',
      });
    });
  });

  describe('WorkingCopyError', () => {
    it('should create error with path', () => {
      const error = new WorkingCopyError('Working copy locked', '/path/to/wc');

      expect(error.message).toBe('Working copy locked');
      expect(error.path).toBe('/path/to/wc');
      expect(error.code).toBe('WORKING_COPY_ERROR');
      expect(error.name).toBe('WorkingCopyError');
    });
  });

  describe('ConflictError', () => {
    it('should create error with conflicted paths', () => {
      const paths = ['/path/file1.txt', '/path/file2.txt'];
      const error = new ConflictError('Conflicts detected', paths);

      expect(error.message).toBe('Conflicts detected');
      expect(error.conflictedPaths).toEqual(paths);
      expect(error.code).toBe('CONFLICT_ERROR');
      expect(error.name).toBe('ConflictError');
    });
  });

  describe('AuthenticationError', () => {
    it('should create error without realm', () => {
      const error = new AuthenticationError('Authentication failed');

      expect(error.message).toBe('Authentication failed');
      expect(error.realm).toBeUndefined();
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.name).toBe('AuthenticationError');
    });

    it('should create error with realm', () => {
      const error = new AuthenticationError('Authentication failed', 'Test Realm');

      expect(error.realm).toBe('Test Realm');
    });
  });

  describe('NetworkError', () => {
    it('should create error without URL', () => {
      const error = new NetworkError('Connection timeout');

      expect(error.message).toBe('Connection timeout');
      expect(error.url).toBeUndefined();
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.name).toBe('NetworkError');
    });

    it('should create error with URL', () => {
      const error = new NetworkError('Connection refused', 'https://svn.example.com/repo');

      expect(error.url).toBe('https://svn.example.com/repo');
    });
  });
});

describe('parseSvnError', () => {
  describe('empty input', () => {
    it('should return generic error for empty string', () => {
      const error = parseSvnError('');

      expect(error.code).toBe('UNKNOWN_ERROR');
      expect(error.message).toBe('Unknown SVN error');
    });
  });

  describe('authentication errors', () => {
    it('should parse authentication failed error', () => {
      const stderr = 'svn: E170001: Authentication failed for realm: Test Realm';
      const error = parseSvnError(stderr);

      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.realm).toBe('Test Realm');
    });

    it('should parse authorization error', () => {
      const stderr = 'svn: E170001: Authorization failed';
      const error = parseSvnError(stderr);

      expect(error).toBeInstanceOf(AuthenticationError);
    });

    it('should parse access forbidden error', () => {
      const stderr = 'svn: E170001: Access forbidden';
      const error = parseSvnError(stderr);

      expect(error).toBeInstanceOf(AuthenticationError);
    });
  });

  describe('conflict errors', () => {
    it('should parse conflict error', () => {
      const stderr = 'svn: E155015: Conflict discovered in \'/path/to/file.txt\'';
      const error = parseSvnError(stderr);

      expect(error).toBeInstanceOf(ConflictError);
      expect(error.conflictedPaths).toContain('/path/to/file.txt');
    });

    it('should parse conflicted error', () => {
      const stderr = 'One or more files are in conflicted state';
      const error = parseSvnError(stderr);

      expect(error).toBeInstanceOf(ConflictError);
    });
  });

  describe('network errors', () => {
    it('should parse connection error', () => {
      const stderr = 'svn: E170013: Connection refused to https://svn.example.com/repo';
      const error = parseSvnError(stderr);

      expect(error).toBeInstanceOf(NetworkError);
      expect(error.url).toBe('https://svn.example.com/repo');
    });

    it('should parse network error', () => {
      const stderr = 'svn: E170013: Network error occurred';
      const error = parseSvnError(stderr);

      expect(error).toBeInstanceOf(NetworkError);
    });

    it('should parse timeout error', () => {
      const stderr = 'svn: E170013: Connection timeout';
      const error = parseSvnError(stderr);

      expect(error).toBeInstanceOf(NetworkError);
    });

    it('should parse host error', () => {
      const stderr = 'svn: E170013: Unknown host svn.example.com';
      const error = parseSvnError(stderr);

      expect(error).toBeInstanceOf(NetworkError);
    });
  });

  describe('working copy errors', () => {
    it('should parse working copy error', () => {
      const stderr = 'svn: E155037: Working copy locked, please execute cleanup';
      const error = parseSvnError(stderr);

      expect(error).toBeInstanceOf(WorkingCopyError);
    });

    it('should parse locked error', () => {
      const stderr = 'svn: E155004: Directory locked';
      const error = parseSvnError(stderr);

      expect(error).toBeInstanceOf(WorkingCopyError);
    });

    it('should parse cleanup error', () => {
      const stderr = 'svn: E155009: Failed to run cleanup';
      const error = parseSvnError(stderr);

      expect(error).toBeInstanceOf(WorkingCopyError);
    });

    it('should extract path from error message', () => {
      const stderr = 'svn: E155037: Working copy path: /path/to/wc';
      const error = parseSvnError(stderr);

      expect(error).toBeInstanceOf(WorkingCopyError);
      expect((error as WorkingCopyError).path).toBe('/path/to/wc');
    });
  });

  describe('generic errors', () => {
    it('should return generic error for unknown error type', () => {
      const stderr = 'svn: E123456: Some unknown error occurred';
      const error = parseSvnError(stderr);

      expect(error).toBeInstanceOf(ShellySVNError);
      expect(error.code).toBe('SVN_ERROR');
      expect(error.message).toBe('svn: E123456: Some unknown error occurred');
    });

    it('should return first line of error message', () => {
      const stderr = 'First line\nSecond line\nThird line';
      const error = parseSvnError(stderr);

      expect(error.message).toBe('First line');
    });
  });
});

describe('Result Type Guards', () => {
  describe('isErrorResult', () => {
    it('should return true for error result', () => {
      const result: Result<string> = {
        success: false,
        error: new ShellySVNError('Test error', 'TEST'),
      };

      expect(isErrorResult(result)).toBe(true);
    });

    it('should return false for success result', () => {
      const result: Result<string> = {
        success: true,
        data: 'test data',
      };

      expect(isErrorResult(result)).toBe(false);
    });
  });

  describe('isSuccessResult', () => {
    it('should return true for success result', () => {
      const result: Result<string> = {
        success: true,
        data: 'test data',
      };

      expect(isSuccessResult(result)).toBe(true);
    });

    it('should return true for success result without data', () => {
      const result: Result<void> = {
        success: true,
      };

      expect(isSuccessResult(result)).toBe(true);
    });

    it('should return false for error result', () => {
      const result: Result<string> = {
        success: false,
        error: new ShellySVNError('Test error', 'TEST'),
      };

      expect(isSuccessResult(result)).toBe(false);
    });
  });
});

describe('withErrorHandling', () => {
  it('should return success result for successful operation', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    const result = await withErrorHandling(operation);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('success');
    }
  });

  it('should return error result for ShellySVNError', async () => {
    const svnError = new ShellySVNError('Test error', 'TEST');
    const operation = vi.fn().mockRejectedValue(svnError);
    const result = await withErrorHandling(operation);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(svnError);
    }
  });

  it('should wrap generic error in ShellySVNError', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('Generic error'));
    const result = await withErrorHandling(operation, 'CUSTOM_CODE');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('Generic error');
      expect(result.error.code).toBe('CUSTOM_CODE');
    }
  });

  it('should wrap non-Error in ShellySVNError', async () => {
    const operation = vi.fn().mockRejectedValue('string error');
    const result = await withErrorHandling(operation);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe('Unknown error');
      expect(result.error.details?.originalError).toBe('string error');
    }
  });
});

describe('withRetry', () => {
  it('should return result on first success', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    const result = await withRetry(operation);

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('First failure'))
      .mockResolvedValueOnce('success');

    const result = await withRetry(operation, { initialDelay: 10 });

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('should throw after max retries', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('Always fails'));

    await expect(
      withRetry(operation, {
        maxRetries: 2,
        initialDelay: 10,
      })
    ).rejects.toThrow('Always fails');
    expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it('should use exponential backoff', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('First failure'))
      .mockRejectedValueOnce(new Error('Second failure'))
      .mockResolvedValueOnce('success');

    const result = await withRetry(operation, {
      maxRetries: 3,
      initialDelay: 10,
      backoffFactor: 2,
    });

    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('should respect maxDelay', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('Always fails'));

    await expect(
      withRetry(operation, {
        maxRetries: 3,
        initialDelay: 10,
        maxDelay: 15,
        backoffFactor: 2,
      })
    ).rejects.toThrow('Always fails');
    expect(operation).toHaveBeenCalledTimes(4); // Initial + 3 retries
  });

  it('should throw last error after retries exhausted', async () => {
    const error1 = new Error('First error');
    const error2 = new Error('Second error');
    const error3 = new Error('Third error');

    const operation = vi
      .fn()
      .mockRejectedValueOnce(error1)
      .mockRejectedValueOnce(error2)
      .mockRejectedValueOnce(error3);

    await expect(withRetry(operation, { maxRetries: 2, initialDelay: 10 })).rejects.toThrow(
      'Third error'
    );
  });
});
