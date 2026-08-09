import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCommitTemplates } from '../src/hooks/useCommitTemplates';

describe('useCommitTemplates', () => {
  const storeApi = {
    get: vi.fn(),
    set: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storeApi.get.mockResolvedValue([]);
    storeApi.set.mockResolvedValue(undefined);
    window.api = {
      store: storeApi,
      svn: {
        info: vi.fn().mockResolvedValue({ url: 'https://svn.example.com/repo/trunk' }),
      },
    } as unknown as Window['api'];
  });

  it('creates, edits, applies, and deletes commit templates', async () => {
    const { result } = renderHook(() => useCommitTemplates());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let templateId = '';
    await act(async () => {
      const template = await result.current.addTemplate({
        name: 'Ticket',
        description: 'Ticket template',
        template: 'fix({{ticket}}): {{description}}',
      });
      templateId = template.id;
    });

    await waitFor(() => {
      expect(result.current.templates.some((template) => template.id === templateId)).toBe(true);
    });

    await act(async () => {
      await result.current.updateTemplate(templateId, {
        name: 'Ticket Fix',
        template: 'fix({{ticket}}): {{summary}}',
      });
    });

    const applied = await result.current.applyTemplate(templateId, {
      ticket: 'SVN-123',
      summary: 'repair checkout',
    });
    expect(applied).toBe('fix(SVN-123): repair checkout');

    await act(async () => {
      await result.current.deleteTemplate(templateId);
    });

    expect(result.current.templates.some((template) => template.id === templateId)).toBe(false);
    expect(storeApi.set).toHaveBeenCalledWith('shellysvn-commit-templates', expect.any(Array));
  });
});
