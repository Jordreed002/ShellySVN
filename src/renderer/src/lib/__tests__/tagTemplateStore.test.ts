import { describe, expect, it, vi } from 'vitest';

import {
  MAX_RECENT_TAG_TEMPLATES,
  TAG_TEMPLATES_KEY,
  loadRecentTagTemplates,
  parseRecentTagTemplates,
  recordRecentTagTemplate,
  saveRecentTagTemplates,
} from '../tagTemplateStore';

describe('parseRecentTagTemplates', () => {
  it('accepts a well-formed payload in order', () => {
    expect(
      parseRecentTagTemplates([
        { template: 'release/{version}', usedAt: 10 },
        { template: '{version}', usedAt: 5 },
      ])
    ).toEqual([
      { template: 'release/{version}', usedAt: 10 },
      { template: '{version}', usedAt: 5 },
    ]);
  });

  it('rejects junk payloads', () => {
    expect(parseRecentTagTemplates(undefined)).toEqual([]);
    expect(parseRecentTagTemplates(null)).toEqual([]);
    expect(parseRecentTagTemplates('nope')).toEqual([]);
    expect(parseRecentTagTemplates([{ template: 42 }, {}, { template: '  ' }])).toEqual([]);
  });

  it('tolerates missing usedAt and dedupes', () => {
    expect(
      parseRecentTagTemplates([
        { template: 'a/{version}' },
        { template: 'a/{version}', usedAt: 2 },
      ])
    ).toEqual([{ template: 'a/{version}', usedAt: 0 }]);
  });

  it('caps the list length', () => {
    const many = Array.from({ length: MAX_RECENT_TAG_TEMPLATES + 4 }, (_, index) => ({
      template: `t${index}`,
      usedAt: index,
    }));
    expect(parseRecentTagTemplates(many)).toHaveLength(MAX_RECENT_TAG_TEMPLATES);
  });
});

describe('recordRecentTagTemplate', () => {
  it('moves a reused template to the front without duplicates', () => {
    const list = [
      { template: 'a', usedAt: 1 },
      { template: 'b', usedAt: 2 },
    ];
    const next = recordRecentTagTemplate(list, 'a', 99);
    expect(next).toEqual([
      { template: 'a', usedAt: 99 },
      { template: 'b', usedAt: 2 },
    ]);
  });

  it('ignores blank templates', () => {
    const list = [{ template: 'a', usedAt: 1 }];
    expect(recordRecentTagTemplate(list, '   ')).toEqual(list);
  });
});

describe('store round-trips', () => {
  it('loads and saves through window.api.store', async () => {
    const get = vi.fn().mockResolvedValue([{ template: 'release/{version}', usedAt: 7 }]);
    const set = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { store: { get, set } },
    });

    await expect(loadRecentTagTemplates()).resolves.toEqual([
      { template: 'release/{version}', usedAt: 7 },
    ]);
    expect(get).toHaveBeenCalledWith(TAG_TEMPLATES_KEY);

    const list = [{ template: 'x', usedAt: 1 }];
    await saveRecentTagTemplates(list);
    expect(set).toHaveBeenCalledWith(TAG_TEMPLATES_KEY, list);
  });

  it('degrades to an empty list when storage fails', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        store: {
          get: vi.fn().mockRejectedValue(new Error('store locked')),
        },
      },
    });
    await expect(loadRecentTagTemplates()).resolves.toEqual([]);
  });
});
