import { useEffect, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import {
  TRACKER_PRESETS,
  buildPresetConfig,
  loadTrackerPresetSelection,
  saveTrackerPresetSelection,
  type IssueTrackerPresetId,
} from '@renderer/lib/issueTracker';
import type { IssueTrackerConfig } from '@renderer/utils/issueTracker';

/**
 * Inline issue-tracker preset picker (#74) for the commit dialog's Rules
 * popover. Picking Jira or GitHub plus a base URL derives the
 * `{ pattern, urlTemplate }` pair and writes it through the *existing* per-WC
 * tracker config (`updateConfig`), so bugtraq inheritance, the commit rules
 * seeding, and the linkified chips all keep reading the same source of truth.
 * The picker choice itself is remembered per working copy (global fallback).
 */

interface IssueTrackerPresetPickerProps {
  workingCopyPath: string;
  config: IssueTrackerConfig;
  onApply: (updates: Partial<IssueTrackerConfig>) => void;
}

const PRESET_ORDER: IssueTrackerPresetId[] = ['jira', 'github', 'custom'];

export function IssueTrackerPresetPicker({
  workingCopyPath,
  config,
  onApply,
}: IssueTrackerPresetPickerProps) {
  const [preset, setPreset] = useState<IssueTrackerPresetId>('jira');
  const [baseUrl, setBaseUrl] = useState('');
  const [customPattern, setCustomPattern] = useState(config.issueIdPattern);
  const [customTemplate, setCustomTemplate] = useState(config.issueUrlTemplate);

  useEffect(() => {
    let cancelled = false;
    void loadTrackerPresetSelection(workingCopyPath).then((selection) => {
      if (cancelled || !selection) return;
      setPreset(selection.preset);
      setBaseUrl(selection.baseUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [workingCopyPath]);

  const derived = buildPresetConfig(preset, baseUrl, {
    issueIdPattern: customPattern,
    issueUrlTemplate: customTemplate,
  });
  const preview =
    preset === 'custom'
      ? derived.issueUrlTemplate || 'URL template required'
      : derived.issueUrlTemplate || 'Enter a base URL to derive the link template';

  const applyPreset = async () => {
    const updates: Partial<IssueTrackerConfig> = { enabled: true };
    if (derived.issueIdPattern) updates.issueIdPattern = derived.issueIdPattern;
    if (derived.issueUrlTemplate) updates.issueUrlTemplate = derived.issueUrlTemplate;
    onApply(updates);
    await saveTrackerPresetSelection(
      workingCopyPath || null,
      preset === 'custom' ? null : { preset, baseUrl: baseUrl.trim() }
    );
  };

  return (
    <div className="space-y-2">
      <div
        className="flex gap-1"
        role="group"
        aria-label="Issue tracker provider preset"
      >
        {PRESET_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setPreset(id)}
            aria-pressed={preset === id}
            className={`flex-1 rounded-md border px-2 py-1 text-11 transition-fast ${
              preset === id
                ? 'border-accent/50 bg-accent/10 text-accent'
                : 'border-border text-text-muted hover:bg-bg-tertiary'
            }`}
          >
            {TRACKER_PRESETS[id].label}
          </button>
        ))}
      </div>

      {preset === 'custom' ? (
        <>
          <label className="block">
            <span className="text-10.5 font-medium text-text-muted">Custom issue pattern</span>
            <input
              type="text"
              value={customPattern}
              onChange={(event) => setCustomPattern(event.target.value)}
              className="input mt-1 w-full font-mono text-11"
              placeholder="[A-Z]+-\d+"
              spellCheck={false}
            />
          </label>
          <label className="block">
            <span className="text-10.5 font-medium text-text-muted">Custom URL template</span>
            <input
              type="text"
              value={customTemplate}
              onChange={(event) => setCustomTemplate(event.target.value)}
              className="input mt-1 w-full text-11"
              placeholder="https://tracker.example.com/browse/{id}"
              spellCheck={false}
            />
          </label>
        </>
      ) : (
        <label className="block">
          <span className="text-10.5 font-medium text-text-muted">
            {TRACKER_PRESETS[preset].label} base URL
          </span>
          <input
            type="text"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            className="input mt-1 w-full text-11"
            placeholder={TRACKER_PRESETS[preset].baseUrlPlaceholder}
            spellCheck={false}
          />
          <span className="mt-0.5 block text-10 text-text-faint">
            {TRACKER_PRESETS[preset].description}
          </span>
        </label>
      )}

      <p className="flex items-center gap-1 text-10 text-text-faint" title={preview}>
        <ExternalLink className="h-3 w-3 flex-none" aria-hidden="true" />
        <span className="truncate">{preview}</span>
      </p>

      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-secondary btn-sm text-10.5"
          onClick={() => void applyPreset()}
          disabled={
            preset === 'custom'
              ? !(customPattern.trim() && customTemplate.trim() && derived.issueIdPattern)
              : !(baseUrl.trim() && derived.issueUrlTemplate)
          }
        >
          <Check className="h-3 w-3" aria-hidden="true" />
          Apply preset
        </button>
      </div>
    </div>
  );
}
