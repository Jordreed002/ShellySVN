import React, { useState } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCommitMessageHistory } from '../src/hooks/useCommitMessageHistory';
import { AutoCompleteInput, type AutocompleteOption } from '../src/components/ui/AutoCompleteInput';

describe('commit message history behavior', () => {
  const storeApi = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    storeApi.get.mockResolvedValue([]);
    storeApi.set.mockResolvedValue(undefined);
    storeApi.delete.mockResolvedValue(undefined);
    window.api = {
      store: storeApi,
    } as unknown as Window['api'];
  });

  it('loads, persists, deduplicates, and clears commit message history', async () => {
    storeApi.get.mockResolvedValueOnce([
      { message: 'fix: previous bug', timestamp: 1 },
      { message: 'feat: older feature', timestamp: 2 },
    ]);
    const { result } = renderHook(() => useCommitMessageHistory());

    await waitFor(() => {
      expect(result.current.history).toHaveLength(2);
    });

    await act(async () => {
      await result.current.addMessage(' fix: previous bug ');
    });

    await waitFor(() => {
      expect(result.current.history[0].message).toBe('fix: previous bug');
      expect(result.current.history).toHaveLength(2);
    });
    expect(storeApi.set).toHaveBeenCalledWith(
      'shellysvn:commit-message-history',
      expect.arrayContaining([expect.objectContaining({ message: 'fix: previous bug' })])
    );

    await act(async () => {
      await result.current.clearHistory();
    });

    expect(result.current.history).toEqual([]);
    expect(storeApi.delete).toHaveBeenCalledWith('shellysvn:commit-message-history');
  });

  it('selects history suggestions with keyboard navigation', () => {
    const suggestions: AutocompleteOption[] = [
      {
        value: 'fix: previous bug',
        label: 'fix: previous bug',
        category: 'Recent',
      },
      {
        value: 'feat: older feature',
        label: 'feat: older feature',
        category: 'Recent',
      },
    ];

    function Harness() {
      const [value, setValue] = useState('fix');
      return (
        <AutoCompleteInput
          id="commit-history-keyboard"
          value={value}
          onChange={setValue}
          suggestions={suggestions}
          minChars={1}
          showCategories={true}
          aria-label="Commit message"
        />
      );
    }

    render(<Harness />);

    const input = screen.getByLabelText('Commit message');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveValue('fix: previous bug');
  });
});
