/**
 * Catalog of SVN conflict-resolution accept modes (#55).
 *
 * `svn resolve --accept` understands exactly six values:
 * `base`, `mine-conflict`, `mine-full`, `theirs-conflict`, `theirs-full`,
 * `working`. TortoiseSVN-style "merged" resolution maps onto `working` (keep
 * whatever the merge editor / external tool left in the working file), and
 * "unresolved / postpone" is not an `svn resolve` action at all — it simply
 * leaves the conflict in place. Both are modeled here as wizard-facing modes
 * (`merged` as an alias of `working`, `postpone` as a no-op) so every surface
 * can offer the complete set with one shared source of plain-language
 * consequence descriptions.
 */

/** The values the `svn resolve --accept` IPC channel actually accepts. */
export type SvnResolveAcceptArg =
  | 'base'
  | 'mine-full'
  | 'theirs-full'
  | 'mine-conflict'
  | 'theirs-conflict'
  | 'working';

/** Wizard-facing choice: an accept argument, or "leave it unresolved". */
export type ConflictResolutionMode = SvnResolveAcceptArg | 'postpone';

/** TortoiseSVN-style "merged" choice — kept distinct in UI state, same SVN arg. */
export type MergedResolutionAlias = 'merged';

export type ConflictKind = 'text' | 'property' | 'tree' | 'binary';

export interface AcceptModeInfo {
  /** Stable machine value used in state and IPC. */
  value: ConflictResolutionMode;
  /** Short button label. */
  label: string;
  /** Plain-language description of what happens to the working copy. */
  consequence: string;
  /** One-line "what ends up on disk" summary for confirmations. */
  outcome: string;
  /** Conflict kinds this mode can be applied to. */
  appliesTo: readonly ConflictKind[];
  /** True when local edits, incoming edits, or both are discarded. */
  destructive: boolean;
}

export const ACCEPT_MODE_CATALOG: Record<Exclude<ConflictResolutionMode, 'postpone'>, AcceptModeInfo> = {
  'mine-full': {
    value: 'mine-full',
    label: 'Use my version (full)',
    consequence:
      'Your whole file (or every property value) becomes the final version. All incoming changes for this item are thrown away.',
    outcome: 'Keeps yours, discards theirs',
    appliesTo: ['text', 'property', 'tree', 'binary'],
    destructive: true,
  },
  'theirs-full': {
    value: 'theirs-full',
    label: 'Use their version (full)',
    consequence:
      'The incoming version replaces the item completely. Your local edits to it are thrown away.',
    outcome: 'Takes theirs, discards yours',
    appliesTo: ['text', 'property', 'tree', 'binary'],
    destructive: true,
  },
  'mine-conflict': {
    value: 'mine-conflict',
    label: 'Keep my conflicting sections',
    consequence:
      'Only the parts that actually conflict take your value. Changes the other side made that merged cleanly are kept.',
    outcome: 'Conflicting sections yours, clean merges kept',
    appliesTo: ['text', 'property', 'tree'],
    destructive: true,
  },
  'theirs-conflict': {
    value: 'theirs-conflict',
    label: 'Take their conflicting sections',
    consequence:
      'Only the parts that actually conflict take the incoming value. Your changes that merged cleanly are kept.',
    outcome: 'Conflicting sections theirs, clean merges kept',
    appliesTo: ['text', 'property', 'tree'],
    destructive: true,
  },
  base: {
    value: 'base',
    label: 'Revert to base',
    consequence:
      'Both sides are discarded and the item goes back to the common ancestor — the version both sides started from.',
    outcome: 'Discards both sides, restores the common ancestor',
    appliesTo: ['text', 'property', 'binary'],
    destructive: true,
  },
  working: {
    value: 'working',
    label: 'Use my merged result',
    consequence:
      'Nothing is changed on disk. The current working-copy content — what you (or a merge tool) left behind — is accepted as the resolution.',
    outcome: 'Keeps the current working-copy content',
    appliesTo: ['text', 'property', 'tree', 'binary'],
    destructive: false,
  },
};

/** Postpone is not an `svn resolve` action; it leaves the conflict untouched. */
export const POSTPONE_MODE_INFO: AcceptModeInfo = {
  value: 'postpone',
  label: 'Leave unresolved',
  consequence:
    'The conflict stays in place. You can come back to it later in this wizard, the resolve dialog, or on the command line.',
  outcome: 'No action taken',
  appliesTo: ['text', 'property', 'tree', 'binary'],
  destructive: false,
};

/**
 * Every applicable mode for a conflict kind, in the order the wizard should
 * offer them: side-picking first, then section-level, then base, then the
 * working/merged trust options.
 */
export function applicableAcceptModes(kind: ConflictKind): AcceptModeInfo[] {
  const order: Exclude<ConflictResolutionMode, 'postpone'>[] = [
    'mine-full',
    'theirs-full',
    'mine-conflict',
    'theirs-conflict',
    'base',
    'working',
  ];
  return order
    .filter((mode) => ACCEPT_MODE_CATALOG[mode].appliesTo.includes(kind))
    .map((mode) => ACCEPT_MODE_CATALOG[mode]);
}

/** Whether a mode may be applied to a conflict of the given kind. */
export function isModeApplicable(mode: ConflictResolutionMode, kind: ConflictKind): boolean {
  if (mode === 'postpone') return true;
  return ACCEPT_MODE_CATALOG[mode].appliesTo.includes(kind);
}

/**
 * The `--accept` argument to hand to `svn resolve` (via the IPC bridge).
 * `postpone` never reaches SVN — callers must skip the call; the returned
 * undefined makes that explicit.
 */
export function toSvnResolveArg(mode: ConflictResolutionMode): SvnResolveAcceptArg | undefined {
  if (mode === 'postpone') return undefined;
  return mode;
}

/**
 * Map a UI-level resolution label onto an accept mode. The wizard's merge
 * editor and external-tool flows historically report `merged`/`custom`; both
 * mean "trust the working copy file" → `working`.
 */
export function normalizeWizardResolution(
  resolution: SvnResolveAcceptArg | MergedResolutionAlias | 'custom' | 'postpone'
): ConflictResolutionMode {
  if (resolution === 'merged' || resolution === 'custom') return 'working';
  return resolution;
}

/** Human label for any mode value, safe for foreign/unset input. */
export function acceptModeLabel(mode: ConflictResolutionMode | MergedResolutionAlias): string {
  if (mode === 'merged') return ACCEPT_MODE_CATALOG['working'].label;
  if (mode === 'postpone') return POSTPONE_MODE_INFO.label;
  return ACCEPT_MODE_CATALOG[mode]?.label ?? mode;
}

/** Outcome summary for confirmations, tolerating the historical aliases. */
export function acceptModeOutcome(mode: ConflictResolutionMode | MergedResolutionAlias): string {
  if (mode === 'merged') return ACCEPT_MODE_CATALOG['working'].outcome;
  if (mode === 'postpone') return POSTPONE_MODE_INFO.outcome;
  return ACCEPT_MODE_CATALOG[mode]?.outcome ?? mode;
}
