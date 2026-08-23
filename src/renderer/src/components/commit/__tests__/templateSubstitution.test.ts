import { describe, expect, it, vi, beforeEach } from 'vitest';
import { applyTemplateString, setTemplateContext } from '@renderer/hooks/useCommitTemplates';

/**
 * Template variable substitution (#73b): both `{{var}}` and single-brace
 * `{var}` spellings, the context-fed `issue` variable, and the async
 * `branch` resolver backed by `svn.info`.
 */

describe('applyTemplateString', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTemplateContext({});
  });

  it('substitutes {{date}} and {{time}} style built-ins', async () => {
    const result = await applyTemplateString('committed on {{date}} at {{time}}');
    expect(result).toMatch(/^committed on \d{4}-\d{2}-\d{2} at \d{2}:\d{2}$/);
  });

  it('also substitutes the single-brace {date} spelling', async () => {
    const result = await applyTemplateString('committed on {date}');
    expect(result).toMatch(/^committed on \d{4}-\d{2}-\d{2}$/);
  });

  it('leaves unknown placeholders untouched', async () => {
    const result = await applyTemplateString('{{unknown}} {nope} stays');
    expect(result).toBe('{{unknown}} {nope} stays');
  });

  it('resolves {issue} from the template context set by the commit dialog', async () => {
    setTemplateContext({ issueHint: 'PROJ-77' });
    await expect(applyTemplateString('fix: thing ({{issue}}) and {issue}')).resolves.toBe(
      'fix: thing (PROJ-77) and PROJ-77'
    );

    setTemplateContext({});
    await expect(applyTemplateString('fix: {{issue}}')).resolves.toBe('fix: ');
  });

  it('resolves {branch} from svn info of the context path', async () => {
    const info = vi.fn().mockResolvedValue({ url: 'https://svn.example.com/repo/branches/feature-x' });
    window.api = { svn: { info } } as unknown as Window['api'];
    setTemplateContext({ path: '/repo' });

    await expect(applyTemplateString('[{{branch}}] change')).resolves.toBe(
      '[branches/feature-x] change'
    );
    expect(info).toHaveBeenCalledWith('/repo');
  });

  it('falls back to trunk when svn info fails or lacks a branch', async () => {
    window.api = { svn: { info: vi.fn().mockRejectedValue(new Error('offline')) } } as unknown as Window['api'];
    setTemplateContext({ path: '/repo' });
    await expect(applyTemplateString('[{{branch}}] change')).resolves.toBe('[trunk] change');

    window.api = {
      svn: { info: vi.fn().mockResolvedValue({ url: 'https://svn.example.com/repo/trunk' }) },
    } as unknown as Window['api'];
    await expect(applyTemplateString('[{{branch}}] change')).resolves.toBe('[trunk] change');
  });

  it('lists changed {files} and {filecount} from the context', async () => {
    setTemplateContext({ files: ['/repo/src/a.ts', '/repo/docs/b.md'] });
    await expect(applyTemplateString('{{files}} ({{filecount}})')).resolves.toBe('a.ts, b.md (2)');
  });

  it('applies custom variables after built-ins', async () => {
    const result = await applyTemplateString('{{type}}: {{scope}}', {
      type: 'fix',
      scope: 'ui',
    });
    expect(result).toBe('fix: ui');
  });

  it('does not let a variable name with regex specials break the substitution', async () => {
    const result = await applyTemplateString('{{a+b}} stays', { 'a+b': 'value' });
    expect(result).toBe('value stays');
  });
});
