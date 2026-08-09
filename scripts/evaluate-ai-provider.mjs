import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.env.SHELLYSVN_RUN_AI_EVALS !== '1') {
  console.error('Real-provider evaluation is disabled. Set SHELLYSVN_RUN_AI_EVALS=1 explicitly.');
  process.exit(2);
}
if (process.env.CI) {
  console.error('Real-provider evaluation is intentionally disabled in CI and release automation.');
  process.exit(2);
}

const provider = process.env.SHELLYSVN_AI_EVAL_PROVIDER === 'claude' ? 'claude' : 'codex';
const fixtures = JSON.parse(
  await readFile(join(process.cwd(), 'tests/fixtures/ai-quality/fixtures.json'), 'utf8')
);
const focused = fixtures.fixtures.find((fixture) => fixture.id === 'focused-change');
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'body'],
  properties: {
    subject: { type: 'string', minLength: 1, maxLength: 72 },
    body: { type: 'string', maxLength: 4000 },
  },
};
const prompt = `This is a synthetic quality fixture, not repository data. Write a structured commit message. Never run tools.\n<synthetic_diff>\n${focused.diff}\n</synthetic_diff>`;
const directory = await mkdtemp(join(tmpdir(), 'shellysvn-ai-eval-'));
const schemaPath = join(directory, 'schema.json');
const outputPath = join(directory, 'output.json');
await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });

const command = provider === 'codex' ? 'codex' : 'claude';
const args =
  provider === 'codex'
    ? [
        'exec',
        '-C',
        directory,
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '--model',
        process.env.SHELLYSVN_AI_EVAL_MODEL || 'gpt-5.6-luna',
        '-c',
        'approval_policy="never"',
        '-c',
        'web_search="disabled"',
        '--output-schema',
        schemaPath,
        '--output-last-message',
        outputPath,
        '-',
      ]
    : [
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
        JSON.stringify(schema),
      ];

try {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: directory,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Provider evaluation timed out.'));
    }, 90_000);
    child.stdout.on('data', (chunk) => {
      if (stdout.length < 128_000) stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 8_000) stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(`${provider} evaluation failed with exit code ${code}. ${stderr.slice(-500)}`)
        );
    });
    child.stdin.end(prompt);
  });
  const raw = provider === 'codex' ? await readFile(outputPath, 'utf8') : result;
  let parsed = JSON.parse(raw);
  if (parsed.structured_output) parsed = parsed.structured_output;
  if (typeof parsed.result === 'string') parsed = JSON.parse(parsed.result);
  if (
    typeof parsed.subject !== 'string' ||
    !parsed.subject ||
    parsed.subject.length > 72 ||
    typeof parsed.body !== 'string'
  )
    throw new Error('Provider output failed the deterministic commit schema checks.');
  console.log(
    JSON.stringify(
      {
        provider,
        model: process.env.SHELLYSVN_AI_EVAL_MODEL || undefined,
        fixture: focused.id,
        passed: true,
        subjectLength: parsed.subject.length,
      },
      null,
      2
    )
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
