import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { OnboardingState } from './types';
import { DEFAULT_ONBOARDING_STATE } from './types';

const ONBOARDING_STORAGE_KEY = 'onboarding';

/**
 * Hook to manage onboarding tutorial state with persistence
 */
export function useOnboarding() {
  const queryClient = useQueryClient();

  // Query to fetch onboarding state
  const { data: onboardingState, isLoading } = useQuery({
    queryKey: ['onboarding'],
    queryFn: async (): Promise<OnboardingState> => {
      const stored = await window.api.store.get<OnboardingState>(ONBOARDING_STORAGE_KEY);
      return stored ? { ...DEFAULT_ONBOARDING_STATE, ...stored } : DEFAULT_ONBOARDING_STATE;
    },
    staleTime: Infinity,
  });

  // Mutation to update onboarding state
  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<OnboardingState>) => {
      const current =
        queryClient.getQueryData<OnboardingState>(['onboarding']) || DEFAULT_ONBOARDING_STATE;
      const updated = { ...current, ...updates };
      await window.api.store.set(ONBOARDING_STORAGE_KEY, updated);
      return updated;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['onboarding'], updated);
    },
  });

  // Mark tutorial as completed
  const completeTutorial = useCallback(async () => {
    await updateMutation.mutateAsync({
      hasCompletedTutorial: true,
      completedAt: Date.now(),
    });
  }, [updateMutation]);

  // Skip the tutorial
  const skipTutorial = useCallback(async () => {
    await updateMutation.mutateAsync({
      hasSkippedTutorial: true,
      skippedAt: Date.now(),
    });
  }, [updateMutation]);

  // Update current step
  const setCurrentStep = useCallback(
    async (step: number) => {
      await updateMutation.mutateAsync({ currentStep: step });
    },
    [updateMutation]
  );

  // Mark a step as completed
  const completeStep = useCallback(
    async (stepId: string) => {
      const current =
        queryClient.getQueryData<OnboardingState>(['onboarding']) || DEFAULT_ONBOARDING_STATE;
      if (current.completedSteps.includes(stepId)) return;
      await updateMutation.mutateAsync({
        completedSteps: [...current.completedSteps, stepId],
      });
    },
    [updateMutation, queryClient]
  );

  // Reset tutorial (for testing or re-doing)
  const resetTutorial = useCallback(async () => {
    await updateMutation.mutateAsync(DEFAULT_ONBOARDING_STATE);
  }, [updateMutation]);

  // Resume from skipped state
  const resumeTutorial = useCallback(async () => {
    await updateMutation.mutateAsync({
      hasSkippedTutorial: false,
      skippedAt: undefined,
    });
  }, [updateMutation]);

  return {
    onboardingState: onboardingState || DEFAULT_ONBOARDING_STATE,
    isLoading,
    completeTutorial,
    skipTutorial,
    setCurrentStep,
    completeStep,
    resetTutorial,
    resumeTutorial,
    isUpdating: updateMutation.isPending,
  };
}

/**
 * Hook to detect if this is the first launch
 */
export function useFirstLaunch() {
  const [isFirstLaunch, setIsFirstLaunch] = useState<boolean | null>(null);

  useEffect(() => {
    const checkFirstLaunch = async () => {
      const hasLaunched = await window.api.store.get<boolean>('hasLaunchedBefore');
      if (!hasLaunched) {
        setIsFirstLaunch(true);
        await window.api.store.set('hasLaunchedBefore', true);
      } else {
        setIsFirstLaunch(false);
      }
    };
    checkFirstLaunch();
  }, []);

  return isFirstLaunch;
}
