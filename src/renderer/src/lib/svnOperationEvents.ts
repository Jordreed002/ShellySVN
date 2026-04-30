/**
 * Custom event names for SVN operations.
 * Used for cross-component communication between Layout.tsx and FileExplorer.tsx.
 */
export const SVN_EVENTS = {
  BRANCH_TAG: 'svn:branch-tag',
  TAG: 'svn:tag',
  BRANCH_TAG_COMPARE: 'svn:branch-tag-compare',
  SWITCH: 'svn:switch',
  MERGE: 'svn:merge',
  RELOCATE: 'svn:relocate',
  BLAME: 'svn:blame',
  PROPERTIES: 'svn:properties',
  CHANGELIST: 'svn:changelist',
  SHELVE: 'svn:shelve',
  UNSHELVE: 'svn:unshelve',
  IMPORT: 'svn:import',
  EXPORT: 'svn:export',
  REPO_BROWSER: 'svn:repo-browser',
  REVISION_GRAPH: 'svn:revision-graph',
  CREATE_PATCH: 'svn:create-patch',
  APPLY_PATCH: 'svn:apply-patch',
  LOCK: 'svn:lock',
  UNLOCK: 'svn:unlock',
  REVERT: 'svn:revert',
  ADD: 'svn:add',
  DELETE: 'svn:delete',
  CLEANUP: 'svn:cleanup',
  RESOLVE: 'svn:resolve',
  MOVE: 'svn:move',
  COPY: 'svn:copy',
  RENAME: 'svn:rename',
} as const;

export type SvnEventName = (typeof SVN_EVENTS)[keyof typeof SVN_EVENTS];
