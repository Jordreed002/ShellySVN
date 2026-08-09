import { describe, expect, it } from 'vitest';
import {
  aiCommitOutputSchema,
  aiCommitPlanOutputSchema,
  aiConflictProposalOutputSchema,
  aiDiffExplanationOutputSchema,
  aiReleaseNotesOutputSchema,
  aiReviewOutputSchema,
  buildAiProviderArguments,
  formatAiProviderExitError,
  classifyAiProviderError,
  getWindowsNpmShimScriptCandidate,
  parseClaudeAuthStatus,
  parseAiCommitMessageOutput,
  parseAiStructuredOutput,
  prepareDiffForAi,
} from '../ai-commit-message-utils';

describe('AI commit-message diff preparation', () => {
  it('reads only safe Claude CLI authentication status fields', () => {
    expect(
      parseClaudeAuthStatus(
        JSON.stringify({
          loggedIn: true,
          authMethod: 'claude.ai',
          email: 'private@example.com',
          organizationName: 'Private org',
        })
      )
    ).toEqual({ loggedIn: true, authMethod: 'claude.ai' });
    expect(parseClaudeAuthStatus('not json')).toEqual({ loggedIn: false });
  });

  it('requires every structured-output property while allowing an empty body', () => {
    expect(aiCommitOutputSchema()).toMatchObject({
      required: ['subject', 'body'],
      properties: {
        subject: { type: 'string' },
        body: { type: 'string' },
      },
    });
  });

  it('defines strict structured schemas for every SVN assistant workflow', () => {
    for (const schema of [
      aiReviewOutputSchema(),
      aiCommitPlanOutputSchema(),
      aiDiffExplanationOutputSchema(),
      aiReleaseNotesOutputSchema(),
      aiConflictProposalOutputSchema(),
    ]) {
      expect(schema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
      expect(schema.required).toEqual(Object.keys(schema.properties as object));
    }
  });

  it('parses direct and Claude-wrapped structured task results', () => {
    expect(parseAiStructuredOutput('{"summary":"Safe to review","findings":[]}')).toEqual({
      summary: 'Safe to review',
      findings: [],
    });
    expect(
      parseAiStructuredOutput(
        JSON.stringify({ structured_output: { title: 'Release', technical: ['Cache fix'] } })
      )
    ).toEqual({ title: 'Release', technical: ['Cache fix'] });
  });

  it('classifies provider failures without returning stderr or prompt content', () => {
    const stderr = 'user\nprivate source diff\nERROR: {"code":"invalid_json_schema"}';
    const message = formatAiProviderExitError('codex', 1, stderr);

    expect(message).toBe('Codex rejected the commit-message output schema.');
    expect(message).not.toContain('private source diff');
  });

  it('maps provider failures to stable safe error codes', () => {
    expect(classifyAiProviderError('Unauthorized: API key missing')).toBe(
      'authentication_required'
    );
    expect(classifyAiProviderError('rate_limit quota reached')).toBe('quota_exceeded');
    expect(classifyAiProviderError('provider timed out')).toBe('timeout');
    expect(classifyAiProviderError('invalid JSON returned')).toBe('invalid_output');
  });

  it('redacts common credentials before a diff leaves the process', () => {
    const result = prepareDiffForAi(
      'Index: config.env\n--- config.env\n+++ config.env\n+api_key=sk-example-secret-token-123456\n+password="hunter2"\n',
      64 * 1024
    );

    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain('hunter2');
    expect(result.text).not.toContain('sk-example-secret-token-123456');
    expect(result.text).toContain('[REDACTED]');
  });

  it('omits binary sections while retaining selected text changes', () => {
    const result = prepareDiffForAi(
      [
        'Index: src/app.ts\n--- src/app.ts\n+++ src/app.ts\n+const ready = true;\n',
        'Index: assets/logo.png\nCannot display: file marked as a binary type.\n',
      ].join(''),
      64 * 1024
    );

    expect(result.text).toContain('const ready = true');
    expect(result.text).not.toContain('Cannot display');
    expect(result.omittedBinaryFiles).toEqual(['assets/logo.png']);
  });

  it('caps UTF-8 diff bytes without leaving a replacement character', () => {
    const result = prepareDiffForAi(`Index: file.txt\n${'é'.repeat(100)}`, 31);

    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(31);
    expect(result.text).not.toContain('\uFFFD');
    expect(result.truncated).toBe(true);
  });

  it('builds fixed, isolated Codex arguments with no renderer-controlled argv', () => {
    expect(buildAiProviderArguments('codex', '/isolated', '/schema.json', '/output.json')).toEqual([
      'exec',
      '-C',
      '/isolated',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--model',
      'gpt-5.6-luna',
      '-c',
      'approval_policy="never"',
      '-c',
      'web_search="disabled"',
      '--output-schema',
      '/schema.json',
      '--output-last-message',
      '/output.json',
      '-',
    ]);
  });

  it('passes an explicitly selected Codex model', () => {
    const args = buildAiProviderArguments(
      'codex',
      '/isolated',
      '/schema.json',
      '/output.json',
      'gpt-5.6-terra'
    );

    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual([
      '--model',
      'gpt-5.6-terra',
    ]);
  });

  it('parses both direct Codex and wrapped Claude structured output', () => {
    expect(
      parseAiCommitMessageOutput('{"subject":"Fix status cache","body":"Add expiry."}')
    ).toEqual({
      subject: 'Fix status cache',
      body: 'Add expiry.',
    });
    expect(
      parseAiCommitMessageOutput(
        JSON.stringify({ structured_output: { subject: 'Handle conflicts', body: '' } })
      )
    ).toEqual({ subject: 'Handle conflicts', body: undefined });
  });

  it('accepts only local JavaScript targets from standard Windows npm shims', () => {
    const shim =
      '@ECHO off\r\n"%dp0%\\node.exe" "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*';
    expect(getWindowsNpmShimScriptCandidate(shim, 'C:\\Tools\\codex.cmd')).toBe(
      'C:\\Tools\\node_modules\\@openai\\codex\\bin\\codex.js'
    );
    expect(
      getWindowsNpmShimScriptCandidate('"%dp0%\\..\\outside.js" %*', 'C:\\Tools\\codex.cmd')
    ).toBeNull();
    expect(
      getWindowsNpmShimScriptCandidate('arbitrary command', 'C:\\Tools\\codex.cmd')
    ).toBeNull();
  });
});
