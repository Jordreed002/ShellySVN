import { useState, useEffect, useCallback, useRef } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useOnboarding, useFirstLaunch } from './useOnboarding'
import { TUTORIAL_STEPS } from './tutorialSteps'
import type { TutorialStepProps } from './types'

interface OnboardingTutorialProps {
  onComplete?: () => void
  onSkip?: () => void
  forceShow?: boolean
}

/**
 * Main Onboarding Tutorial Component
 *
 * Displays an 8-step interactive tutorial for new users.
 * Automatically shows on first launch and persists progress.
 */
export function OnboardingTutorial({ onComplete, onSkip, forceShow = false }: OnboardingTutorialProps) {
  const { onboardingState, completeTutorial, skipTutorial, setCurrentStep, completeStep, isLoading } = useOnboarding()
  const isFirstLaunch = useFirstLaunch()
  const [isVisible, setIsVisible] = useState(false)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const modalRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  // Determine if tutorial should be shown
  useEffect(() => {
    if (isLoading || isFirstLaunch === null) return

    const shouldShow =
      forceShow ||
      (isFirstLaunch && !onboardingState.hasCompletedTutorial && !onboardingState.hasSkippedTutorial)

    if (shouldShow) {
      setIsVisible(true)
      setCurrentStepIndex(onboardingState.currentStep || 0)
    }
  }, [isLoading, isFirstLaunch, onboardingState, forceShow])

  // Focus management: trap focus in modal and restore on close
  useEffect(() => {
    if (isVisible) {
      // Store the currently focused element to restore later
      previousActiveElement.current = document.activeElement as HTMLElement

      // Focus the modal container
      setTimeout(() => {
        modalRef.current?.focus()
      }, 0)
    } else {
      // Restore focus when modal closes
      previousActiveElement.current?.focus()
    }
  }, [isVisible])

  // Handle keyboard navigation
  useEffect(() => {
    if (!isVisible) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      switch (e.key) {
        case 'ArrowRight':
        case 'Enter':
          e.preventDefault()
          handleNext()
          break
        case 'ArrowLeft':
          e.preventDefault()
          handlePrevious()
          break
        case 'Escape':
          e.preventDefault()
          handleSkip()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isVisible, currentStepIndex])

  const handleNext = useCallback(async () => {
    const currentStep = TUTORIAL_STEPS[currentStepIndex]
    await completeStep(currentStep.id)

    if (currentStepIndex < TUTORIAL_STEPS.length - 1) {
      const nextIndex = currentStepIndex + 1
      setCurrentStepIndex(nextIndex)
      await setCurrentStep(nextIndex)
    } else {
      // Last step - complete the tutorial
      await handleComplete()
    }
  }, [currentStepIndex, completeStep, setCurrentStep])

  const handlePrevious = useCallback(async () => {
    if (currentStepIndex > 0) {
      const prevIndex = currentStepIndex - 1
      setCurrentStepIndex(prevIndex)
      await setCurrentStep(prevIndex)
    }
  }, [currentStepIndex, setCurrentStep])

  const handleSkip = useCallback(async () => {
    await skipTutorial()
    setIsVisible(false)
    onSkip?.()
  }, [skipTutorial, onSkip])

  const handleComplete = useCallback(async () => {
    await completeTutorial()
    setIsVisible(false)
    onComplete?.()
  }, [completeTutorial, onComplete])

  const handleClose = useCallback(() => {
    handleSkip()
  }, [handleSkip])

  // Don't render anything while loading or if not visible
  if (isLoading || !isVisible) {
    return null
  }

  const currentStep = TUTORIAL_STEPS[currentStepIndex]
  const StepComponent = currentStep.component
  const totalSteps = TUTORIAL_STEPS.length

  const stepProps: TutorialStepProps = {
    onNext: handleNext,
    onPrevious: handlePrevious,
    onSkip: handleSkip,
    isFirstStep: currentStepIndex === 0,
    isLastStep: currentStepIndex === totalSteps - 1,
    currentStep: currentStepIndex,
    totalSteps,
  }

  // Special case for complete step - override onNext to complete tutorial
  if (currentStep.id === 'complete') {
    stepProps.onNext = handleComplete
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in" role="presentation">
      <div
        ref={modalRef}
        className="relative w-full max-w-2xl mx-4 bg-bg-secondary border border-border rounded-xl shadow-dropdown animate-scale-in overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        tabIndex={-1}
      >
        {/* Header with close button */}
        <div className="absolute top-4 right-4">
          <button
            onClick={handleClose}
            className="btn-icon-sm"
            aria-label="Close tutorial"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-bg-tertiary">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${((currentStepIndex + 1) / totalSteps) * 100}%` }}
            role="progressbar"
            aria-valuenow={currentStepIndex + 1}
            aria-valuemin={1}
            aria-valuemax={totalSteps}
            aria-label={`Step ${currentStepIndex + 1} of ${totalSteps}: ${currentStep.title}`}
          />
        </div>

        {/* Screen reader title */}
        <h2 id="tutorial-title" className="sr-only">
          Tutorial: {currentStep.title} - Step {currentStepIndex + 1} of {totalSteps}
        </h2>

        {/* Step content */}
        <div className="p-8">
          <StepComponent {...stepProps} />
        </div>

        {/* Keyboard hints */}
        <div className="px-8 py-3 bg-bg-tertiary/50 border-t border-border flex items-center justify-center gap-6 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-bg-secondary border border-border rounded text-2xs font-mono">Esc</kbd>
            <span>Skip</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-bg-secondary border border-border rounded text-2xs font-mono">
              <ChevronLeft className="w-3 h-3" />
            </kbd>
            <kbd className="px-1.5 py-0.5 bg-bg-secondary border border-border rounded text-2xs font-mono">
              <ChevronRight className="w-3 h-3" />
            </kbd>
            <span>Navigate</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-bg-secondary border border-border rounded text-2xs font-mono">Enter</kbd>
            <span>Next</span>
          </span>
        </div>
      </div>
    </div>
  )
}

export { useOnboarding, useFirstLaunch } from './useOnboarding'
export type { OnboardingState, TutorialStep, TutorialStepProps } from './types'
