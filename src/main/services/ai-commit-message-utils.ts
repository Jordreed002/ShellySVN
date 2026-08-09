import { MAX_COMMIT_MESSAGE_LENGTH } from '@shared/constants';
import type { AiCodexModel, AiCommitProvider, AiErrorCode } from '@shared/types';
import { win32 } from 'node:path';

export interface PreparedAiDiff {
  text: string;
  truncated: boolean;
  omittedBinaryFiles: string[];
  redacted: boolean;
}

export interface StructuredCommitMessage {
  subject: string;
  body?: string;
}

export function parseClaudeAuthStatus(output: string): {
  loggedIn: boolean;
  authMethod?: string;
} {
  try {
    const value = JSON.parse(output) as Record<string, unknown>;
    return {
      loggedIn: value.loggedIn === true,
      authMethod: typeof value.authMethod === 'string' ? value.authMethod.slice(0, 80) : undefined,
    };
  } catch {
    return { loggedIn: false };
  }
}

/** Extract only the local JavaScript entry point emitted by standard npm Windows shims. */
export function getWindowsNpmShimScriptCandidate(source: string, shimPath: string): string | null {
  if (!/\.(?:cmd|bat)$/i.test(shimPath) || Buffer.byteLength(source, 'utf8') > 64 * 1024)
    return null;
  const relativeScript = /%dp0%[\\/]([^"\r\n]+?\.(?:cjs|mjs|js))"/i.exec(source)?.[1];
  if (
    !relativeScript ||
    win32.isAbsolute(relativeScript) ||
    relativeScript.split(/[\\/]+/).includes('..')
  ) {
    return null;
  }
  return win32.resolve(win32.dirname(shimPath), relativeScript);
}

export function redactAiSecrets(input: string): { text: string; redacted: boolean } {
  let redacted = false;
  const replace = (pattern: RegExp, replacement: string): void => {
    input = input.replace(pattern, (...args: unknown[]) => {
      redacted = true;
      const prefix = typeof args[1] === 'string' ? args[1] : '';
      return `${prefix}${replacement}`;
    });
  };

  replace(
    /((?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*["']?)[^\s"']+/gi,
    '[REDACTED]'
  );
  replace(/()(?:sk-[A-Za-z0-9_-]{16,}|gh[opusr]_[A-Za-z0-9_]{20,})/g, '[REDACTED]');
  replace(
    /()(?:-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----)/g,
    '[REDACTED PRIVATE KEY]'
  );
  return { text: input, redacted };
}

function omitBinaryDiffs(diff: string): { text: string; omitted: string[] } {
  const omitted: string[] = [];
  const sections = diff.split(/(?=^Index: |^diff --git )/m);
  const kept = sections.filter((section) => {
    if (!/(?:Cannot display: file marked as a binary type|Binary files .* differ)/i.test(section)) {
      return true;
    }
    const path =
      /^Index:\s+(.+)$/m.exec(section)?.[1] ??
      /^diff --git\s+(?:"?a\/)?(.+?)\s+(?:"?b\/)?/m.exec(section)?.[1] ??
      'binary file';
    omitted.push(path.replace(/^"|"$/g, ''));
    return false;
  });
  return { text: kept.join(''), omitted };
}

function truncateUtf8(input: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(input, 'utf8');
  if (bytes.length <= maxBytes) return { text: input, truncated: false };
  return {
    text: bytes
      .subarray(0, maxBytes)
      .toString('utf8')
      .replace(/\uFFFD$/, ''),
    truncated: true,
  };
}

export function prepareDiffForAi(rawDiff: string, maxBytes: number): PreparedAiDiff {
  const withoutBinary = omitBinaryDiffs(rawDiff);
  const redaction = redactAiSecrets(withoutBinary.text);
  const bounded = truncateUtf8(redaction.text, maxBytes);
  return {
    text: bounded.text,
    truncated: bounded.truncated,
    omittedBinaryFiles: withoutBinary.omitted,
    redacted: redaction.redacted,
  };
}

export function aiCommitOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    // OpenAI structured outputs require every declared property to be listed
    // in `required`. An empty body represents a subject-only commit message.
    required: ['subject', 'body'],
    properties: {
      subject: { type: 'string', minLength: 1, maxLength: 72 },
      body: { type: 'string', maxLength: MAX_COMMIT_MESSAGE_LENGTH - 74 },
    },
  };
}

const boundedString = (maxLength = 4_000): Record<string, unknown> => ({
  type: 'string',
  maxLength,
});

const stringArray = (maxItems = 30): Record<string, unknown> => ({
  type: 'array',
  maxItems,
  items: boundedString(2_000),
});

export function aiReviewOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'findings'],
    properties: {
      summary: boundedString(),
      findings: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'severity',
            'category',
            'title',
            'detail',
            'filePath',
            'line',
            'confidence',
            'evidence',
          ],
          properties: {
            severity: { type: 'string', enum: ['info', 'warning', 'danger'] },
            category: boundedString(80),
            title: boundedString(200),
            detail: boundedString(2_000),
            filePath: boundedString(2_000),
            line: { type: 'integer', minimum: 0 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            evidence: {
              type: 'array',
              maxItems: 10,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['filePath', 'startLine', 'endLine', 'excerpt'],
                properties: {
                  filePath: boundedString(2_000),
                  startLine: { type: 'integer', minimum: 0 },
                  endLine: { type: 'integer', minimum: 0 },
                  excerpt: boundedString(1_000),
                },
              },
            },
          },
        },
      },
    },
  };
}

export function aiCommitPlanOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'groups'],
    properties: {
      summary: boundedString(),
      groups: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'description', 'paths', 'suggestedMessage'],
          properties: {
            title: boundedString(120),
            description: boundedString(1_000),
            paths: stringArray(1_000),
            suggestedMessage: boundedString(MAX_COMMIT_MESSAGE_LENGTH),
          },
        },
      },
    },
  };
}

export function aiDiffExplanationOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'rationale', 'risks', 'reviewQuestions'],
    properties: {
      summary: boundedString(),
      rationale: boundedString(),
      risks: stringArray(20),
      reviewQuestions: stringArray(20),
    },
  };
}

export function aiReleaseNotesOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'userFacing', 'technical', 'breakingChanges', 'upgradeNotes', 'references'],
    properties: {
      title: boundedString(200),
      userFacing: stringArray(100),
      technical: stringArray(100),
      breakingChanges: stringArray(50),
      upgradeNotes: stringArray(50),
      references: stringArray(100),
    },
  };
}

export function aiConflictProposalOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'explanation',
      'likelyIntent',
      'confidence',
      'unresolvedQuestions',
      'proposedMergedText',
    ],
    properties: {
      explanation: boundedString(6_000),
      likelyIntent: boundedString(4_000),
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      unresolvedQuestions: stringArray(20),
      proposedMergedText: boundedString(500_000),
    },
  };
}

export function formatAiProviderExitError(
  provider: AiCommitProvider,
  exitCode: number | null,
  stderr: string
): string {
  const providerName = provider === 'codex' ? 'Codex' : 'Claude';
  const normalized = stderr.toLowerCase();

  if (normalized.includes('invalid_json_schema') || normalized.includes('invalid schema')) {
    return `${providerName} rejected the commit-message output schema.`;
  }
  if (
    normalized.includes('not logged in') ||
    normalized.includes('unauthorized') ||
    normalized.includes('authentication') ||
    normalized.includes('api key')
  ) {
    return `${providerName} authentication failed. Check the CLI sign-in or API credentials.`;
  }
  if (
    normalized.includes('rate limit') ||
    normalized.includes('rate_limit') ||
    normalized.includes('quota') ||
    normalized.includes('usage limit')
  ) {
    return `${providerName} usage or rate limit was reached.`;
  }
  if (
    normalized.includes('network') ||
    normalized.includes('connection') ||
    normalized.includes('certificate') ||
    normalized.includes('dns') ||
    normalized.includes('proxy')
  ) {
    return `${providerName} could not connect to its model service.`;
  }

  return `${providerName} CLI exited with code ${exitCode ?? 'unknown'}.`;
}

export function classifyAiProviderError(message: string): AiErrorCode {
  const normalized = message.toLowerCase();
  if (/cancelled|canceled|signal/.test(normalized)) return 'cancelled';
  if (/timed out|timeout/.test(normalized)) return 'timeout';
  if (/not found|enoent/.test(normalized)) return 'cli_not_found';
  if (/not logged in|unauthorized|authentication|api key|credentials/.test(normalized))
    return 'authentication_required';
  if (/unsupported model|model.*not (?:found|available)|unknown model/.test(normalized))
    return 'unsupported_model';
  if (/rate limit|rate_limit|quota|usage limit/.test(normalized)) return 'quota_exceeded';
  if (/invalid json|invalid_json_schema|invalid schema|structured output/.test(normalized))
    return 'invalid_output';
  if (/safety limit|too large|exceeded.*limit/.test(normalized)) return 'input_too_large';
  if (/network|connection|certificate|dns|proxy|unavailable/.test(normalized))
    return 'provider_unavailable';
  return 'unknown';
}

export function parseAiStructuredOutput(output: string): Record<string, unknown> {
  let value: unknown = JSON.parse(output.trim());
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof value === 'string') {
      value = JSON.parse(value);
      continue;
    }
    if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      if (object.structured_output !== undefined) {
        value = object.structured_output;
        continue;
      }
      if (object.result !== undefined && typeof object.result === 'string') {
        value = object.result;
        continue;
      }
    }
    break;
  }
  if (!value || typeof value !== 'object') throw new Error('AI provider returned invalid JSON.');
  return value as Record<string, unknown>;
}

export function parseAiCommitMessageOutput(output: string): StructuredCommitMessage {
  const value = parseAiStructuredOutput(output);
  const subject = String(value.subject ?? '')
    .split('\0')
    .join('')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  const rawBody = value.body;
  const cleanBody = typeof rawBody === 'string' ? rawBody.split('\0').join('').trim() : '';
  const body = cleanBody || undefined;
  if (!subject || subject.length > 72) throw new Error('AI provider returned an invalid subject.');
  const message = body ? `${subject}\n\n${body}` : subject;
  if (message.length > MAX_COMMIT_MESSAGE_LENGTH) {
    throw new Error('AI provider returned a commit message that is too long.');
  }
  return { subject, body };
}

export function buildAiProviderArguments(
  provider: AiCommitProvider,
  workingDirectory: string,
  schemaPath: string,
  outputPath: string,
  codexModel: AiCodexModel = 'gpt-5.6-luna',
  outputSchema: Record<string, unknown> = aiCommitOutputSchema()
): string[] {
  if (provider === 'codex') {
    return [
      'exec',
      '-C',
      workingDirectory,
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--model',
      codexModel,
      '-c',
      'approval_policy="never"',
      '-c',
      'web_search="disabled"',
      '--output-schema',
      schemaPath,
      '--output-last-message',
      outputPath,
      '-',
    ];
  }
  return [
    '--bare',
    '-p',
    '--tools',
    '',
    '--strict-mcp-config',
    '--disallowed-tools',
    'mcp__*',
    '--no-session-persistence',
    '--max-turns',
    '1',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(outputSchema),
  ];
}
