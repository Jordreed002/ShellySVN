/**
 * Types for the Onboarding Tutorial System
 */

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  component: React.ComponentType<TutorialStepProps>;
  keyboardShortcut?: {
    keys: string[];
    description: string;
  };
}

export interface TutorialStepProps {
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
  isFirstStep: boolean;
  isLastStep: boolean;
  currentStep: number;
  totalSteps: number;
}

export interface OnboardingState {
  hasCompletedTutorial: boolean;
  hasSkippedTutorial: boolean;
  currentStep: number;
  completedSteps: string[];
  skippedAt?: number;
  completedAt?: number;
}

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  hasCompletedTutorial: false,
  hasSkippedTutorial: false,
  currentStep: 0,
  completedSteps: [],
};
