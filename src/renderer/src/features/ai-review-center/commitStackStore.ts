import type { AiCommitPlanResult } from '@shared/types';

type CommitStackGroupStatus = 'planned' | 'ready' | 'committed' | 'stale';

interface CommitStackGroup {
  id: string;
  order: number;
  title: string;
  description: string;
  paths: string[];
  draftMessage: string;
  changelistName?: string;
  status: CommitStackGroupStatus;
  committedRevision?: number;
}

export interface CommitStackWorkspace {
  version: 1;
  workingCopyPath: string;
  planChecksum: string | null;
  allPaths: string[];
  groups: CommitStackGroup[];
  updatedAt: string;
}

export interface CommitStackDiagnostics {
  duplicates: Map<string, string[]>;
  unassigned: string[];
}

const COMMIT_STACK_STORE_PREFIX = 'shellysvn:commit-stack:v1:';

export function commitStackStorageKey(workingCopyPath: string): string {
  return `${COMMIT_STACK_STORE_PREFIX}${workingCopyPath}`;
}

export function emptyCommitStack(workingCopyPath: string): CommitStackWorkspace {
  return {
    version: 1,
    workingCopyPath,
    planChecksum: null,
    allPaths: [],
    groups: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export function parseCommitStack(value: unknown, workingCopyPath: string): CommitStackWorkspace {
  if (!value || typeof value !== 'object') return emptyCommitStack(workingCopyPath);
  const candidate = value as Partial<CommitStackWorkspace>;
  if (candidate.version !== 1 || candidate.workingCopyPath !== workingCopyPath) {
    return emptyCommitStack(workingCopyPath);
  }
  return {
    ...emptyCommitStack(workingCopyPath),
    ...candidate,
    allPaths: Array.isArray(candidate.allPaths) ? candidate.allPaths : [],
    groups: Array.isArray(candidate.groups) ? candidate.groups : [],
  };
}

export function diagnoseCommitStack(stack: CommitStackWorkspace): CommitStackDiagnostics {
  const owners = new Map<string, string[]>();
  const completedPaths = new Set<string>();
  for (const group of stack.groups) {
    if (group.status === 'committed') {
      for (const path of group.paths) completedPaths.add(path);
      continue;
    }
    if (group.status === 'stale') continue;
    for (const path of group.paths) owners.set(path, [...(owners.get(path) ?? []), group.id]);
  }
  return {
    duplicates: new Map([...owners].filter(([, groupIds]) => groupIds.length > 1)),
    unassigned: stack.allPaths.filter((path) => !owners.has(path) && !completedPaths.has(path)),
  };
}

function withReadiness(stack: CommitStackWorkspace): CommitStackWorkspace {
  const diagnostics = diagnoseCommitStack(stack);
  return {
    ...stack,
    groups: stack.groups.map((group, order) => {
      if (group.status === 'committed' || group.status === 'stale') return { ...group, order };
      const invalid =
        group.paths.length === 0 ||
        !group.draftMessage.trim() ||
        group.paths.some((path) => diagnostics.duplicates.has(path));
      return { ...group, order, status: invalid ? 'planned' : 'ready' };
    }),
  };
}

export function ingestCommitPlan(
  stack: CommitStackWorkspace,
  result: AiCommitPlanResult,
  checksum: string,
  now = new Date().toISOString()
): CommitStackWorkspace {
  const existing = new Map(stack.groups.map((group) => [group.id, group]));
  const incomingIds = new Set(result.groups.map((group) => group.id));
  const current = result.groups.map((group, order): CommitStackGroup => {
    const previous = existing.get(group.id);
    return {
      id: group.id,
      order,
      title: group.title,
      description: group.description,
      paths: previous?.status === 'committed' ? previous.paths : group.paths,
      draftMessage: previous?.draftMessage ?? group.suggestedMessage,
      changelistName: previous?.changelistName,
      status: previous?.status === 'committed' ? 'committed' : 'planned',
      committedRevision: previous?.committedRevision,
    };
  });
  const stale = stack.groups
    .filter((group) => !incomingIds.has(group.id) && group.status !== 'committed')
    .map((group) => ({ ...group, status: 'stale' as const }));
  const allPaths = [...new Set(result.groups.flatMap((group) => group.paths))];
  return withReadiness({
    ...stack,
    planChecksum: checksum,
    allPaths,
    groups: [...current, ...stale],
    updatedAt: now,
  });
}

export function reorderCommitStack(
  stack: CommitStackWorkspace,
  groupId: string,
  direction: -1 | 1
): CommitStackWorkspace {
  const groups = [...stack.groups];
  const index = groups.findIndex((group) => group.id === groupId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= groups.length) return stack;
  [groups[index], groups[target]] = [groups[target], groups[index]];
  return withReadiness({ ...stack, groups });
}

export function updateCommitStackMessage(
  stack: CommitStackWorkspace,
  groupId: string,
  draftMessage: string
): CommitStackWorkspace {
  return withReadiness({
    ...stack,
    groups: stack.groups.map((group) =>
      group.id === groupId && group.status !== 'committed' ? { ...group, draftMessage } : group
    ),
  });
}

export function moveCommitStackPath(
  stack: CommitStackWorkspace,
  path: string,
  destinationGroupId: string | null
): CommitStackWorkspace {
  return withReadiness({
    ...stack,
    groups: stack.groups.map((group) => ({
      ...group,
      paths:
        group.status === 'committed' || group.status === 'stale'
          ? group.paths
          : group.id === destinationGroupId
            ? [...new Set([...group.paths, path])]
            : group.paths.filter((candidate) => candidate !== path),
    })),
  });
}

export function markCommitStackChangelist(
  stack: CommitStackWorkspace,
  groupId: string,
  changelistName: string
): CommitStackWorkspace {
  return {
    ...stack,
    groups: stack.groups.map((group) =>
      group.id === groupId ? { ...group, changelistName } : group
    ),
  };
}

export function markCommitStackCommitted(
  stack: CommitStackWorkspace,
  groupId: string,
  revision: number | null
): CommitStackWorkspace {
  return {
    ...stack,
    groups: stack.groups.map((group) =>
      group.id === groupId
        ? { ...group, status: 'committed', committedRevision: revision ?? undefined }
        : group
    ),
  };
}
