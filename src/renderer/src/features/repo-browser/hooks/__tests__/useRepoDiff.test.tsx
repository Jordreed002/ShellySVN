/**
 * The comparand → SVN-call mapping.
 *
 * Getting this wrong does not throw: it renders a confident diff that answers a
 * different question. So every comparand is pinned to the exact call and the
 * exact arguments it must produce.
 */

import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Comparand } from '../../types';
import { planRepoDiff, repoDiffPlanKey, useRepoDiff } from '../useRepoDiff';

const URL = 'https://svn.example.com/repo/branches/feature';
const WC = '/Users/dev/wc/feature';

const diff = vi.fn();
const diffUrls = vi.fn();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  diff.mockResolvedValue({ files: [], hasChanges: false });
  diffUrls.mockResolvedValue({ files: [], hasChanges: false });
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { svn: { diff, diffUrls } },
  });
});

describe('planRepoDiff', () => {
  it('maps wc-base to svn.diff with no revision, so it stays BASE↔working', () => {
    const plan = planRepoDiff(URL, 'wc-base', WC, { baseRevision: 4821 });

    expect(plan).toMatchObject({ call: 'diff', path: WC });
    // Critical: `svn.diff(path, revision)` builds `-c revision`, not `-r`.
    // Any revision here silently changes the question being asked.
    expect(plan.call === 'diff' && plan.revision).toBeUndefined();
    expect(plan.label).toBe('working copy ↔ BASE r4821');
  });

  it('reports wc-head as unsupported rather than misusing -c HEAD', () => {
    const plan = planRepoDiff(URL, 'wc-head', WC, { baseRevision: 4821 });

    expect(plan.call).toBe('unsupported');
    expect(plan.call === 'unsupported' && plan.unsupported.capability).toBe('diff:wc-head');
    expect(plan.call === 'unsupported' && plan.unsupported.command).toBe(
      `svn diff -r HEAD "${WC}"`
    );
  });

  it('maps base-head to diffUrls between the pegged BASE and HEAD', () => {
    const plan = planRepoDiff(URL, 'base-head', WC, { baseRevision: 4821 });

    expect(plan).toMatchObject({
      call: 'diffUrls',
      leftUrl: `${URL}@4821`,
      rightUrl: `${URL}@HEAD`,
    });
    expect(plan.consequence).toContain('your edits are not in this diff');
  });

  it('maps branch-trunk to diffUrls between the two paths, comparison first', () => {
    const other = 'https://svn.example.com/repo/trunk';
    const plan = planRepoDiff(URL, 'branch-trunk', WC, { compareUrl: other });

    expect(plan).toMatchObject({ call: 'diffUrls', leftUrl: other, rightUrl: URL });
  });

  it('maps rev-rev to diffUrls between two pegged revisions', () => {
    const plan = planRepoDiff(URL, 'rev-rev', null, { leftRevision: 4000, rightRevision: 4821 });

    expect(plan).toMatchObject({
      call: 'diffUrls',
      leftUrl: `${URL}@4000`,
      rightUrl: `${URL}@4821`,
    });
    expect(plan.label).toBe('r4000 ↔ r4821');
  });

  describe('missing inputs are unsupported states, not errors', () => {
    const cases: Array<[Comparand, Parameters<typeof planRepoDiff>[3], string]> = [
      ['wc-base', {}, 'diff:wc-base'],
      ['base-head', {}, 'diff:base-head'],
      ['branch-trunk', {}, 'diff:branch-trunk'],
      ['rev-rev', { leftRevision: 4000 }, 'diff:rev-rev'],
    ];

    it.each(cases)('%s without its inputs reports %s', (comparand, inputs, capability) => {
      const plan = planRepoDiff(URL, comparand, null, inputs);
      expect(plan.call).toBe('unsupported');
      expect(plan.call === 'unsupported' && plan.unsupported.capability).toBe(capability);
    });
  });

  it('gives each plan a distinct query key so comparands never share a cache slot', () => {
    const keys = (['wc-base', 'wc-head', 'base-head', 'branch-trunk', 'rev-rev'] as const).map(
      (comparand) =>
        JSON.stringify(
          repoDiffPlanKey(
            planRepoDiff(URL, comparand, WC, {
              baseRevision: 4821,
              compareUrl: 'https://svn.example.com/repo/trunk',
              leftRevision: 4000,
              rightRevision: 4821,
            })
          )
        )
    );

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('useRepoDiff', () => {
  it('calls svn.diff for wc-base and never svn.diffUrls', async () => {
    renderHook(() => useRepoDiff(URL, 'wc-base', WC, { baseRevision: 4821 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(diff).toHaveBeenCalledTimes(1));
    expect(diff).toHaveBeenCalledWith(
      WC,
      undefined,
      expect.objectContaining({ signal: expect.anything() })
    );
    expect(diffUrls).not.toHaveBeenCalled();
  });

  it('calls svn.diffUrls for base-head and never svn.diff', async () => {
    renderHook(() => useRepoDiff(URL, 'base-head', WC, { baseRevision: 4821 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(diffUrls).toHaveBeenCalledTimes(1));
    expect(diffUrls).toHaveBeenCalledWith(
      `${URL}@4821`,
      `${URL}@HEAD`,
      expect.objectContaining({ signal: expect.anything() })
    );
    expect(diff).not.toHaveBeenCalled();
  });

  it('runs no SVN call at all for wc-head and surfaces the unsupported state', async () => {
    const { result } = renderHook(() => useRepoDiff(URL, 'wc-head', WC, { baseRevision: 4821 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.unsupported).not.toBeNull());
    expect(result.current.unsupported?.capability).toBe('diff:wc-head');
    expect(result.current.loading).toBe(false);
    expect(result.current.hunks).toEqual([]);
    expect(diff).not.toHaveBeenCalled();
    expect(diffUrls).not.toHaveBeenCalled();
  });

  it('flattens every file’s hunks for DiffView and reports binary files', async () => {
    diff.mockResolvedValue({
      hasChanges: true,
      files: [
        {
          oldPath: 'a',
          newPath: 'a',
          hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [] }],
        },
        {
          oldPath: 'b',
          newPath: 'b',
          hunks: [{ oldStart: 5, oldLines: 0, newStart: 5, newLines: 1, lines: [] }],
        },
      ],
    });

    const { result } = renderHook(() => useRepoDiff(URL, 'wc-base', WC, {}), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.hunks).toHaveLength(2));
    expect(result.current.isBinary).toBe(false);
    expect(result.current.files).toHaveLength(2);
  });

  it('treats an error field on a resolved diff as an error, not an empty diff', async () => {
    diff.mockResolvedValue({
      files: [],
      hasChanges: false,
      error: 'svn: E155007: not a working copy',
    });

    const { result } = renderHook(() => useRepoDiff(URL, 'wc-base', WC, {}), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).toContain('E155007'));
    expect(result.current.hunks).toEqual([]);
  });
});
