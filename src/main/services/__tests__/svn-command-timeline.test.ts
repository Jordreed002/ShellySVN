import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginSvnTimelineEntry,
  clearSvnCommandTimeline,
  completeSvnTimelineEntry,
  failSvnTimelineEntry,
  getSvnCommandTimeline,
} from '../svn-command-timeline';

describe('SVN command timeline', () => {
  beforeEach(clearSvnCommandTimeline);

  it('records safe operation metadata without arguments or paths', () => {
    const id = beginSvnTimelineEntry([
      'status',
      '--xml',
      '--',
      '/Users/private/customer-project',
      'https://user:secret@example.test/repo',
    ]);
    completeSvnTimelineEntry(id, Date.now() - 25, { code: 0 });

    const [entry] = getSvnCommandTimeline();
    expect(entry).toMatchObject({
      operation: 'status',
      status: 'success',
      exitCode: 0,
      affectedPathCount: 2,
    });
    expect(JSON.stringify(entry)).not.toContain('customer-project');
    expect(JSON.stringify(entry)).not.toContain('secret');
  });

  it('classifies failures without retaining raw error messages', () => {
    const id = beginSvnTimelineEntry(['update', '/private/wc']);
    failSvnTimelineEntry(id, Date.now(), new Error('Authentication failed for secret URL'));

    expect(getSvnCommandTimeline()[0]).toMatchObject({
      operation: 'update',
      status: 'failed',
      safeDiagnostic: 'authentication',
    });
    expect(JSON.stringify(getSvnCommandTimeline())).not.toContain('secret URL');
  });

  it('records cancellation and supports clearing the bounded timeline', () => {
    const id = beginSvnTimelineEntry(['log']);
    failSvnTimelineEntry(id, Date.now(), new Error('cancelled'), true);
    expect(getSvnCommandTimeline()[0]?.status).toBe('cancelled');
    clearSvnCommandTimeline();
    expect(getSvnCommandTimeline()).toEqual([]);
  });
});
