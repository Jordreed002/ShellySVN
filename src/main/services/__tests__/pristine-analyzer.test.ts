// @vitest-environment node

import { mkdir, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PRISTINE_SIZE_BUCKETS,
  PRISTINE_VACUUM_ABSOLUTE_THRESHOLD_BYTES,
  PRISTINE_VACUUM_RATIO_THRESHOLD,
  analyzePristineStore,
  evaluatePristineVacuumRecommendation,
} from '../pristine-analyzer';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'shellysvn-pristine-'));
});

function pristinePath(sha1: string): string {
  return join(root, '.svn', 'pristine', sha1.slice(0, 2), `${sha1}.svn-base`);
}

async function writePristine(sha1: string, content: string | Buffer): Promise<void> {
  await mkdir(join(root, '.svn', 'pristine', sha1.slice(0, 2)), { recursive: true });
  await writeFile(pristinePath(sha1), content);
}

async function makeWorkingCopy(options?: { withWcDb?: boolean }): Promise<string> {
  await mkdir(join(root, '.svn', 'pristine'), { recursive: true });
  if (options?.withWcDb !== false) {
    await writeFile(join(root, '.svn', 'wc.db'), 'fake sqlite');
  }
  return root;
}

describe('analyzePristineStore', () => {
  it('reports not-a-working-copy for a plain directory', async () => {
    const result = await analyzePristineStore(root);
    expect(result.available).toBe(false);
    expect(result.unavailableReason).toBe('not_a_working_copy');
    expect(result.totalBytes).toBe(0);
    expect(result.fileCount).toBe(0);
  });

  it('reports a missing pristine store for a working copy without one', async () => {
    await mkdir(join(root, '.svn'), { recursive: true });
    const result = await analyzePristineStore(root);
    expect(result.available).toBe(false);
    expect(result.unavailableReason).toBe('pristine_store_missing');
  });

  it('rejects an empty path', async () => {
    await expect(analyzePristineStore('')).rejects.toThrow('working copy path is required');
  });

  it('aggregates sizes, counts, and histogram buckets', async () => {
    await makeWorkingCopy();
    await writePristine('ab'.padEnd(40, '0'), 'x'.repeat(100)); // 100 B -> < 4 KiB
    await writePristine('cd'.padEnd(40, '1'), 'y'.repeat(8 * 1024)); // 8 KiB -> 4–64 KiB
    await writePristine('ef'.padEnd(40, '2'), 'z'.repeat(100 * 1024)); // 100 KiB -> 64–512 KiB

    const result = await analyzePristineStore(root, { computeWorkingCopySize: false });
    expect(result.available).toBe(true);
    expect(result.fileCount).toBe(3);
    expect(result.totalBytes).toBe(100 + 8 * 1024 + 100 * 1024);
    expect(result.largestFileBytes).toBe(100 * 1024);
    expect(result.largestFiles[0]).toEqual({
      name: join('ef', `ef${'2'.repeat(38)}.svn-base`),
      bytes: 100 * 1024,
    });

    const byLabel = new Map(result.histogram.map((bucket) => [bucket.label, bucket]));
    expect(byLabel.get('< 4 KiB')).toMatchObject({ fileCount: 1, totalBytes: 100 });
    expect(byLabel.get('4 KiB – 64 KiB')).toMatchObject({ fileCount: 1, totalBytes: 8 * 1024 });
    expect(byLabel.get('64 KiB – 512 KiB')).toMatchObject({ fileCount: 1, totalBytes: 100 * 1024 });
    expect(byLabel.get('≥ 16 MiB')).toMatchObject({ fileCount: 0, totalBytes: 0 });
    // Every bucket defined in the constant set appears in the histogram.
    expect(result.histogram.map((bucket) => bucket.label)).toEqual(
      PRISTINE_SIZE_BUCKETS.map((bucket) => bucket.label)
    );
  });

  it('resolves the working-copy root when given a nested path', async () => {
    await makeWorkingCopy();
    await mkdir(join(root, 'sub'), { recursive: true });
    await writePristine('ab'.padEnd(40, '0'),'nested');

    const result = await analyzePristineStore(join(root, 'sub', 'deeper'));
    expect(result.available).toBe(true);
    expect(result.workingCopyPath).toBe(root);
    expect(result.fileCount).toBe(1);
  });

  it('flags malformed and mis-sharded files as definite orphans', async () => {
    await makeWorkingCopy();
    await writePristine('ab'.padEnd(40, '0'), 'a'.repeat(10)); // valid
    await mkdir(join(root, '.svn', 'pristine', 'zz'), { recursive: true });
    await mkdir(join(root, '.svn', 'pristine', 'tmp'), { recursive: true });
    await writeFile(
      join(root, '.svn', 'pristine', 'ab', 'not-a-checksum.svn-base'),
      'b'.repeat(20)
    ); // bad name
    await writeFile(
      join(root, '.svn', 'pristine', 'zz', 'ff'.padEnd(40, '9') + '.svn-base'),
      'c'.repeat(30)
    ); // shard mismatch
    await writeFile(join(root, '.svn', 'pristine', 'tmp', 'leftover'), 'd'.repeat(40)); // tmp leftover

    const result = await analyzePristineStore(root);
    expect(result.fileCount).toBe(4);
    expect(result.orphanEstimate.malformedFileCount).toBe(3);
    expect(result.orphanEstimate.malformedBytes).toBe(20 + 30 + 40);
    expect(result.orphanEstimate.storeOrphaned).toBe(false);
    expect(result.orphanEstimate.limitationNote).toContain('wc.db SQLite');
  });

  it('marks the entire store orphaned when wc.db is gone', async () => {
    await makeWorkingCopy({ withWcDb: false });
    await writePristine('ab'.padEnd(40, '0'),'a'.repeat(10));

    const result = await analyzePristineStore(root);
    expect(result.orphanEstimate.storeOrphaned).toBe(true);
    expect(result.orphanEstimate.limitationNote).toContain('unreferenced');
    expect(result.vacuumRecommendation.recommended).toBe(true);
    expect(result.vacuumRecommendation.reasons).toContain('ORPHANED_STORE');
    expect(result.vacuumRecommendation.confidence).toBe('high');
  });

  it('does not recommend vacuum for a small healthy store', async () => {
    await makeWorkingCopy();
    await writePristine('ab'.padEnd(40, '0'),'tiny');

    const result = await analyzePristineStore(root);
    expect(result.vacuumRecommendation).toEqual({
      recommended: false,
      reasons: [],
      confidence: 'low',
    });
    // Small store: the WC size walk is skipped automatically.
    expect(result.workingCopySize).toBeNull();
  });

  it('recommends vacuum on the ratio heuristic when pristine rivals the WC payload', async () => {
    await makeWorkingCopy();
    // Pristine 10 KiB vs WC payload 10 KiB -> ratio 1.0 ≥ 0.5.
    await writePristine('ab'.padEnd(40, '0'),'p'.repeat(10 * 1024));
    await writeFile(join(root, 'source.ts'), 's'.repeat(10 * 1024));

    const result = await analyzePristineStore(root, { computeWorkingCopySize: true });
    expect(result.workingCopySize).toEqual({ bytes: 10 * 1024, truncated: false });
    expect(result.vacuumRecommendation.recommended).toBe(true);
    expect(result.vacuumRecommendation.reasons).toEqual(['PRISTINE_TO_WC_RATIO']);
    expect(result.vacuumRecommendation.confidence).toBe('medium');
  });

  it('skips .svn directories when measuring working-copy payload size', async () => {
    await makeWorkingCopy();
    await writePristine('ab'.padEnd(40, '0'),'p'.repeat(5 * 1024));
    await writeFile(join(root, 'payload.txt'), 'x'.repeat(2048));

    const result = await analyzePristineStore(root, { computeWorkingCopySize: true });
    expect(result.workingCopySize?.bytes).toBe(2048);
  });

  it('recommends vacuum with high confidence when both absolute and ratio signals fire', () => {
    const recommendation = evaluatePristineVacuumRecommendation(
      PRISTINE_VACUUM_ABSOLUTE_THRESHOLD_BYTES,
      false,
      { bytes: 1, truncated: false }
    );
    expect(recommendation).toEqual({
      recommended: true,
      reasons: ['PRISTINE_ABSOLUTE_SIZE', 'PRISTINE_TO_WC_RATIO'],
      confidence: 'high',
    });
  });

  it('drops ratio confidence when the payload walk was truncated', () => {
    const recommendation = evaluatePristineVacuumRecommendation(
      100,
      false,
      { bytes: 100 / PRISTINE_VACUUM_RATIO_THRESHOLD, truncated: true }
    );
    expect(recommendation.recommended).toBe(true);
    expect(recommendation.reasons).toEqual(['PRISTINE_TO_WC_RATIO']);
    expect(recommendation.confidence).toBe('low');
  });

  it('returns partial aggregates when the signal is already aborted', async () => {
    await makeWorkingCopy();
    // Enough files that a non-aborted scan would count them all.
    const shardDir = join(root, '.svn', 'pristine', 'ab');
    await mkdir(shardDir, { recursive: true });
    await Promise.all(
      Array.from({ length: 400 }, (_, index) =>
        writeFile(join(shardDir, `ab${index.toString(16).padStart(4, '0')}${'0'.repeat(34)}.svn-base`), 'x')
      )
    );

    const controller = new AbortController();
    controller.abort();
    const result = await analyzePristineStore(root, { signal: controller.signal });
    expect(result.cancelled).toBe(true);
    expect(result.available).toBe(true);
    expect(result.fileCount).toBeLessThan(400);
  });

  it('analyzes a 10k-file synthetic store quickly', async () => {
    await makeWorkingCopy();
    const started = Date.now();
    await Promise.all(
      Array.from({ length: 10_000 }, (_, index) => {
        const sha1 = index.toString(16).padStart(40, '0');
        return mkdir(join(root, '.svn', 'pristine', sha1.slice(0, 2)), { recursive: true }).then(
          () => writeFile(pristinePath(sha1), Buffer.alloc(64 + (index % 512), 1)) // shard dir created above
        );
      })
    );
    const fixtureMs = Date.now() - started;

    const analysisStarted = Date.now();
    const result = await analyzePristineStore(root);
    const analysisMs = Date.now() - analysisStarted;

    expect(result.fileCount).toBe(10_000);
    expect(result.cancelled).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.largestFiles).toHaveLength(10);
    expect(result.largestFiles[0].bytes).toBe(64 + 511);
    // Soft perf assertion: analysis must be far cheaper than creating the
    // fixture and comfortably under a 5 s budget on developer hardware.
    expect(analysisMs).toBeLessThan(5_000);
    expect(analysisMs).toBeLessThan(fixtureMs * 4);
    // eslint-disable-next-line no-console -- surfaced for the phase report
    console.log(
      `[perf] pristine analyzer: 10,000 files — fixture ${fixtureMs} ms, analysis ${analysisMs} ms`
    );
  }, 120_000);
});
