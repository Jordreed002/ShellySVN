/**
 * Per-section reset (#89): panels stay dumb — SettingsGroup calls the context
 * with its `resetKeys` and the dialog (the owner of local + preview state)
 * performs the reset for exactly those top-level keys.
 */

import { createContext, useContext } from 'react';
import type { AppSettings } from '@shared/types';

export type ResetSectionFn = (keys: readonly (keyof AppSettings)[]) => void;

export const SettingsSectionResetContext = createContext<ResetSectionFn | null>(null);

export function useSettingsSectionReset(): ResetSectionFn | null {
  return useContext(SettingsSectionResetContext);
}
