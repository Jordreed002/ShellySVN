import type { SvnStatusChar } from '@shared/types';

/**
 * The status letter's label and colour, shared by the commit dialog's file
 * list and the diff pane's toolbar so one file reads the same in both.
 */
export const STATUS_CONFIG: Record<SvnStatusChar, { label: string; color: string }> = {
  ' ': { label: 'Normal', color: 'text-text-muted' },
  A: { label: 'Added', color: 'text-success' },
  C: { label: 'Conflicted', color: 'text-warning' },
  D: { label: 'Deleted', color: 'text-error' },
  I: { label: 'Ignored', color: 'text-text-faint' },
  M: { label: 'Modified', color: 'text-accent' },
  R: { label: 'Replaced', color: 'text-accent' },
  X: { label: 'External', color: 'text-info' },
  '?': { label: 'Unversioned', color: 'text-text-secondary' },
  '!': { label: 'Missing', color: 'text-error' },
  '~': { label: 'Obstructed', color: 'text-warning' },
  O: { label: 'Remote only', color: 'text-info' },
};
