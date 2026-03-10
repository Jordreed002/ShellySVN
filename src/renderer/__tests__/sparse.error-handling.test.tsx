import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';

afterEach(() => {
  cleanup();
});

import {
  classifySparseError,
  requiresAuthentication,
  isRetryable,
  isNetworkError,
  getUserFriendlyMessage,
  credentialCache,
  withRetry,
  SparseErrorType,
} from '../src/utils/sparseErrorHandling';

import {
  SparseCheckoutErrorBoundary,
  SparseErrorStateWrapper,
} from '../src/components/ui/SparseCheckoutErrorBoundary';

describe('Sparse Error Handling Utilities', () => {
  describe('classifySparseError', () => {
    it('classifies network errors correctly', () => {
      const error = new Error('Network connection failed');
      const result = classifySparseError(error);

      expect(result.type).toBe(SparseErrorType.NETWORK_FAILURE);
      expect(result.title).toBe('Network Error');
      expect(result.retryable).toBe(true);
      expect(result.requiresAuth).toBe(false);
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('classifies connection timeout errors', () => {
      const error = new Error('Connection timed out');
      const result = classifySparseError(error);

      expect(result.type).toBe(SparseErrorType.NETWORK_FAILURE);
    });

    it('classifies authentication required errors', () => {
      const error = new Error('Authentication required');
      const result = classifySparseError(error);

      expect(result.type).toBe(SparseErrorType.AUTH_REQUIRED);
      expect(result.requiresAuth).toBe(true);
      expect(result.retryable).toBe(true);
    });

    it('classifies authentication failed errors', () => {
      const error = new Error('Authentication failed');
      const result = classifySparseError(error);

      expect(result.type).toBe(SparseErrorType.AUTH_FAILED);
      expect(result.requiresAuth).toBe(true);
    });

    it('classifies permission denied errors', () => {
      const error = new Error('Permission denied');
      const result = classifySparseError(error);

      expect(result.type).toBe(SparseErrorType.PERMISSION_DENIED);
      expect(result.retryable).toBe(false);
    });

    it('classifies repository not found errors', () => {
      const error = new Error('Repository not found at URL');
      const result = classifySparseError(error);

      expect(result.type).toBe(SparseErrorType.REPO_NOT_FOUND);
      expect(result.retryable).toBe(false);
    });

    it('classifies SSL certificate errors', () => {
      const error = new Error('SSL certificate verification failed');
      const result = classifySparseError(error);

      expect(result.type).toBe(SparseErrorType.SSL_ERROR);
      expect(result.retryable).toBe(true);
    });

    it('classifies timeout errors', () => {
      const error = new Error('Operation timed out');
      const result = classifySparseError(error);

      expect(result.type).toBe(SparseErrorType.TIMEOUT);
      expect(result.retryable).toBe(true);
    });

    it('classifies conflict errors', () => {
      const error = new Error('Conflict detected in file');
      const result = classifySparseError(error);

      expect(result.type).toBe(SparseErrorType.CONFLICT);
    });

    it('classifies out of date errors', () => {
      const error = new Error('Working copy is out of date');
      const result = classifySparseError(error);

      expect(result.type).toBe(SparseErrorType.OUT_OF_DATE);
    });

    it('classifies locked resource errors', () => {
      const error = new Error('File is locked by another user');
      const result = classifySparseError(error);

      expect(result.type).toBe(SparseErrorType.LOCKED);
    });

    it('classifies working copy errors', () => {
      const error = new Error('Working copy corrupted');
      const result = classifySparseError(error);

      expect(result.type).toBe(SparseErrorType.WORKING_COPY_ERROR);
    });

    it('classifies unknown errors', () => {
      const error = new Error('Some random error');
      const result = classifySparseError(error);

      expect(result.type).toBe(SparseErrorType.UNKNOWN);
      expect(result.retryable).toBe(true);
    });

    it('handles string errors', () => {
      const result = classifySparseError('Network error occurred');

      expect(result.type).toBe(SparseErrorType.NETWORK_FAILURE);
    });
  });

  describe('requiresAuthentication', () => {
    it('returns true for auth required errors', () => {
      expect(requiresAuthentication(new Error('Authentication required'))).toBe(true);
      expect(requiresAuthentication(new Error('Authentication failed'))).toBe(true);
    });

    it('returns false for non-auth errors', () => {
      expect(requiresAuthentication(new Error('Network error'))).toBe(false);
      expect(requiresAuthentication(new Error('File not found'))).toBe(false);
    });
  });

  describe('isRetryable', () => {
    it('returns true for retryable errors', () => {
      expect(isRetryable(new Error('Network error'))).toBe(true);
      expect(isRetryable(new Error('Timeout'))).toBe(true);
      expect(isRetryable(new Error('Conflict'))).toBe(true);
    });

    it('returns false for non-retryable errors', () => {
      expect(isRetryable(new Error('Permission denied'))).toBe(false);
      expect(isRetryable(new Error('Repository not found'))).toBe(false);
    });
  });

  describe('isNetworkError', () => {
    it('returns true for network errors', () => {
      expect(isNetworkError(new Error('Network connection failed'))).toBe(true);
      expect(isNetworkError(new Error('Operation timed out'))).toBe(true);
    });

    it('returns false for non-network errors', () => {
      expect(isNetworkError(new Error('Authentication failed'))).toBe(false);
      expect(isNetworkError(new Error('File not found'))).toBe(false);
    });
  });

  describe('getUserFriendlyMessage', () => {
    it('returns user-friendly message', () => {
      const message = getUserFriendlyMessage(new Error('Network connection failed'));
      expect(message).toBe('Unable to connect to the repository server.');
    });
  });

  describe('credentialCache', () => {
    beforeEach(() => {
      credentialCache.clear();
    });

    it('stores and retrieves credentials', () => {
      const url = 'https://example.com/svn/repo';
      const creds = { username: 'testuser', password: 'testpass' };

      credentialCache.set(url, creds);
      expect(credentialCache.get(url)).toEqual(creds);
    });

    it('clears credentials for specific URL', () => {
      const url = 'https://example.com/svn/repo';
      const creds = { username: 'testuser', password: 'testpass' };

      credentialCache.set(url, creds);
      credentialCache.clear(url);
      expect(credentialCache.get(url)).toBeUndefined();
    });

    it('clears all credentials', () => {
      credentialCache.set('https://example.com/repo1', { username: 'user1', password: 'pass1' });
      credentialCache.set('https://example.com/repo2', { username: 'user2', password: 'pass2' });

      credentialCache.clear();
      expect(credentialCache.get('https://example.com/repo1')).toBeUndefined();
      expect(credentialCache.get('https://example.com/repo2')).toBeUndefined();
    });

    it('checks if credentials exist', () => {
      const url = 'https://example.com/svn/repo';

      expect(credentialCache.has(url)).toBe(false);
      credentialCache.set(url, { username: 'user', password: 'pass' });
      expect(credentialCache.has(url)).toBe(true);
    });

    it('normalizes URLs by host', () => {
      const creds = { username: 'testuser', password: 'testpass' };

      credentialCache.set('https://example.com/svn/repo1', creds);
      expect(credentialCache.get('https://example.com/svn/repo2')).toEqual(creds);
    });
  });

  describe('withRetry', () => {
    it('retries on retryable errors', async () => {
      let attempts = 0;
      const fn = vi.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Network error');
        }
        return 'success';
      });

      const result = await withRetry(fn, { delayMs: 10, backoffMultiplier: 1 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry on non-retryable errors', async () => {
      const fn = vi.fn(async () => {
        throw new Error('Permission denied');
      });

      await expect(withRetry(fn, { delayMs: 10 })).rejects.toThrow('Permission denied');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not retry on auth errors', async () => {
      const fn = vi.fn(async () => {
        throw new Error('Authentication required');
      });

      await expect(withRetry(fn, { delayMs: 10 })).rejects.toThrow('Authentication required');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws after max attempts', async () => {
      const fn = vi.fn(async () => {
        throw new Error('Network error');
      });

      await expect(withRetry(fn, { maxAttempts: 2, delayMs: 10 })).rejects.toThrow('Network error');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('calls onRetry callback', async () => {
      const onRetry = vi.fn();
      let attempts = 0;

      const fn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Network error');
        }
        return 'success';
      };

      await withRetry(fn, { delayMs: 10, onRetry });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
    });
  });
});

describe('SparseCheckoutErrorBoundary', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    consoleError.mockClear();
  });

  it('renders children when no error', () => {
    render(
      <SparseCheckoutErrorBoundary>
        <div>Child content</div>
      </SparseCheckoutErrorBoundary>
    );

    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('renders error UI on error', () => {
    const ThrowError = () => {
      throw new Error('Network connection failed');
    };

    render(
      <SparseCheckoutErrorBoundary>
        <ThrowError />
      </SparseCheckoutErrorBoundary>
    );

    expect(screen.getByText('Network Error')).toBeInTheDocument();
    expect(screen.getByText('Unable to connect to the repository server.')).toBeInTheDocument();
  });

  it('shows retry button for retryable errors', () => {
    const ThrowError = () => {
      throw new Error('Network connection failed');
    };

    render(
      <SparseCheckoutErrorBoundary onRetry={vi.fn()}>
        <ThrowError />
      </SparseCheckoutErrorBoundary>
    );

    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('calls onRetry when retry is clicked', () => {
    const onRetry = vi.fn();
    const ThrowError = () => {
      throw new Error('Network connection failed');
    };

    render(
      <SparseCheckoutErrorBoundary onRetry={onRetry}>
        <ThrowError />
      </SparseCheckoutErrorBoundary>
    );

    fireEvent.click(screen.getByText('Try Again'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows suggestions', () => {
    const ThrowError = () => {
      throw new Error('Authentication required');
    };

    render(
      <SparseCheckoutErrorBoundary>
        <ThrowError />
      </SparseCheckoutErrorBoundary>
    );

    expect(screen.getByText('Suggestions:')).toBeInTheDocument();
    expect(screen.getByText(/Enter your username and password/)).toBeInTheDocument();
  });

  it('calls onError callback', () => {
    const onError = vi.fn();
    const error = new Error('Network connection failed');
    const ThrowError = () => {
      throw error;
    };

    render(
      <SparseCheckoutErrorBoundary onError={onError}>
        <ThrowError />
      </SparseCheckoutErrorBoundary>
    );

    expect(onError).toHaveBeenCalledWith(error, expect.any(Object));
  });
});

describe('SparseErrorStateWrapper', () => {
  it('renders children when no error', () => {
    render(
      <SparseErrorStateWrapper error={null}>
        <div>Child content</div>
      </SparseErrorStateWrapper>
    );

    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('renders error state when error exists', () => {
    render(
      <SparseErrorStateWrapper error={new Error('Network connection failed')}>
        <div>Child content</div>
      </SparseErrorStateWrapper>
    );

    expect(screen.getByText('Network Error')).toBeInTheDocument();
    expect(screen.queryByText('Child content')).not.toBeInTheDocument();
  });

  it('shows authenticate button for auth errors', () => {
    const onAuthRequired = vi.fn();

    render(
      <SparseErrorStateWrapper
        error={new Error('Authentication required')}
        onAuthRequired={onAuthRequired}
      >
        <div>Child content</div>
      </SparseErrorStateWrapper>
    );

    const button = screen.getByText('Authenticate');
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(onAuthRequired).toHaveBeenCalled();
  });

  it('shows try again button for retryable errors', () => {
    const onRetry = vi.fn();

    render(
      <SparseErrorStateWrapper error={new Error('Network connection failed')} onRetry={onRetry}>
        <div>Child content</div>
      </SparseErrorStateWrapper>
    );

    const button = screen.getByText('Try Again');
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalled();
  });
});
