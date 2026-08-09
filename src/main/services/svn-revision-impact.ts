import type { RevisionImpactReport, SvnLogEntry } from '@shared/types';
import { getLog } from './svn-history';
import { validateRepositoryTarget } from './svn-intelligence-validation';

const MAX_REVISIONS = 500;
const MAX_CHANGED_PATHS = 5_000;

type RevisionImpactCategory = RevisionImpactReport['groups'][number]['category'];
type RevisionImpactEvidence = RevisionImpactReport['groups'][number]['evidence'][number];

function categoryFor(path: string): RevisionImpactCategory {
  const normalized = path.toLowerCase();
  if (/(^|\/)(?:branches|tags)(?:\/|$)/.test(normalized)) return 'branch-or-tag';
  if (
    /(^|\/)(?:test|tests|spec|specs|__tests__|fixtures)(?:\/|$)|\.(?:test|spec)\.[^/]+$/.test(
      normalized
    )
  )
    return 'test';
  if (/(^|\/)(?:docs?|documentation)(?:\/|$)|\.(?:md|mdx|rst|adoc)$/.test(normalized))
    return 'documentation';
  if (
    /(^|\/)(?:config|configs|\.github)(?:\/|$)|\.(?:ya?ml|json|toml|ini|conf|properties)$/.test(
      normalized
    )
  )
    return 'configuration';
  return 'source';
}

export function deriveRevisionImpact(target: string, entries: SvnLogEntry[]): RevisionImpactReport {
  const boundedEntries = entries.slice(0, MAX_REVISIONS);
  const evidence = boundedEntries
    .flatMap((entry) =>
      entry.paths.map((path) => ({
        revision: entry.revision,
        path: path.path,
        action: path.action,
      }))
    )
    .slice(0, MAX_CHANGED_PATHS);
  const groups = new Map<RevisionImpactCategory, RevisionImpactEvidence[]>();
  for (const item of evidence) {
    const category = categoryFor(item.path);
    groups.set(category, [...(groups.get(category) ?? []), item]);
  }
  return {
    target,
    revisions: [...new Set(boundedEntries.map((entry) => entry.revision))].toSorted(
      (a, b) => b - a
    ),
    authors: [...new Set(boundedEntries.map((entry) => entry.author).filter(Boolean))].toSorted(),
    changedPathCount: evidence.length,
    truncated:
      entries.length > boundedEntries.length ||
      boundedEntries.reduce((n, e) => n + e.paths.length, 0) > evidence.length,
    groups: [...groups.entries()].map(([category, items]) => ({ category, evidence: items })),
  };
}

export async function getRevisionImpact(
  target: string,
  limit = 100,
  revision?: number
): Promise<RevisionImpactReport> {
  const approvedTarget = validateRepositoryTarget(target, 'Revision impact target');
  if (!Number.isFinite(limit)) throw new Error('Revision impact limit must be a finite number.');
  if (revision !== undefined && (!Number.isInteger(revision) || revision < 0)) {
    throw new Error('Revision impact revision must be a non-negative integer.');
  }
  const boundedLimit = Math.max(1, Math.min(MAX_REVISIONS, Math.trunc(limit)));
  const result = await getLog(approvedTarget, boundedLimit, revision, revision);
  if (result.error || result.parseError)
    throw new Error(result.error ?? 'SVN returned invalid log data.');
  return deriveRevisionImpact(approvedTarget, result.entries);
}
