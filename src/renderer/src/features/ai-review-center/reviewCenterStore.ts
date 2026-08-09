import type { ReviewCenterCapture, ReviewCenterWorkspace } from './types';

const REVIEW_CENTER_STORE_PREFIX = 'shellysvn:ai-review-center:v1:';
const MAX_RUNS = 30;
const MAX_EXPLANATIONS = 30;
const MAX_FINDINGS = 200;
const MAX_GROUPS = 50;
const MAX_QUESTIONS = 100;
const MAX_GROUP_PATHS = 1_000;

function persistedFinding(finding: ReviewCenterWorkspace['findings'][number]) {
  return {
    ...finding,
    // Evidence excerpts are intentionally session-only repository content.
    evidence: Array.isArray(finding.evidence)
      ? finding.evidence.slice(0, 20).map(({ filePath, startLine, endLine }) => ({
          filePath,
          startLine,
          endLine,
          excerpt: '',
        }))
      : [],
  };
}

function markdownText(value: string): string {
  return value.replace(/\r/g, '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function reviewCenterStorageKey(workingCopyPath: string): string {
  return `${REVIEW_CENTER_STORE_PREFIX}${workingCopyPath}`;
}

export function emptyReviewCenterWorkspace(workingCopyPath: string): ReviewCenterWorkspace {
  return {
    version: 1,
    workingCopyPath,
    currentChecksum: null,
    findings: [],
    explanations: [],
    groups: [],
    questions: [],
    runs: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export function parseReviewCenterWorkspace(
  value: unknown,
  workingCopyPath: string
): ReviewCenterWorkspace {
  if (!value || typeof value !== 'object') return emptyReviewCenterWorkspace(workingCopyPath);
  const candidate = value as Partial<ReviewCenterWorkspace>;
  if (candidate.version !== 1 || candidate.workingCopyPath !== workingCopyPath) {
    return emptyReviewCenterWorkspace(workingCopyPath);
  }
  return {
    ...emptyReviewCenterWorkspace(workingCopyPath),
    ...candidate,
    findings: Array.isArray(candidate.findings)
      ? candidate.findings.slice(0, MAX_FINDINGS).map(persistedFinding)
      : [],
    explanations: Array.isArray(candidate.explanations) ? candidate.explanations : [],
    groups: Array.isArray(candidate.groups)
      ? candidate.groups.slice(0, MAX_GROUPS).map((group) => ({
          ...group,
          paths: Array.isArray(group.paths) ? group.paths.slice(0, MAX_GROUP_PATHS) : [],
        }))
      : [],
    questions: Array.isArray(candidate.questions)
      ? candidate.questions
          .filter((question): question is string => typeof question === 'string')
          .slice(0, MAX_QUESTIONS)
      : [],
    runs: Array.isArray(candidate.runs) ? candidate.runs.slice(0, MAX_RUNS) : [],
  };
}

export function captureResult(
  workspace: ReviewCenterWorkspace,
  capture: ReviewCenterCapture,
  now = new Date().toISOString()
): ReviewCenterWorkspace {
  const result = capture.result;
  const run = {
    id: `${capture.kind}-${now}-${capture.checksum}`,
    kind: capture.kind,
    createdAt: now,
    checksum: capture.checksum,
    provider: result.provider,
    model: result.model,
    durationMs: result.durationMs,
    summary: result.summary,
  } as const;
  const base = {
    ...workspace,
    currentChecksum: capture.checksum,
    updatedAt: now,
    runs: [run, ...workspace.runs].slice(0, MAX_RUNS),
  };

  if (capture.kind === 'review') {
    const previousStates = new Map(
      workspace.findings.map((finding) => [finding.id, finding.state])
    );
    return {
      ...base,
      findings: capture.result.findings.slice(0, MAX_FINDINGS).map((finding) => ({
        ...persistedFinding({ ...finding, state: 'open' }),
        state: previousStates.get(finding.id) ?? 'open',
      })),
    };
  }
  if (capture.kind === 'plan') {
    const previousStates = new Map(workspace.groups.map((group) => [group.id, group.state]));
    return {
      ...base,
      groups: capture.result.groups.slice(0, MAX_GROUPS).map((group) => ({
        ...group,
        paths: group.paths.slice(0, MAX_GROUP_PATHS),
        state: previousStates.get(group.id) ?? 'open',
      })),
    };
  }
  const explanation = {
    ...capture.result,
    id: `${capture.filePath}:${capture.mode}:${capture.checksum}`,
    filePath: capture.filePath,
    checksum: capture.checksum,
    createdAt: now,
  };
  return {
    ...base,
    explanations: [
      explanation,
      ...workspace.explanations.filter((item) => item.id !== explanation.id),
    ].slice(0, MAX_EXPLANATIONS),
    questions: [...new Set([...capture.result.reviewQuestions, ...workspace.questions])].slice(
      0,
      MAX_QUESTIONS
    ),
  };
}

export function setFindingState(
  workspace: ReviewCenterWorkspace,
  findingId: string,
  state: 'open' | 'dismissed'
): ReviewCenterWorkspace {
  return {
    ...workspace,
    findings: workspace.findings.map((finding) =>
      finding.id === findingId ? { ...finding, state } : finding
    ),
  };
}

export function setGroupState(
  workspace: ReviewCenterWorkspace,
  groupId: string,
  state: 'open' | 'dismissed'
): ReviewCenterWorkspace {
  return {
    ...workspace,
    groups: workspace.groups.map((group) => (group.id === groupId ? { ...group, state } : group)),
  };
}

export function exportReviewCenterMarkdown(workspace: ReviewCenterWorkspace): string {
  const openFindings = workspace.findings.filter((finding) => finding.state === 'open');
  const activeGroups = workspace.groups.filter((group) => group.state === 'open');
  const lines = [
    '# ShellySVN AI review',
    '',
    `Working copy: \`${markdownText(workspace.workingCopyPath)}\``,
    `Updated: ${workspace.updatedAt}`,
    '',
    `## Open findings (${openFindings.length})`,
    '',
    ...openFindings.flatMap((finding) => [
      `- **${markdownText(finding.title)}** (${finding.severity}, ${markdownText(finding.category)})`,
      `  - ${markdownText(finding.filePath)}${finding.line > 0 ? `:${finding.line}` : ''}`,
      `  - ${markdownText(finding.detail)}`,
    ]),
    '',
    `## Commit groups (${activeGroups.length})`,
    '',
    ...activeGroups.flatMap((group) => [
      `### ${markdownText(group.title)}`,
      '',
      markdownText(group.description),
      '',
      ...group.paths.map((path) => `- \`${markdownText(path)}\``),
      '',
      `Suggested message: ${markdownText(group.suggestedMessage)}`,
      '',
    ]),
    `## Review questions (${workspace.questions.length})`,
    '',
    ...workspace.questions.map((question) => `- ${markdownText(question)}`),
    '',
    '_Generated results are advisory. No raw diffs or prompts are included._',
  ];
  return lines.join('\n');
}
