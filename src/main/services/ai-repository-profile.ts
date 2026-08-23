import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { assertPathApprovedForIpc } from '../utils/approved-paths';
import { writeSecureJson } from '../utils/secure-json';
import type {
  AiDraftTransformation,
  RepositoryAiProfileImportPreview,
  RepositoryAiPromptProfile,
  RepositoryAiStyleHints,
} from '@shared/types';

const TRANSFORMATION_INSTRUCTIONS: Record<AiDraftTransformation, string> = {
  shorter: 'Make the commit message shorter while preserving its supported meaning.',
  'add-body': 'Add a concise body explaining the motivation supported by the supplied change.',
  'remove-body': 'Return a subject-only commit message with no body.',
  imperative: 'Rewrite the subject in direct imperative mood.',
  'match-style': 'Match the approved repository commit conventions supplied by ShellySVN.',
  'include-issues': 'Include only issue references already present in the supplied metadata.',
  'explain-motivation': 'Explain the motivation only where it is supported by the supplied change.',
  regenerate: 'Regenerate the commit message from the supplied bounded change context.',
};

const BULLET_STYLES = new Set(['dash', 'asterisk', 'none']);
const MAX_PREFIX_COUNTS = 12;
const MAX_SAMPLED_COMMITS = 100_000;

function ratio(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0;
}

function count(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(MAX_SAMPLED_COMMITS, Math.max(0, Math.floor(numeric))) : 0;
}

/** Averages keep one decimal; everything else stays an integer. */
function boundedAverage(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(1_000, Math.max(0, Math.round(numeric * 10) / 10)) : 0;
}

/**
 * Style hints are statistics computed locally by ShellySVN from commit
 * history. They survive save/import only in bounded numeric form — never as
 * free-form instructions a crafted profile could smuggle in.
 */
function safeStyleHints(value: unknown): RepositoryAiStyleHints | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const prefixCounts: Record<string, number> = {};
  if (raw.prefixCounts && typeof raw.prefixCounts === 'object') {
    for (const [prefix, prefixCount] of Object.entries(
      raw.prefixCounts as Record<string, unknown>
    ).slice(0, MAX_PREFIX_COUNTS)) {
      if (/^[a-z0-9_().-]{1,40}$/i.test(prefix) && Number.isFinite(Number(prefixCount))) {
        prefixCounts[prefix] = Math.max(0, Math.floor(Number(prefixCount)));
      }
    }
  }
  const dominant =
    typeof raw.dominantPrefix === 'string' && /^[a-z0-9_().-]{1,40}$/i.test(raw.dominantPrefix)
      ? raw.dominantPrefix
      : undefined;
  const bulletStyle =
    typeof raw.bodyBulletStyle === 'string' && BULLET_STYLES.has(raw.bodyBulletStyle)
      ? (raw.bodyBulletStyle as RepositoryAiStyleHints['bodyBulletStyle'])
      : 'none';
  return {
    sampledCommits: count(raw.sampledCommits),
    averageSubjectLength: boundedAverage(raw.averageSubjectLength),
    maxSubjectLength: count(raw.maxSubjectLength),
    imperativeMoodRatio: ratio(raw.imperativeMoodRatio),
    prefixCounts,
    dominantPrefix: dominant !== undefined && prefixCounts[dominant] !== undefined ? dominant : undefined,
    includesBodyRatio: ratio(raw.includesBodyRatio),
    bodyBulletStyle: bulletStyle,
    issueIdRatio: ratio(raw.issueIdRatio),
    learnedAt:
      typeof raw.learnedAt === 'string' && Number.isFinite(Date.parse(raw.learnedAt))
        ? raw.learnedAt
        : undefined,
  };
}

export function draftTransformationInstruction(transformation: AiDraftTransformation): string {
  const instruction = TRANSFORMATION_INSTRUCTIONS[transformation];
  if (!instruction) throw new Error('Unsupported AI draft transformation.');
  return instruction;
}

export function isPathExcludedByRepositoryProfile(
  relativePath: string,
  profile: RepositoryAiPromptProfile
): boolean {
  return profile.excludedPaths.some((pattern) => {
    const expression = pattern
      .split('**')
      .map((segment) => segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
      .join('.*');
    return new RegExp(`^${expression}$`).test(relativePath.replace(/\\/g, '/'));
  });
}

interface ProfileFile {
  version: 1;
  profiles: Record<string, RepositoryAiPromptProfile>;
}

const DEFAULT_PROFILE: Omit<RepositoryAiPromptProfile, 'updatedAt'> = {
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
  enabledDraftTransformations: Object.keys(TRANSFORMATION_INSTRUCTIONS) as AiDraftTransformation[],
};

function strings(value: unknown, maxItems = 100, maxLength = 300): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ]
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
}

function safePatterns(value: unknown, warnings: string[]): string[] {
  return strings(value).filter((pattern) => {
    const unsafe =
      isAbsolute(pattern) ||
      pattern.split(/[\\/]/).includes('..') ||
      pattern.includes('\0') ||
      /[\r\n]/.test(pattern);
    if (unsafe)
      warnings.push(`Ignored unsafe repository-relative pattern: ${pattern.slice(0, 80)}`);
    return !unsafe;
  });
}

export function previewRepositoryAiProfileImport(input: string): RepositoryAiProfileImportPreview {
  const warnings: string[] = [];
  if (Buffer.byteLength(input, 'utf8') > 128 * 1024)
    return { valid: false, warnings: ['Profile exceeds 128 KiB.'] };
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    raw = parsed as Record<string, unknown>;
  } catch {
    return { valid: false, warnings: ['Profile is not a JSON object.'] };
  }
  const terminology: Record<string, string> = {};
  if (raw.terminology && typeof raw.terminology === 'object' && !Array.isArray(raw.terminology)) {
    for (const [key, value] of Object.entries(raw.terminology).slice(0, 100)) {
      if (typeof value === 'string' && key.trim())
        terminology[key.slice(0, 100)] = value.slice(0, 300);
    }
  }
  const profile: RepositoryAiPromptProfile = {
    ...DEFAULT_PROFILE,
    commitPrefixes: strings(raw.commitPrefixes, 50, 40),
    issueIdPattern: typeof raw.issueIdPattern === 'string' ? raw.issueIdPattern.slice(0, 300) : '',
    subjectMaxLength: Number.isInteger(raw.subjectMaxLength)
      ? Math.min(Math.max(Number(raw.subjectMaxLength), 20), 120)
      : 72,
    bodyStyle: typeof raw.bodyStyle === 'string' ? raw.bodyStyle.slice(0, 1_000) : '',
    terminology,
    testPaths: safePatterns(raw.testPaths, warnings),
    generatedPaths: safePatterns(raw.generatedPaths, warnings),
    documentationPaths: safePatterns(raw.documentationPaths, warnings),
    excludedPaths: safePatterns(raw.excludedPaths, warnings),
    requiredReviewQuestions: strings(raw.requiredReviewQuestions, 50, 500),
    enabledDraftTransformations:
      raw.enabledDraftTransformations === undefined
        ? [...DEFAULT_PROFILE.enabledDraftTransformations]
        : strings(raw.enabledDraftTransformations, 8, 40).filter(
            (value): value is AiDraftTransformation => value in TRANSFORMATION_INSTRUCTIONS
          ),
    styleHints: safeStyleHints(raw.styleHints),
    updatedAt: new Date().toISOString(),
  };
  return { valid: true, profile, warnings };
}

export class RepositoryAiProfileStore {
  constructor(private readonly storageDirectory: string) {}
  private get path(): string {
    return join(this.storageDirectory, 'ai-repository-profiles.json');
  }
  private async identity(workingCopyPath: string): Promise<string> {
    const approved = assertPathApprovedForIpc(workingCopyPath, 'Repository AI profile');
    const canonical = await realpath(approved).catch(() => approved);
    return createHash('sha256').update(canonical).digest('hex');
  }
  private async read(): Promise<ProfileFile> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as ProfileFile;
      return parsed.version === 1 && parsed.profiles ? parsed : { version: 1, profiles: {} };
    } catch {
      return { version: 1, profiles: {} };
    }
  }
  async get(workingCopyPath: string): Promise<RepositoryAiPromptProfile | null> {
    return (await this.read()).profiles[await this.identity(workingCopyPath)] ?? null;
  }
  async save(workingCopyPath: string, profile: RepositoryAiPromptProfile): Promise<void> {
    const data = await this.read();
    const preview = previewRepositoryAiProfileImport(JSON.stringify(profile));
    if (!preview.valid || !preview.profile) throw new Error('Repository AI profile is invalid.');
    data.profiles[await this.identity(workingCopyPath)] = preview.profile;
    await writeSecureJson(this.path, data);
  }
  async remove(workingCopyPath: string): Promise<void> {
    const data = await this.read();
    delete data.profiles[await this.identity(workingCopyPath)];
    await writeSecureJson(this.path, data);
  }
}
