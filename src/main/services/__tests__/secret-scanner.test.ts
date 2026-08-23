// @vitest-environment node

import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BLOCKING_SEVERITIES,
  countSeverities,
  scanFilesForSecrets,
  scanTextForSecrets,
} from '../secret-scanner';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'shellysvn-secrets-'));
});

describe('scanTextForSecrets (pure pattern engine)', () => {
  it('detects AWS access keys as critical', () => {
    const findings = scanTextForSecrets('aws_key = AKIAIOSFODNN7EXAMPLE\nconst clean = 1;\n');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      line: 1,
      column: 11,
      patternId: 'aws-access-key',
      severity: 'critical',
    });
    expect(findings[0].redactedPreview).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('detects GitHub and GitLab tokens as high', () => {
    const findings = scanTextForSecrets(
      'GITHUB=ghp_16C7e42F292c6912E7710c838347Ae178B4a\nGITLAB_TOKEN=glpat-AbCdEfGhIjKlMnOpQrSt\n'
    );
    expect(findings.map((finding) => finding.patternId)).toEqual(['github-token', 'gitlab-token']);
    expect(new Set(findings.map((finding) => finding.severity))).toEqual(new Set(['high']));
  });

  it('detects private key headers as critical without echoing the header', () => {
    const findings = scanTextForSecrets(
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\n'
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ line: 1, patternId: 'private-key-header', severity: 'critical' });
    expect(findings[0].redactedPreview).toBe('-----BEGIN … PRIVATE KEY-----');
  });

  it('detects generic api_key/password/secret assignments with literal values', () => {
    const text = [
      'api_key = "sk_live_51H8xKzEqLrXR7d8f"', // quoted
      "password: hunter2secure", // yaml-ish unquoted
      'MY_SECRET_TOKEN := tpl_9f8e7d6c5b4a3210', // shell style
      'client_secret=qwertyuiopasd', // no spaces
    ].join('\n');
    const findings = scanTextForSecrets(text);
    expect(findings).toHaveLength(4);
    expect(findings.every((finding) => finding.patternId === 'secret-assignment')).toBe(true);
    expect(findings.every((finding) => finding.severity === 'medium')).toBe(true);
    for (const finding of findings) {
      expect(finding.redactedPreview).not.toMatch(/sk_live_51H8xKzEqLrXR7d8f|hunter2secure|tpl_9f8e7d6c5b4a3210|qwertyuiopasd/);
    }
  });

  it('ignores env refs, placeholders, and non-secret assignment values', () => {
    const text = [
      'password = $DATABASE_PASSWORD',
      'password = ${DB_PASS}',
      'api_key = process.env.API_KEY',
      'secret_token = None',
      'password = "********"',
      'api_key: <your-api-key>',
      'password = "changeme"',
      'timeout = 300000',
      'version = 1.2.3',
      'docs_url = https://example.com/docs',
      'user_password = true',
    ].join('\n');
    expect(scanTextForSecrets(text)).toEqual([]);
  });

  it('flags high-entropy literals as low severity and skips benign long tokens', () => {
    const entropySecret = 'aX9kQ2mP7zR4tY6uJ3wE5vB8nC1dF6gH'; // no keyword, no token shape
    const findings = scanTextForSecrets(
      [
        `blob = ${entropySecret}`, // long mixed token, no secret-named assignment
        'uuid = 123e4567-e89b-12d3-a456-426614174000', // UUID
        'sha = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // sha256 content hash
        'sentence = The quick brown fox jumps over the lazy dog again and again',
      ].join('\n')
    );
    const entropyFindings = findings.filter((finding) => finding.patternId === 'high-entropy-string');
    expect(entropyFindings).toHaveLength(1);
    expect(entropyFindings[0].severity).toBe('low');
    expect(findings.some((finding) => finding.redactedPreview.includes('123e4567'))).toBe(false);
  });

  it('does not double-report a known token as high entropy', () => {
    const findings = scanTextForSecrets('key AKIAIOSFODNN7EXAMPLE here');
    expect(findings.map((finding) => finding.patternId)).toEqual(['aws-access-key']);
  });

  it('redacts previews to at most a four-character prefix', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    const [finding] = scanTextForSecrets(secret);
    // "AKIA" prefix + ellipsis + length marker only.
    expect(finding.redactedPreview).toBe('AKIA…(20 chars)');
    const [short] = scanTextForSecrets('pwd_value = abc123secret');
    expect(short.redactedPreview).toBe('pwd_value=abc1…(12 chars)');
  });
});

describe('scanFilesForSecrets (filesystem pipeline)', () => {
  it('scans files and reports per-finding paths and line numbers', async () => {
    const config = join(root, 'config.env');
    const clean = join(root, 'clean.ts');
    await writeFile(config, 'OK=1\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI\n');
    await writeFile(clean, 'export const fine = 42;\n');

    const result = await scanFilesForSecrets([config, clean]);
    expect(result.cancelled).toBe(false);
    expect(result.scannedFileCount).toBe(2);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      path: config,
      line: 2,
      patternId: 'secret-assignment',
    });
    expect(result.errorFiles).toEqual([]);
  });

  it('skips binary files via the NUL-byte sniff', async () => {
    const binary = join(root, 'blob.bin');
    await writeFile(binary, Buffer.from([0x50, 0x4b, 0x00, 0x03, 0x04, 0x41, 0x4b, 0x49, 0x41]));
    const result = await scanFilesForSecrets([binary]);
    expect(result.scannedFileCount).toBe(0);
    expect(result.skippedBinaryCount).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it('skips files above the size cap and counts them', async () => {
    const big = join(root, 'big.log');
    await writeFile(big, 'a'.repeat(4096));
    const result = await scanFilesForSecrets([big], { maxFileBytes: 1024 });
    expect(result.skippedOversizeCount).toBe(1);
    expect(result.scannedFileCount).toBe(0);
  });

  it('streams large files line-by-line and still finds secrets near the end', async () => {
    const large = join(root, 'large.txt');
    const filler = 'line of ordinary text without secrets\n'.repeat(12_000); // > 256 KiB inline cap
    const secretLine = 'deploy_token = dpl_9f8e7d6c5b4a3210fedc\n';
    await writeFile(large, filler + secretLine);

    const result = await scanFilesForSecrets([large]);
    expect(result.scannedFileCount).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      path: large,
      patternId: 'secret-assignment',
      line: 12_001,
    });
  }, 30_000);

  it('collects per-file errors instead of throwing', async () => {
    const missing = join(root, 'does-not-exist.env');
    const present = join(root, 'present.env');
    await writeFile(present, 'password = supersecretvalue\n');
    const result = await scanFilesForSecrets([missing, present, '']);
    expect(result.errorFiles).toEqual([
      { path: missing, error: expect.stringContaining('ENOENT') },
    ]);
    expect(result.scannedFileCount).toBe(1);
  });

  it('returns partial results when the abort signal fires before the set completes', async () => {
    const a = join(root, 'a.env');
    const b = join(root, 'b.env');
    await writeFile(a, 'password = firstsecretvalue\n');
    await writeFile(b, 'password = secondsecretvalue\n');

    const controller = new AbortController();
    controller.abort();
    const result = await scanFilesForSecrets([a, b], { signal: controller.signal });
    expect(result.cancelled).toBe(true);
    expect(result.scannedFileCount).toBe(0);
  });

  it('caps findings per file to bound result size', async () => {
    const noisy = join(root, 'noisy.env');
    await writeFile(
      noisy,
      Array.from({ length: 100 }, (_, index) => `password = value${index}secret`).join('\n')
    );
    const result = await scanFilesForSecrets([noisy], { maxFindingsPerFile: 10 });
    expect(result.findings).toHaveLength(10);
  });

  it('exposes a suggested blocking policy constant', () => {
    expect(DEFAULT_BLOCKING_SEVERITIES).toEqual(['critical', 'high']);
    expect(countSeverities([
      { path: '', line: 1, column: 1, patternId: 'jwt', severity: 'high', redactedPreview: 'x' },
      { path: '', line: 2, column: 1, patternId: 'jwt', severity: 'high', redactedPreview: 'y' },
      { path: '', line: 3, column: 1, patternId: 'secret-assignment', severity: 'medium', redactedPreview: 'z' },
    ])).toEqual({ critical: 0, high: 2, medium: 1, low: 0 });
  });

  it('completes a 10k-file synthetic changeset quickly', async () => {
    const paths: string[] = [];
    // 10k files: ~9.9k clean, ~100 carrying one secret each.
    for (let index = 0; index < 10_000; index += 1) {
      const path = join(root, `file-${index}.ts`);
      const hasSecret = index % 100 === 0;
      const body = hasSecret
        ? `const config = {\n  api_key: "sk_test_${index.toString(36)}${'x'.repeat(18)}",\n};\n`
        : `export const value${index} = ${index};\nconsole.log(value${index});\n`;
      await writeFile(path, body);
      paths.push(path);
    }

    const started = Date.now();
    const result = await scanFilesForSecrets(paths);
    const durationMs = Date.now() - started;

    expect(result.scannedFileCount).toBe(10_000);
    expect(result.findings).toHaveLength(100);
    expect(result.findings.every((finding) => finding.patternId === 'secret-assignment')).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(durationMs).toBeLessThan(10_000);
    // eslint-disable-next-line no-console -- surfaced for the phase report
    console.log(
      `[perf] secret scanner: 10,000 files, 100 findings — ${durationMs} ms (${Math.round(
        result.scannedFileCount / Math.max(durationMs / 1000, 0.001)
      )} files/s)`
    );
  }, 120_000);
});
