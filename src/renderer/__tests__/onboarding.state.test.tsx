import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFirstLaunch, useOnboarding } from '../src/components/tutorial/useOnboarding';
import { DEFAULT_ONBOARDING_STATE } from '../src/components/tutorial/types';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function mockStore(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  const get = vi.fn(async (key: string) => values.get(key));
  const set = vi.fn(async (key: string, value: unknown) => {
    values.set(key, value);
  });

  window.api = {
    store: { get, set },
  } as unknown as Window['api'];

  return { get, set, values };
}

describe('onboarding state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects first launch and records that the app has launched', async () => {
    const { set } = mockStore();

    const { result } = renderHook(() => useFirstLaunch());

    await waitFor(() => expect(result.current).toBe(true));
    expect(set).toHaveBeenCalledWith('hasLaunchedBefore', true);
  });

  it('does not treat later launches as first run', async () => {
    const { set } = mockStore({ hasLaunchedBefore: true });

    const { result } = renderHook(() => useFirstLaunch());

    await waitFor(() => expect(result.current).toBe(false));
    expect(set).not.toHaveBeenCalled();
  });

  it('loads default tutorial state for first-run onboarding', async () => {
    mockStore();

    const { result } = renderHook(() => useOnboarding(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.onboardingState).toEqual(DEFAULT_ONBOARDING_STATE);
  });

  it('persists skipped and resumed tutorial states', async () => {
    const { set } = mockStore();

    const { result } = renderHook(() => useOnboarding(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.skipTutorial();
    });
    expect(set).toHaveBeenLastCalledWith(
      'onboarding',
      expect.objectContaining({
        hasSkippedTutorial: true,
        skippedAt: expect.any(Number),
      })
    );

    await act(async () => {
      await result.current.resumeTutorial();
    });
    expect(set).toHaveBeenLastCalledWith(
      'onboarding',
      expect.objectContaining({
        hasSkippedTutorial: false,
        skippedAt: undefined,
      })
    );
  });

  it('resumes at the stored step and preserves completed step history', async () => {
    const { set } = mockStore({
      onboarding: {
        currentStep: 3,
        completedSteps: ['welcome', 'working-copy'],
      },
    });

    const { result } = renderHook(() => useOnboarding(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.onboardingState).toEqual(
      expect.objectContaining({
        currentStep: 3,
        completedSteps: ['welcome', 'working-copy'],
      })
    );

    await act(async () => {
      await result.current.completeStep('status-view');
      await result.current.setCurrentStep(4);
    });

    expect(set).toHaveBeenLastCalledWith(
      'onboarding',
      expect.objectContaining({
        currentStep: 4,
        completedSteps: ['welcome', 'working-copy', 'status-view'],
      })
    );
  });

  it('persists completed tutorial state', async () => {
    const { set } = mockStore();

    const { result } = renderHook(() => useOnboarding(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.completeTutorial();
    });

    expect(set).toHaveBeenLastCalledWith(
      'onboarding',
      expect.objectContaining({
        hasCompletedTutorial: true,
        completedAt: expect.any(Number),
      })
    );
  });
});
