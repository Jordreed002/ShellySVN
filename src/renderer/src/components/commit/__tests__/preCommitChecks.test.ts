import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRE_COMMIT_CHECK_CONFIG,
  MAX_FINDINGS_PER_FILE,
  byteLength,
  findInvalidForbiddenPatterns,
  parsePreCommitCheckConfig,
  runPreCommitChecks,
  scanFileSize,
  scanTextContent,
  secretSeverity,
  type PreCommitCheckConfig,
} from '../preCommitChecks';

function configWith(overrides: Partial<PreCommitCheckConfig>): PreCommitCheckConfig {
  return { ...DEFAULT_PRE_COMMIT_CHECK_CONFIG, ...overrides };
}

describe('scanTextContent', () => {
  it('flags console.log and debugger in JS/TS files with line numbers and snippets', () => {
    const findings = scanTextContent(
      '/repo/src/app.ts',
      'const a = 1;\nconsole.log("debug", a);\ndebugger\nexport {};\n',
      configWith({})
    );
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      check: 'debug-leftover',
      file: '/repo/src/app.ts',
      line: 2,
      severity: 'warning',
    });
    expect(findings[0].snippet).toContain('console.log');
    expect(findings[1]).toMatchObject({ check: 'debug-leftover', line: 3 });
  });

  it('flags print and pdb in Python but not console.log in non-code files', () => {
    const py = scanTextContent('/repo/x.py', 'print("hi")\npdb.set_trace()\n', configWith({}));
    expect(py.every((finding) => finding.check === 'debug-leftover')).toBe(true);
    expect(py).toHaveLength(2);

    const txt = scanTextContent('/repo/notes.txt', 'console.log("not code")\n', configWith({}));
    expect(txt.filter((finding) => finding.check === 'debug-leftover')).toHaveLength(0);
  });

  it('flags TODO, FIXME and HACK markers as info severity', () => {
    const findings = scanTextContent(
      '/repo/src/a.ts',
      '// TODO: finish this\n// FIXME broken\n// HACK do not look\nconst x = 1;\n',
      configWith({})
    );
    expect(findings.map((finding) => finding.check)).toEqual([
      'todo-marker',
      'todo-marker',
      'todo-marker',
    ]);
    expect(findings.every((finding) => finding.severity === 'info')).toBe(true);
  });

  it('matches user forbidden patterns and ignores invalid ones', () => {
    const findings = scanTextContent(
      '/repo/src/a.ts',
      'describe.only("skips the rest", () => {});\nfetch("http://internal");\n',
      configWith({ forbiddenPatterns: ['\\.only\\s*\\(', 'http://internal'] })
    );
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.check === 'forbidden-pattern')).toBe(true);

    expect(findInvalidForbiddenPatterns(['ok-\\d+', '([broken'])).toEqual(['([broken']);
  });

  it('skips binary content entirely', () => {
    const findings = scanTextContent('/repo/blob.bin', 'text\u0000console.log(1)', configWith({}));
    expect(findings).toHaveLength(0);
  });

  it('caps findings per file to keep one generated file from flooding the panel', () => {
    const content = Array.from({ length: 200 }, (_, i) => `console.log(${i});`).join('\n');
    const findings = scanTextContent('/repo/src/gen.ts', content, configWith({}));
    expect(findings).toHaveLength(MAX_FINDINGS_PER_FILE);
  });

  it('respects the per-check toggles', () => {
    const content = 'console.log(1); // TODO: remove\n';
    const disabled = configWith({
      toggles: { ...DEFAULT_PRE_COMMIT_CHECK_CONFIG.toggles, debugLeftovers: false },
    });
    const findings = scanTextContent('/repo/a.ts', content, disabled);
    expect(findings.map((finding) => finding.check)).toEqual(['todo-marker']);
  });

  it('truncates long snippets', () => {
    const longLine = `console.log("${'x'.repeat(400)}");`;
    const [finding] = scanTextContent('/repo/a.ts', longLine, configWith({}));
    expect(finding.snippet.length).toBeLessThanOrEqual(161);
    expect(finding.snippet.endsWith('…')).toBe(true);
  });
});

describe('scanFileSize and config parsing', () => {
  it('warns above the threshold only', () => {
    expect(scanFileSize('/repo/a.bin', 5 * 1024 * 1024, 5 * 1024 * 1024)).toBeNull();
    const finding = scanFileSize('/repo/a.bin', 6 * 1024 * 1024, 5 * 1024 * 1024);
    expect(finding).toMatchObject({ check: 'oversized-file', severity: 'warning', file: '/repo/a.bin' });
    expect(finding.message).toContain('6.0 MB');
  });

  it('parses stored config with junk tolerated', () => {
    const parsed = parsePreCommitCheckConfig({
      forbiddenPatterns: ['a+', 'a+', 42, '  b+ '],
      oversizedThresholdBytes: 0,
      toggles: { todoMarkers: false },
    });
    expect(parsed.forbiddenPatterns).toEqual(['a+', 'b+']);
    expect(parsed.oversizedThresholdBytes).toBe(DEFAULT_PRE_COMMIT_CHECK_CONFIG.oversizedThresholdBytes);
    expect(parsed.toggles.todoMarkers).toBe(false);
    expect(parsed.toggles.debugLeftovers).toBe(true);
    expect(parsePreCommitCheckConfig('junk')).toEqual(DEFAULT_PRE_COMMIT_CHECK_CONFIG);
  });

  it('byteLength counts UTF-8 bytes', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('ü')).toBe(2);
  });
});

function fileResult(content: string) {
  return { success: true, content };
}

describe('runPreCommitChecks', () => {
  it('scans fixture files through the fs reader and reports progress', async () => {
    const readFile = vi
      .fn()
      .mockResolvedValueOnce(fileResult('const a = 1;\nconsole.log(a); // TODO cleanup\n'))
      .mockResolvedValueOnce(fileResult('print("legacy")\n'));
    const progressCalls: Array<{ completed: number; total: number }> = [];

    const result = await runPreCommitChecks({
      files: [{ path: '/repo/a.ts' }, { path: '/repo/b.py' }],
      config: configWith({}),
      readFile,
      onProgress: (progress) => progressCalls.push(progress),
    });

    expect(result.scannedFiles).toBe(2);
    expect(result.findings.map((finding) => finding.check).toSorted()).toEqual([
      'debug-leftover',
      'debug-leftover',
      'todo-marker',
    ]);
    expect(result.skipped).toEqual({ directories: 0, unreadable: 0, binary: 0, tooLargeToScan: 0 });
    expect(progressCalls.at(-1)).toEqual({ completed: 2, total: 2 });
    expect(readFile).toHaveBeenCalledWith('/repo/a.ts');
  });

  it('skips directories and binary files, surfaces oversized read failures', async () => {
    const readFile = vi
      .fn()
      .mockResolvedValueOnce({ success: true, content: 'keep\u0000binary' })
      .mockResolvedValueOnce({ success: false, error: 'File too large for preview (>1MB)' })
      .mockResolvedValueOnce({ success: false, error: 'EACCES: permission denied' });

    const result = await runPreCommitChecks({
      files: [
        { path: '/repo/bin.dat', isDirectory: false },
        { path: '/repo/huge.zip' },
        { path: '/repo/locked.txt' },
        { path: '/repo/folder', isDirectory: true },
      ],
      config: configWith({}),
      readFile,
    });

    expect(result.skipped.directories).toBe(1);
    expect(result.skipped.binary).toBe(1);
    expect(result.skipped.unreadable).toBe(1);
    const oversized = result.findings.filter((finding) => finding.check === 'oversized-file');
    expect(oversized).toHaveLength(1);
    expect(oversized[0].file).toBe('/repo/huge.zip');
  });

  it('surfaces server-side secret scan findings with mapped severities', async () => {
    const scanSecrets = vi.fn().mockResolvedValue({
      findings: [
        {
          path: '/repo/a.ts',
          line: 3,
          column: 8,
          patternId: 'aws-access-key',
          severity: 'critical',
          redactedPreview: 'AKIA…',
        },
        {
          path: '/repo/a.ts',
          line: 9,
          column: 1,
          patternId: 'jwt',
          severity: 'low',
          redactedPreview: 'eyJh…',
        },
      ],
      scannedFileCount: 1,
      skippedBinaryCount: 0,
      skippedOversizeCount: 0,
      truncatedLineCount: 0,
      errorFiles: [],
      cancelled: false,
      durationMs: 12,
    });

    const result = await runPreCommitChecks({
      files: [{ path: '/repo/a.ts' }],
      config: configWith({}),
      readFile: vi.fn().mockResolvedValue(fileResult('const x = 1;\n')),
      scanSecrets,
    });

    expect(result.secretScan).toEqual({ ran: true, findingCount: 2, scannedFileCount: 1 });
    const secrets = result.findings.filter((finding) => finding.check === 'secret');
    expect(secrets[0]).toMatchObject({ severity: 'danger', line: 3, snippet: 'AKIA…' });
    expect(secrets[1].severity).toBe('warning');
    expect(scanSecrets).toHaveBeenCalledWith(['/repo/a.ts'], expect.anything());
  });

  it('degrades gracefully when the secret scanner is missing or throws', async () => {
    const missing = await runPreCommitChecks({
      files: [{ path: '/repo/a.ts' }],
      config: configWith({}),
      readFile: vi.fn().mockResolvedValue(fileResult('ok\n')),
    });
    expect(missing.secretScan).toEqual({ ran: false, findingCount: 0 });
    expect(missing.findings).toHaveLength(0);

    const throwing = await runPreCommitChecks({
      files: [{ path: '/repo/a.ts' }],
      config: configWith({}),
      readFile: vi.fn().mockResolvedValue(fileResult('ok\n')),
      scanSecrets: vi.fn().mockRejectedValue(new Error('channel not registered')),
    });
    expect(throwing.secretScan.ran).toBe(true);
    expect(throwing.secretScan.error).toContain('channel not registered');
    expect(throwing.findings).toHaveLength(0);
  });

  it('reports invalid forbidden patterns once per run', async () => {
    const result = await runPreCommitChecks({
      files: [{ path: '/repo/a.ts' }],
      config: configWith({ forbiddenPatterns: ['([broken'] }),
      readFile: vi.fn().mockResolvedValue(fileResult('ok\n')),
    });
    const invalid = result.findings.filter((finding) => finding.check === 'forbidden-pattern');
    expect(invalid).toHaveLength(1);
    expect(invalid[0].severity).toBe('info');
    expect(result.invalidPatterns).toEqual(['([broken']);
  });

  it('supports cancellation between files', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runPreCommitChecks({
      files: [{ path: '/repo/a.ts' }, { path: '/repo/b.ts' }],
      config: configWith({}),
      readFile: vi.fn().mockResolvedValue(fileResult('ok\n')),
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.scannedFiles).toBe(0);
  });
});

describe('secretSeverity', () => {
  it('maps the server scale onto the panel scale', () => {
    expect(secretSeverity('critical')).toBe('danger');
    expect(secretSeverity('high')).toBe('danger');
    expect(secretSeverity('medium')).toBe('warning');
    expect(secretSeverity('low')).toBe('warning');
  });
});
