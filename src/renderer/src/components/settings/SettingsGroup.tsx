/**
 * Shared settings section wrapper (#89): anchors every group with a stable
 * `data-settings-section` slug (jump-to-section target for search) and renders
 * a per-section reset button when the group declares `resetKeys` and the
 * dialog provided a reset handler via SettingsSectionResetContext.
 *
 * Sections are flat: a title, a one-line description and the controls, with
 * the page (`.settings-page`) drawing one hairline between sections.
 */

import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';

import type { AppSettings } from '@shared/types';

import { sectionSlug } from '../../lib/settingsSearch';
import { useSettingsSectionReset } from './sectionReset';

interface SettingsGroupProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /**
   * Top-level settings keys this group owns (#89 per-section reset). When
   * provided (and the dialog supplied a reset handler), a small reset button
   * appears in the group header.
   */
  resetKeys?: readonly (keyof AppSettings)[];
  /** Extra controls aligned with the section title (for example an Add button). */
  actions?: ReactNode;
}

export function SettingsGroup({
  title,
  description,
  children,
  resetKeys,
  actions,
}: SettingsGroupProps) {
  const resetSection = useSettingsSectionReset();
  return (
    <section className="group/section" data-settings-section={sectionSlug(title)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-13 font-semibold text-text">
            {title}
          </h4>
          {description && <p className="mt-0.5 text-12 text-text-muted">{description}</p>}
        </div>
        {(actions || (resetKeys && resetSection)) && (
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            {resetKeys && resetSection && (
              <button
                type="button"
                className="btn-icon-sm text-text-muted opacity-0 transition-opacity hover:text-text focus-visible:opacity-100 group-hover/section:opacity-100 group-focus-within/section:opacity-100"
                onClick={() => resetSection(resetKeys)}
                aria-label={`Reset ${title} to defaults`}
                title={`Reset ${title} to defaults`}
                data-testid={`settings-section-reset-${sectionSlug(title)}`}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}
