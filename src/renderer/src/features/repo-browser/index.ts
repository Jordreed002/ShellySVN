/**
 * Repository browser — public surface.
 *
 * Design source: `prototypes/12-browser.html`. See `SPEC.md` for the rules the
 * components hold to, above all: `svn ls` and `svn status` are different
 * sources of truth and only overlap inside a checkout.
 */

export * from './types';
export * from './adapters';
export * from './useRepoBrowserState';
export {
  buildRepoBrowserMenu,
  localPathForEntry,
  type RepoBrowserMenu,
  type RepoBrowserMenuHandlers,
  type RepoBrowserMenuOptions,
} from './repoBrowserMenu';
export * from './hooks';
export { RepoBrowserView, type RepoBrowserViewProps } from './RepoBrowserView';

/* ── shell and chrome ── */
export {
  RepoBrowserShell,
  useRepoBrowserLayout,
  type RepoBrowserShellProps,
  type RepoBrowserLayout,
  type RepoPaneSlot,
  type ContentsDensity,
} from './components/RepoBrowserShell';
export { RepoNavBar, type RepoNavBarProps } from './components/RepoNavBar';
export {
  RepoAddressBar,
  type RepoAddressBarProps,
  type RepoAddressBarHandle,
  type RepoCrumb,
} from './components/RepoAddressBar';

/* ── tree ── */
export { RepoTree, type RepoTreeProps, type RepoTreeRow } from './components/RepoTree';
export {
  RepoTreeNode,
  RepoTreeMoreRow,
  RepoTreeStatusRow,
  TREE_ROW_HEIGHT,
  type RepoTreeNodeProps,
} from './components/RepoTreeNode';

/* ── contents ── */
export {
  RepoContents,
  RepoScopeChip,
  type RepoContentsProps,
  type RepoScopeChipProps,
} from './components/RepoContents';
export {
  RepoContentsRow,
  REPO_CONTENTS_ROW_HEIGHT,
  repoContentsGridTemplate,
  formatEntrySize,
  formatEntryDate,
  type RepoContentsRowProps,
} from './components/RepoContentsRow';
export {
  RepoStatusFlag,
  RepoRollupFlags,
  RepoPresenceFlag,
  RepoLockFlag,
  repoStatusLabel,
  type RepoStatusFlagProps,
} from './components/RepoStatusFlag';

/* ── detail pane ── */
export {
  RepoDetailPane,
  DetailMessage,
  COMPARAND_OPTIONS,
  findComparandOption,
  formatComparandLabel,
  isComparandDisabled,
  type RepoDetailPaneProps,
  type ComparandContext,
} from './components/RepoDetailPane';
export {
  DiffView,
  isConflictMarkerLine,
  classifyDiffLine,
  countDiffChanges,
  type DiffViewProps,
  type DiffRowKind,
} from './components/DiffView';
export { BlameView, type BlameViewProps } from './components/BlameView';
export { RevisionLogView, type RevisionLogViewProps } from './components/RevisionLogView';
export {
  PropertiesView,
  isFloatingExternal,
  analyseProperty,
  type PropertiesViewProps,
  type SvnPropertyEntry,
} from './components/PropertiesView';

/* ── working copy: state, problems, and the operations out of it ── */
export { WorkingCopyBand, type WorkingCopyBandProps } from './components/WorkingCopyBand';
export { ProblemsDialog, type ProblemsDialogProps } from './components/ProblemsDialog';
export { MergeDialog, type MergeDialogProps, type MergeMode } from './components/MergeDialog';
export {
  RevisionPickerDialog,
  type RevisionPickerDialogProps,
  type RevisionPickerMode,
} from './components/RevisionPickerDialog';
export {
  SwitchDialog,
  type SwitchDialogProps,
  type SwitchTarget,
  type SwitchSelection,
} from './components/SwitchDialog';
export {
  CompareDialog,
  type CompareDialogProps,
  type CompareMode,
  type CompareRequest,
} from './components/CompareDialog';
export {
  ShelfDialog,
  type ShelfDialogProps,
  type ShelfAction,
  type ShelfFileChange,
} from './components/ShelfDialog';
