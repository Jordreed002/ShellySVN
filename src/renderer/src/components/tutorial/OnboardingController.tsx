import { useEffect, useState } from 'react';
import { OnboardingTutorial } from './OnboardingTutorial';
import { useOnboarding } from './useOnboarding';

/** Keeps onboarding persistence and restart handling outside the initial shell. */
export function OnboardingController() {
  const [forceShow, setForceShow] = useState(false);
  const { resetTutorial } = useOnboarding();

  useEffect(() => {
    const handleTutorialRestart = async () => {
      await resetTutorial();
      setForceShow(true);
    };

    window.addEventListener('tutorial:restart', handleTutorialRestart);
    return () => window.removeEventListener('tutorial:restart', handleTutorialRestart);
  }, [resetTutorial]);

  return (
    <OnboardingTutorial
      forceShow={forceShow}
      onComplete={() => setForceShow(false)}
      onSkip={() => setForceShow(false)}
    />
  );
}
