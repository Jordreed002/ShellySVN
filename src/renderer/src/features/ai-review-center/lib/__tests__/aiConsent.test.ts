import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_CONSENT_STORE_KEY,
  clearAiConsent,
  mergeAiConsentEntry,
  parseAiConsentMap,
  readAiConsent,
  removeAiConsentEntry,
  writeAiConsent,
} from '../aiConsent';

function mockStore(initial: unknown = undefined) {
  let value = initial;
  const get = vi.fn().mockImplementation(() => Promise.resolve(value));
  const set = vi.fn().mockImplementation((_key: string, next: unknown) => {
    value = next;
    return Promise.resolve();
  });
  const delete_ = vi.fn().mockResolvedValue(undefined);
  window.api = { store: { get, set, delete: delete_ } } as unknown as Window['api'];
  return { get, set, delete: delete_ };
}

describe('parseAiConsentMap', () => {
  it('keeps only valid entries and rejects junk', () => {
    const map = parseAiConsentMap({
      '/wc/a': { aiEnabled: true, updatedAt: '2026-01-01T00:00:00.000Z' },
      '/wc/b': { aiEnabled: 'yes', updatedAt: '2026-01-01T00:00:00.000Z' },
      '/wc/c': null,
      '': { aiEnabled: false, updatedAt: 'x' },
    });
    expect(Object.keys(map)).toEqual(['/wc/a']);
  });

  it('returns an empty map for non-object store values', () => {
    expect(parseAiConsentMap(undefined)).toEqual({});
    expect(parseAiConsentMap([])).toEqual({});
    expect(parseAiConsentMap('nope')).toEqual({});
  });
});

describe('consent map writers', () => {
  it('merges one entry without clobbering others', () => {
    const base = { '/wc/a': { aiEnabled: true, updatedAt: '2026-01-01T00:00:00.000Z' } };
    const next = mergeAiConsentEntry(base, '/wc/b', false, new Date('2026-02-01T00:00:00.000Z'));
    expect(next['/wc/a']).toEqual(base['/wc/a']);
    expect(next['/wc/b']).toEqual({ aiEnabled: false, updatedAt: '2026-02-01T00:00:00.000Z' });
    // Removal returns to "Not set" only for the target root.
    const removed = removeAiConsentEntry(next, '/wc/b');
    expect('/wc/b' in removed).toBe(false);
    expect(removed['/wc/a']).toEqual(base['/wc/a']);
    expect(removeAiConsentEntry(base, '/wc/missing')).toBe(base);
  });
});

describe('consent persistence via window.api.store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads undefined for a working copy with no entry', async () => {
    const store = mockStore({ '/other': { aiEnabled: true, updatedAt: 'x' } });
    await expect(readAiConsent('/wc/mine')).resolves.toBeUndefined();
    expect(store.get).toHaveBeenCalledWith(AI_CONSENT_STORE_KEY);
  });

  it('writes with get-merge-set under the versioned key', async () => {
    const store = mockStore({ '/other': { aiEnabled: true, updatedAt: 'x' } });
    const entry = await writeAiConsent('/wc/mine', true);
    expect(entry.aiEnabled).toBe(true);
    expect(store.set).toHaveBeenCalledTimes(1);
    const [key, value] = store.set.mock.calls[0]! as [string, Record<string, unknown>];
    expect(key).toBe('shellysvn:ai-consent:v1');
    expect(value['/other']).toEqual({ aiEnabled: true, updatedAt: 'x' });
    expect(value['/wc/mine']).toMatchObject({ aiEnabled: true });
    await expect(readAiConsent('/wc/mine')).resolves.toMatchObject({ aiEnabled: true });
  });

  it('clears a single working copy back to Not set', async () => {
    mockStore({
      '/wc/mine': { aiEnabled: false, updatedAt: 'x' },
      '/other': { aiEnabled: true, updatedAt: 'x' },
    });
    await clearAiConsent('/wc/mine');
    await expect(readAiConsent('/wc/mine')).resolves.toBeUndefined();
    await expect(readAiConsent('/other')).resolves.toMatchObject({ aiEnabled: true });
  });

  it('prefers the dedicated consent IPC when present, with store fallback on failure', async () => {
    const store = mockStore(undefined);
    const consentGet = vi
      .fn()
      .mockResolvedValueOnce({ aiEnabled: true, updatedAt: '2026-03-01T00:00:00.000Z' })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('ipc down'));
    const consentSet = vi.fn().mockResolvedValue({ success: true });
    window.api = {
      store: store,
      ai: { consent: { get: consentGet, set: consentSet } },
    } as unknown as Window['api'];

    await expect(readAiConsent('/wc')).resolves.toEqual({
      aiEnabled: true,
      updatedAt: '2026-03-01T00:00:00.000Z',
    });
    await expect(readAiConsent('/wc')).resolves.toBeUndefined();
    // IPC read failure falls back to the store key.
    await expect(readAiConsent('/wc')).resolves.toBeUndefined();
    expect(store.get).toHaveBeenCalledWith(AI_CONSENT_STORE_KEY);

    await expect(writeAiConsent('/wc', true)).resolves.toMatchObject({ aiEnabled: true });
    expect(consentSet).toHaveBeenCalledWith('/wc', true);

    // Set failures also fall back to the raw store.
    consentSet.mockRejectedValueOnce(new Error('ipc down'));
    consentGet.mockResolvedValue(null);
    await expect(writeAiConsent('/wc', false)).resolves.toMatchObject({ aiEnabled: false });
    expect(store.set).toHaveBeenCalledWith(
      AI_CONSENT_STORE_KEY,
      expect.objectContaining({ '/wc': { aiEnabled: false, updatedAt: expect.any(String) } })
    );
  });
});
