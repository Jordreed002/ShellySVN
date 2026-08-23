import { describe, expect, it } from 'vitest';
import type { SvnRepoEntry } from '@shared/types';
import {
  describeExportRevision,
  findJunkEntries,
  formatWizardDuration,
  isRepoUrlSource,
  joinRepoUrl,
  normalizeExportRevision,
  parentRepoUrl,
  summarizeRepoEntries,
  ESTIMATE_ENTRY_CAP,
} from '../progressWizard';

function entry(partial: Partial<SvnRepoEntry> & { name: string }): SvnRepoEntry {
  return {
    path: partial.name,
    url: `svn://example.test/repo/${partial.name}`,
    kind: 'file',
    revision: 1,
    author: 'someone',
    date: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('isRepoUrlSource', () => {
  it('recognises common repository URL schemes', () => {
    expect(isRepoUrlSource('svn://example.com/repo/trunk')).toBe(true);
    expect(isRepoUrlSource('https://example.com/svn/repo')).toBe(true);
    expect(isRepoUrlSource('http://example.com/repo')).toBe(true);
    expect(isRepoUrlSource('file:///srv/svn/repo')).toBe(true);
  });

  it('treats local paths as working copies', () => {
    expect(isRepoUrlSource('C:\\Projects\\wc')).toBe(false);
    expect(isRepoUrlSource('/home/me/wc')).toBe(false);
    expect(isRepoUrlSource('./relative')).toBe(false);
    expect(isRepoUrlSource('')).toBe(false);
  });
});

describe('normalizeExportRevision', () => {
  it('maps HEAD to undefined so the IPC omits the revision', () => {
    expect(normalizeExportRevision('head', 'ignored')).toBeUndefined();
  });

  it('maps BASE to the svn keyword', () => {
    expect(normalizeExportRevision('base', '')).toBe('BASE');
  });

  it('passes through positive integers, rejecting anything else', () => {
    expect(normalizeExportRevision('number', '42')).toBe('42');
    expect(normalizeExportRevision('number', ' 42 ')).toBe('42');
    expect(normalizeExportRevision('number', '12a')).toBeNull();
    expect(normalizeExportRevision('number', '-3')).toBeNull();
    expect(normalizeExportRevision('number', '')).toBeNull();
  });
});

describe('describeExportRevision', () => {
  it('labels each pin for the review recap', () => {
    expect(describeExportRevision('head', '')).toBe('HEAD (latest)');
    expect(describeExportRevision('base', '')).toBe('BASE (working copy)');
    expect(describeExportRevision('number', '77')).toBe('r77');
    expect(describeExportRevision('number', 'oops')).toBe('Specific revision');
  });
});

describe('summarizeRepoEntries', () => {
  it('counts only file entries and sums reported sizes', () => {
    const summary = summarizeRepoEntries([
      entry({ name: 'src', kind: 'dir' }),
      entry({ name: 'a.txt', size: 100 }),
      entry({ name: 'b.txt', size: 50 }),
      entry({ name: 'c.txt' }), // size unreported
    ]);
    expect(summary.fileCount).toBe(3);
    expect(summary.totalBytes).toBe(150);
    expect(summary.truncated).toBe(false);
  });

  it('keeps bytes null while no entry reports a size', () => {
    const summary = summarizeRepoEntries([entry({ name: 'a.txt' }), entry({ name: 'b.txt' })]);
    expect(summary.fileCount).toBe(2);
    expect(summary.totalBytes).toBeNull();
  });

  it('flags truncation at the entry cap', () => {
    const entries = Array.from({ length: ESTIMATE_ENTRY_CAP + 50 }, (_, index) =>
      entry({ name: `file-${index}.txt` })
    );
    const summary = summarizeRepoEntries(entries);
    expect(summary.fileCount).toBe(ESTIMATE_ENTRY_CAP);
    expect(summary.truncated).toBe(true);
  });
});

describe('findJunkEntries', () => {
  it('returns only known junk names and preserves their shape', () => {
    const entries = [
      { name: 'node_modules', isDirectory: true, path: '/p/node_modules', size: 0 },
      { name: 'src', isDirectory: true, path: '/p/src', size: 0 },
      { name: '.git', isDirectory: true, path: '/p/.git', size: 0 },
      { name: 'Thumbs.db', isDirectory: false, path: '/p/Thumbs.db', size: 12 },
    ];
    const junk = findJunkEntries(entries);
    expect(junk.map((candidate) => candidate.name)).toEqual(['node_modules', '.git', 'Thumbs.db']);
    expect(junk[0].path).toBe('/p/node_modules');
    expect(junk[2].size).toBe(12);
  });
});

describe('repo URL arithmetic', () => {
  it('joinRepoUrl avoids doubled slashes and trims segments', () => {
    expect(joinRepoUrl('svn://host/repo/', 'trunk')).toBe('svn://host/repo/trunk');
    expect(joinRepoUrl('svn://host/repo', '/trunk/')).toBe('svn://host/repo/trunk');
    expect(joinRepoUrl('svn://host/repo', '')).toBe('svn://host/repo');
  });

  it('parentRepoUrl strips one segment and stops at the root', () => {
    expect(parentRepoUrl('svn://host/repo/trunk')).toBe('svn://host/repo');
    expect(parentRepoUrl('https://host/repo/branches/x/')).toBe('https://host/repo/branches');
    expect(parentRepoUrl('svn://host')).toBeNull();
    expect(parentRepoUrl('notaurl')).toBeNull();
  });
});

describe('formatWizardDuration', () => {
  it('formats milliseconds for completion summaries', () => {
    expect(formatWizardDuration(null)).toBeNull();
    expect(formatWizardDuration(undefined)).toBeNull();
    expect(formatWizardDuration(500)).toBe('500ms');
    expect(formatWizardDuration(1500)).toBe('1.50s');
    expect(formatWizardDuration(90_000)).toBe('1m 30s');
    expect(formatWizardDuration(60_000)).toBe('1m');
  });
});
