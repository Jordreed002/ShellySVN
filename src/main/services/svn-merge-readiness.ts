import type { MergeReadinessReport, SvnInfoResult, SvnStatusEntry } from '@shared/types';
import { parseSvnStatusXml } from '@shared/svn-parsers';
import { assertPathApprovedForIpc } from '../utils/approved-paths';
import { withSvnTargets } from '../utils/svn-targets';
import { parseSvnInfoXml } from '../svn/parsers';
import { runSvnText } from './svn-executor';
import { getMergeInfo } from './svn-history';
import { validateRepositoryUrl } from './svn-intelligence-validation';

const MAX_EVIDENCE_PATHS = 2_000;
const MAX_REVISIONS = 2_000;
type MergeReadinessFinding = MergeReadinessReport['findings'][number];

function deriveMergeReadiness(input: {
  sourceUrl: string;
  targetPath: string;
  sourceInfo: SvnInfoResult;
  targetInfo: SvnInfoResult;
  status: SvnStatusEntry[];
  eligibleRevisions: number[];
  mergedRevisions: number[];
}): MergeReadinessReport {
  const findings: MergeReadinessFinding[] = [];
  const paths = (predicate: (entry: SvnStatusEntry) => boolean) =>
    input.status
      .filter(predicate)
      .map((entry) => entry.path)
      .slice(0, MAX_EVIDENCE_PATHS);
  const conflicts = paths((entry) => entry.status === 'C' || entry.treeConflict !== undefined);
  const modifications = paths((entry) => ![' ', 'I', 'X'].includes(entry.status));
  const switched = paths((entry) => entry.switched === true);
  const externals = paths((entry) => entry.status === 'X');
  if (input.sourceInfo.repositoryUuid !== input.targetInfo.repositoryUuid)
    findings.push({
      kind: 'repository-mismatch',
      severity: 'blocker',
      detail: 'Source and target have different repository UUIDs.',
      paths: [],
      revisions: [],
    });
  if (conflicts.length)
    findings.push({
      kind: 'conflicts',
      severity: 'blocker',
      detail: `${conflicts.length} conflicted path(s) are present.`,
      paths: conflicts,
      revisions: [],
    });
  if (modifications.length)
    findings.push({
      kind: 'local-modifications',
      severity: 'warning',
      detail: `${modifications.length} locally changed path(s) are present.`,
      paths: modifications,
      revisions: [],
    });
  if (switched.length)
    findings.push({
      kind: 'switched-paths',
      severity: 'warning',
      detail: `${switched.length} switched path(s) are present.`,
      paths: switched,
      revisions: [],
    });
  if (externals.length)
    findings.push({
      kind: 'externals',
      severity: 'info',
      detail: `${externals.length} external working copy path(s) are managed separately.`,
      paths: externals,
      revisions: [],
    });
  if (!input.eligibleRevisions.length)
    findings.push({
      kind: 'no-eligible-revisions',
      severity: 'info',
      detail: 'SVN reports no eligible revisions for this source and target.',
      paths: [],
      revisions: [],
    });
  const eligible = input.eligibleRevisions.slice(0, MAX_REVISIONS);
  const merged = input.mergedRevisions.slice(0, MAX_REVISIONS);
  return {
    sourceUrl: input.sourceUrl,
    targetPath: input.targetPath,
    targetUrl: input.targetInfo.url,
    repositoryUuid: input.targetInfo.repositoryUuid,
    ready: !findings.some((finding) => finding.severity === 'blocker'),
    eligibleRevisions: eligible,
    mergedRevisions: merged,
    findings,
    truncated:
      input.status.length > MAX_EVIDENCE_PATHS ||
      input.eligibleRevisions.length > eligible.length ||
      input.mergedRevisions.length > merged.length,
  };
}

export async function getMergeReadiness(
  sourceUrl: string,
  targetPath: string
): Promise<MergeReadinessReport> {
  const source = validateRepositoryUrl(sourceUrl, 'Merge source');
  const target = assertPathApprovedForIpc(targetPath, 'Merge target');
  const [statusXml, sourceInfoXml, targetInfoXml, eligible, merged] = await Promise.all([
    runSvnText(withSvnTargets(['status', '--xml', '--depth', 'infinity'], [target]), {
      cwd: target,
      maxStdoutBytes: 16 * 1024 * 1024,
      maxStderrBytes: 64 * 1024,
    }),
    runSvnText(withSvnTargets(['info', '--xml'], [source]), {
      maxStdoutBytes: 512 * 1024,
      maxStderrBytes: 64 * 1024,
    }),
    runSvnText(withSvnTargets(['info', '--xml'], [target]), {
      cwd: target,
      maxStdoutBytes: 512 * 1024,
      maxStderrBytes: 64 * 1024,
    }),
    getMergeInfo(source, target, 'eligible'),
    getMergeInfo(source, target, 'merged'),
  ]);
  const status = parseSvnStatusXml(statusXml, target);
  const sourceInfo = parseSvnInfoXml(sourceInfoXml);
  const targetInfo = parseSvnInfoXml(targetInfoXml);
  if (
    status.parseError ||
    sourceInfo.parseError ||
    targetInfo.parseError ||
    !sourceInfo.repositoryUuid ||
    !targetInfo.repositoryUuid
  )
    throw new Error('SVN returned invalid merge-readiness evidence.');
  return deriveMergeReadiness({
    sourceUrl: source,
    targetPath: target,
    sourceInfo,
    targetInfo,
    status: status.entries,
    eligibleRevisions: eligible.revisions,
    mergedRevisions: merged.revisions,
  });
}
