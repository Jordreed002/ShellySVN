import { createHash } from 'node:crypto';

interface IncrementalReviewEvidence {
  filePath: string;
  excerpt?: string;
}
export interface IncrementalReviewFinding {
  id: string;
  filePath: string;
  evidence?: IncrementalReviewEvidence[];
}
export interface IncrementalReviewPlan<T extends IncrementalReviewFinding> {
  changedPaths: string[];
  unchangedPaths: string[];
  removedPaths: string[];
  preservedFindings: T[];
  staleFindings: T[];
}
interface Snapshot<T extends IncrementalReviewFinding> {
  hashes: Map<string, string>;
  findings: T[];
  touchedAt: number;
}

export function hashNormalizedAiDiff(diff: string): string {
  const normalized = diff
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');
  return createHash('sha256').update(normalized).digest('hex');
}

export class IncrementalAiReviewCache<T extends IncrementalReviewFinding> {
  private readonly snapshots = new Map<string, Snapshot<T>>();
  constructor(
    private readonly maxSnapshots = 20,
    private readonly retentionMs = 24 * 60 * 60 * 1_000
  ) {}
  plan(
    key: string,
    diffs: ReadonlyMap<string, string>,
    now = Date.now()
  ): IncrementalReviewPlan<T> {
    this.prune(now);
    const previous = this.snapshots.get(key);
    if (previous) {
      previous.touchedAt = now;
      this.snapshots.delete(key);
      this.snapshots.set(key, previous);
    }
    const hashes = new Map([...diffs].map(([path, diff]) => [path, hashNormalizedAiDiff(diff)]));
    const changedPaths = [...hashes]
      .filter(([path, hash]) => previous?.hashes.get(path) !== hash)
      .map(([path]) => path);
    const unchangedPaths = [...hashes]
      .filter(([path, hash]) => previous?.hashes.get(path) === hash)
      .map(([path]) => path);
    const removedPaths = previous
      ? [...previous.hashes.keys()].filter((path) => !hashes.has(path))
      : [];
    const unchanged = new Set(unchangedPaths);
    const preservedFindings = (previous?.findings ?? []).filter(
      (finding) =>
        unchanged.has(finding.filePath) &&
        (finding.evidence ?? []).every((evidence) => unchanged.has(evidence.filePath))
    );
    const preservedIds = new Set(preservedFindings.map((finding) => finding.id));
    const staleFindings = (previous?.findings ?? []).filter(
      (finding) => !preservedIds.has(finding.id)
    );
    return { changedPaths, unchangedPaths, removedPaths, preservedFindings, staleFindings };
  }
  save(key: string, diffs: ReadonlyMap<string, string>, findings: T[], now = Date.now()): void {
    this.snapshots.delete(key);
    this.snapshots.set(key, {
      hashes: new Map([...diffs].map(([path, diff]) => [path, hashNormalizedAiDiff(diff)])),
      findings: findings.slice(0, 1_000),
      touchedAt: now,
    });
    this.prune(now);
    while (this.snapshots.size > Math.max(1, this.maxSnapshots))
      this.snapshots.delete(this.snapshots.keys().next().value!);
  }
  clear(key?: string): void {
    if (key) this.snapshots.delete(key);
    else this.snapshots.clear();
  }
  private prune(now: number): void {
    for (const [key, snapshot] of this.snapshots)
      if (now - snapshot.touchedAt > this.retentionMs) this.snapshots.delete(key);
  }
}
