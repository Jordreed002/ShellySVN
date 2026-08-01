import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRepoExternals } from '../useRepoExternals';

/**
 * J3 / J12 — Repository browser externals.
 *
 * `svn list` shows an external as an ordinary directory, but its content comes
 * from elsewhere and may be pinned. `useRepoExternals` is the one flag the
 * browser may show outside a working copy, and it must never block the listing:
 * any failure resolves to "no externals known". These tests pin that contract.
 */
const URL = 'https://svn.example.com/repo/trunk';
const proplist = vi.fn();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { svn: { proplist } },
  });
});

function renderExternals(dirPath: string, enabled = true) {
  return renderHook(
    () => useRepoExternals(URL, dirPath, { kind: 'head' }, { enabled }),
    { wrapper: createWrapper() }
  );
}

describe('useRepoExternals', () => {
  it('surfaces external paths and the raw definition when svn:externals is set', async () => {
    proplist.mockResolvedValue({
      properties: [{ name: 'svn:externals', value: 'vendor/lib https://svn.example.com/repo/lib' }],
    });

    const { result } = renderExternals('deps');

    await waitFor(() => expect(result.current.definition).not.toBeNull());
    expect(result.current.definition).toBe('vendor/lib https://svn.example.com/repo/lib');
    expect(result.current.externalPaths.get('deps/vendor/lib')).toEqual({ pegged: false });
  });

  it('flags an external pinned by a revision as pegged', async () => {
    proplist.mockResolvedValue({
      properties: [{ name: 'svn:externals', value: '-r5 vendor/lib https://svn.example.com/repo/lib' }],
    });

    const { result } = renderExternals('deps');

    await waitFor(() => expect(result.current.externalPaths.size).toBe(1));
    expect(result.current.externalPaths.get('deps/vendor/lib')).toEqual({ pegged: true });
  });

  it('returns no externals when proplist reports an error', async () => {
    proplist.mockResolvedValue({ error: 'svn: E160013' });

    const { result } = renderExternals('deps');

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.definition).toBeNull();
    expect(result.current.externalPaths.size).toBe(0);
  });

  it('returns no externals when the property is absent', async () => {
    proplist.mockResolvedValue({
      properties: [{ name: 'svn:eol-style', value: 'native' }],
    });

    const { result } = renderExternals('deps');

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.definition).toBeNull();
    expect(result.current.externalPaths.size).toBe(0);
  });

  it('resolves a rejected proplist to no externals rather than throwing', async () => {
    proplist.mockRejectedValue(new Error('network down'));

    const { result } = renderExternals('deps');

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.externalPaths.size).toBe(0);
  });

  it('does not fetch when disabled', () => {
    proplist.mockResolvedValue({ properties: [] });

    const { result } = renderExternals('deps', false);

    expect(proplist).not.toHaveBeenCalled();
    expect(result.current.externalPaths.size).toBe(0);
  });
});
