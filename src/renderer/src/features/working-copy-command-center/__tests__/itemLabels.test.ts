import { describe, expect, it } from 'vitest';
import {
  batchItemCheckedLabel,
  batchItemRevisions,
  batchItemStateLabel,
  batchItemTone,
  isBatchItemBusy,
} from '../itemLabels';
import type { BatchUpdateItem } from '../types';

function item(overrides: Partial<BatchUpdateItem> = {}): BatchUpdateItem {
  return {
    path: '/wc/atlas',
    name: 'atlas',
    selected: false,
    requiresDirtyConfirmation: false,
    status: 'idle',
    filesProcessed: 0,
    ...overrides,
  };
}

describe('batch item labels', () => {
  it('says "Not checked" until someone asks the server, never a confident zero', () => {
    expect(batchItemStateLabel(item())).toBe('Not checked');
    expect(batchItemRevisions(item())).toBe('BASE — → HEAD —');
    expect(batchItemCheckedLabel(item())).toBeNull();
  });

  it('reports incoming revisions and up-to-date checkouts in words', () => {
    const behind = item({
      status: 'ready',
      baseRevision: 10,
      headRevision: 13,
    });
    expect(batchItemStateLabel(behind)).toBe('3 incoming revisions');
    expect(batchItemTone(behind)).toBe('text-svn-modified');
    expect(batchItemRevisions(behind)).toBe('BASE r10 → HEAD r13');
    expect(batchItemStateLabel(item({ status: 'ready', baseRevision: 13, headRevision: 13 }))).toBe(
      'Up to date'
    );
    expect(
      batchItemStateLabel(
        item({
          status: 'ready',
          baseRevision: 1,
          headRevision: 900,
          incomingCount: 500,
          incomingCapped: true,
        })
      )
    ).toBe('500+ incoming revisions');
  });

  it('describes running, finished and failed updates', () => {
    expect(batchItemStateLabel(item({ status: 'running', filesProcessed: 1 }))).toBe(
      'Updating · 1 file'
    );
    expect(batchItemStateLabel(item({ status: 'completed', revision: 14 }))).toBe('Updated to r14');
    expect(batchItemStateLabel(item({ status: 'failed' }))).toBe('Update failed');
    expect(batchItemTone(item({ status: 'failed' }))).toBe('text-svn-conflict');
    expect(isBatchItemBusy(item({ status: 'queued' }))).toBe(true);
    expect(isBatchItemBusy(item({ status: 'ready' }))).toBe(false);
  });

  it('labels the age and source of a measurement', () => {
    const now = 1_000_000;
    expect(
      batchItemCheckedLabel(item({ checkedAt: now - 120_000, measurementSource: 'cached' }), now)
    ).toBe('checked 2m ago · cached');
  });
});
