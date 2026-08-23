/**
 * Shared settings section wrapper (#89): anchors every group with a stable
 * `data-settings-section` slug (jump-to-section target for search) and renders
 * a per-section reset button when the group declares `resetKeys` and the
 * dialog provided a reset handler via SettingsSectionResetContext.
 */

import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';

import type { AppSettings } from '@shared/types';

import { sectionSlug } from '../../lib/settingsSearch';
import { useSettingsSectionReset } from './sectionReset';

interface SettingsGroupProps {
  title: string;
  description?: string;
  children: ReactNode;
  /**
   * Top-level settings keys this group owns (#89 per-section reset). When
   * provided (and the dialog supplied a reset handler), a small reset button
   * appears in the group header.
   */
  resetKeys?: readonly (keyof AppSettings)[];
}

export function SettingsGroup({ title, description, children, resetKeys }: SettingsGroupProps) {
  const resetSection = useSettingsSectionReset();
  return (
    <div data-settings-section={sectionSlug(title)}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium text-text">{title}</h4>
          {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
        </div>
        {resetKeys && resetSection && (
          <button
            type="button"
            className="btn-icon-sm shrink-0 text-text-faint hover:text-text"
            onClick={() => resetSection(resetKeys)}
            aria-label={`Reset ${title} to defaults`}
            title={`Reset ${title} to defaults`}
            data-testid={`settings-section-reset-${sectionSlug(title)}`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
