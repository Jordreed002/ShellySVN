import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsentToggle } from '../ConsentToggle';
import { AI_CONSENT_STORE_KEY } from '../lib/aiConsent';

function mockStore(initial: unknown) {
  let value = initial;
  const get = vi.fn().mockImplementation(() => Promise.resolve(value));
  const set = vi.fn().mockImplementation((_key: string, next: unknown) => {
    value = next;
    return Promise.resolve();
  });
  window.api = { store: { get, set, delete: vi.fn() } } as unknown as Window['api'];
  return { get, set };
}

describe('ConsentToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Not set for a working copy with no consent entry', async () => {
    mockStore(undefined);
    render(<ConsentToggle workingCopyPath="/wc" />);
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Not set' }).getAttribute('aria-checked')).toBe(
        'true'
      )
    );
    expect(screen.getByText(/No choice recorded yet/)).toBeTruthy();
  });

  it('reflects a persisted On/Off choice', async () => {
    mockStore({ '/wc': { aiEnabled: true, updatedAt: '2026-01-01T00:00:00.000Z' } });
    render(<ConsentToggle workingCopyPath="/wc" />);
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'On' }).getAttribute('aria-checked')).toBe('true')
    );
    expect(screen.getByText(/AI features may run for this working copy/)).toBeTruthy();
  });

  it('persists a choice via get-merge-set when the user opts in', async () => {
    const store = mockStore({ '/other': { aiEnabled: false, updatedAt: 'x' } });
    render(<ConsentToggle workingCopyPath="/wc" />);
    await waitFor(() => screen.getByRole('radiogroup'));
    fireEvent.click(screen.getByRole('radio', { name: 'On' }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'On' }).getAttribute('aria-checked')).toBe('true')
    );
    expect(store.set).toHaveBeenCalledWith(AI_CONSENT_STORE_KEY, {
      '/other': { aiEnabled: false, updatedAt: 'x' },
      '/wc': { aiEnabled: true, updatedAt: expect.any(String) },
    });
  });

  it('can return to Not set, preserving other working copies', async () => {
    const store = mockStore({
      '/wc': { aiEnabled: true, updatedAt: 'x' },
      '/other': { aiEnabled: true, updatedAt: 'x' },
    });
    render(<ConsentToggle workingCopyPath="/wc" />);
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'On' }).getAttribute('aria-checked')).toBe('true')
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Not set' }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Not set' }).getAttribute('aria-checked')).toBe(
        'true'
      )
    );
    const [key, value] = store.set.mock.calls[0]! as [string, Record<string, unknown>];
    expect(key).toBe(AI_CONSENT_STORE_KEY);
    expect('/wc' in value).toBe(false);
    expect(value['/other']).toEqual({ aiEnabled: true, updatedAt: 'x' });
  });
});
