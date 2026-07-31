import type { ReactNode } from 'react';
import { LazyMotion, MotionConfig } from 'framer-motion';

const loadFeatures = () => import('framer-motion').then((mod) => mod.domAnimation);

/** Root motion context without importing the `m` rendering runtime into the entry. */
export function AppMotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig
        reducedMotion="user"
        transition={{ type: 'spring', stiffness: 320, damping: 32, mass: 0.9 }}
      >
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
