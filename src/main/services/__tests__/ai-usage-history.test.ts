import { describe, expect, it } from 'vitest';
import type { AiUsageEntry } from '@shared/types';
import { boundedSettings, pruneAiUsageHistory } from '../ai-usage-history';

const NOW = Date.parse('2026-01-15T12:00:00.000Z');
const DAY = 86_400_000;

function entry(overrides: Partial<AiUsageEntry> = {}): AiUsageEntry {
  return {
    id: 'id-' + Math.random().toString(36).slice(2, 8),
    task: 'commit-message',
    provider: 'codex',
    model: 'gpt-5.6-luna',
    startedAt: new Date(NOW - 3_600_000).toISOString(),
    durationMs: 900,
    status: 'success',
    inputBytes: 4096,
    truncated: false,
    redacted: true,
    ...overrides,
  };
}

describe('boundedSettings', () => {
  it('clamps retention and entry caps to sane bounds', () => {
    expect(boundedSettings(30, 200)).toEqual([30, 200]);
    expect(boundedSettings(0, 0)).toEqual([1, 1]);
    expect(boundedSettings(9_999, 99_999)).toEqual([365, 1_000]);
    expect(boundedSettings(Number.NaN, Number.NaN)).toEqual([30, 200]);
    expect(boundedSettings(7.9, 12.9)).toEqual([7, 12]);
  });
});

describe('pruneAiUsageHistory', () => {
  it('keeps recent, well-formed entries and preserves their order', () => {
    const fresh = entry();
    const freshest = entry({ startedAt: new Date(NOW - 60_000).toISOString() });
    const pruned = pruneAiUsageHistory([fresh, freshest], NOW, 30, 200);
    expect(pruned.map((item) => item.id)).toEqual([fresh.id, freshest.id]);
  });

  it('drops entries older than the retention window (#113)', () => {
    const within = entry({ startedAt: new Date(NOW - 29 * DAY).toISOString() });
    const outside = entry({ startedAt: new Date(NOW - 31 * DAY).toISOString() });
    const pruned = pruneAiUsageHistory([within, outside], NOW, 30, 200);
    expect(pruned.map((item) => item.id)).toEqual([within.id]);
  });

  it('caps the number of retained entries', () => {
    const many = Array.from({ length: 10 }, (_unused, index) =>
      entry({ startedAt: new Date(NOW - index * 60_000).toISOString() })
    );
    const pruned = pruneAiUsageHistory(many, NOW, 30, 5);
    expect(pruned).toHaveLength(5);
    // The cap keeps the head of the list — newest entries come first on disk.
    expect(pruned[0]!.id).toBe(many[0]!.id);
  });

  it('rejects malformed or hostile entries instead of trusting them', () => {
    const valid = entry();
    const pruned = pruneAiUsageHistory(
      [
        valid,
        null,
        'string',
        42,
        { ...entry(), task: 'exfiltrate' },
        { ...entry(), provider: 'evil' },
        { ...entry(), status: 'pending' },
        { ...entry(), startedAt: 'not-a-date' },
        { ...entry(), durationMs: -5 },
        { ...entry(), inputBytes: Number.NaN },
        { ...entry(), id: undefined },
      ],
      NOW
    );
    expect(pruned).toHaveLength(1);
    expect(pruned[0]!.id).toBe(valid.id);
  });

  it('returns an empty list for non-array input', () => {
    expect(pruneAiUsageHistory(undefined, NOW)).toEqual([]);
    expect(pruneAiUsageHistory({}, NOW)).toEqual([]);
  });

  it('honors caller-provided settings clamped through boundedSettings', () => {
    const twoDaysOld = entry({ startedAt: new Date(NOW - 2 * DAY).toISOString() });
    const oneHourOld = entry({ startedAt: new Date(NOW - 3_600_000).toISOString() });
    expect(pruneAiUsageHistory([twoDaysOld], NOW, 1, 200)).toHaveLength(0);
    expect(pruneAiUsageHistory([twoDaysOld], NOW, 3, 200)).toHaveLength(1);
    // Out-of-range settings fall back to the defaults (30 days / 200 entries),
    // so a fresh entry survives while the stale one does not.
    expect(pruneAiUsageHistory([oneHourOld, twoDaysOld], NOW, 0, -1)).toEqual([oneHourOld]);
  });
});
