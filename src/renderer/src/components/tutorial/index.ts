/**
 * Onboarding Tutorial Module
 *
 * Provides an interactive 8-step tutorial for new ShellySVN users.
 */

export { OnboardingTutorial, useOnboarding, useFirstLaunch } from './OnboardingTutorial'
export { TUTORIAL_STEPS, getTutorialStep, getTotalSteps } from './tutorialSteps'
export type { OnboardingState, TutorialStep, TutorialStepProps } from './types'
export { DEFAULT_ONBOARDING_STATE } from './types'
