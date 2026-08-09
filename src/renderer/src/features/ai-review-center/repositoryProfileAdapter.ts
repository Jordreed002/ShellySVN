export type DraftTransformation =
  | 'shorter'
  | 'add-body'
  | 'remove-body'
  | 'imperative'
  | 'match-style'
  | 'include-issues'
  | 'explain-motivation'
  | 'regenerate';

export interface RepositoryProfile {
  version: 1;
  commitPrefixes: string[];
  issueIdPattern: string;
  subjectMaxLength: number;
  bodyStyle: string;
  terminology: Record<string, string>;
  testPaths: string[];
  generatedPaths: string[];
  documentationPaths: string[];
  excludedPaths: string[];
  requiredReviewQuestions: string[];
  enabledDraftTransformations: DraftTransformation[];
  updatedAt: string;
}

export interface RepositoryProfileImportPreview {
  valid: boolean;
  profile?: RepositoryProfile;
  warnings: string[];
}

interface RepositoryProfileApi {
  get: (workingCopyPath: string) => Promise<RepositoryProfile | null>;
  previewImport: (input: string) => Promise<RepositoryProfileImportPreview>;
  save: (workingCopyPath: string, profile: RepositoryProfile) => Promise<void>;
  remove: (workingCopyPath: string) => Promise<void>;
}

export const ALL_DRAFT_TRANSFORMATIONS: DraftTransformation[] = [
  'shorter',
  'add-body',
  'remove-body',
  'imperative',
  'match-style',
  'include-issues',
  'explain-motivation',
  'regenerate',
];

export function emptyRepositoryProfile(): RepositoryProfile {
  return {
    version: 1,
    commitPrefixes: [],
    issueIdPattern: '',
    subjectMaxLength: 72,
    bodyStyle: '',
    terminology: {},
    testPaths: [],
    generatedPaths: [],
    documentationPaths: [],
    excludedPaths: [],
    requiredReviewQuestions: [],
    enabledDraftTransformations: [...ALL_DRAFT_TRANSFORMATIONS],
    updatedAt: new Date().toISOString(),
  };
}

export function repositoryProfileApi(): RepositoryProfileApi {
  return (window.api.ai as typeof window.api.ai & { repositoryProfile: RepositoryProfileApi })
    .repositoryProfile;
}

export function parseListInput(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

export function parseTerminologyInput(value: string): Record<string, string> {
  const terminology: Record<string, string> = {};
  for (const line of value.split('\n')) {
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const replacement = line.slice(separator + 1).trim();
    if (key && replacement) terminology[key] = replacement;
  }
  return terminology;
}
