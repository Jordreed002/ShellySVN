import type {
  AiCommitPlanResult,
  AiCommitReviewResult,
  AiDiffExplanationMode,
  AiDiffExplanationResult,
} from '@shared/types';

type ReviewCenterFinding = AiCommitReviewResult['findings'][number] & {
  state: 'open' | 'dismissed';
};

interface ReviewCenterExplanation extends AiDiffExplanationResult {
  id: string;
  filePath: string;
  checksum: string;
  createdAt: string;
}

type ReviewCenterGroup = AiCommitPlanResult['groups'][number] & {
  state: 'open' | 'dismissed';
};

interface ReviewCenterRun {
  id: string;
  kind: 'review' | 'plan' | 'explanation';
  createdAt: string;
  checksum: string;
  provider: string;
  model?: string;
  durationMs: number;
  summary: string;
}

export interface ReviewCenterWorkspace {
  version: 1;
  workingCopyPath: string;
  currentChecksum: string | null;
  findings: ReviewCenterFinding[];
  explanations: ReviewCenterExplanation[];
  groups: ReviewCenterGroup[];
  questions: string[];
  runs: ReviewCenterRun[];
  updatedAt: string;
}

export type ReviewCenterCapture =
  | {
      kind: 'review';
      workingCopyPath: string;
      checksum: string;
      result: AiCommitReviewResult;
    }
  | {
      kind: 'plan';
      workingCopyPath: string;
      checksum: string;
      result: AiCommitPlanResult;
    }
  | {
      kind: 'explanation';
      workingCopyPath: string;
      filePath: string;
      checksum: string;
      mode: AiDiffExplanationMode;
      result: AiDiffExplanationResult;
    };
