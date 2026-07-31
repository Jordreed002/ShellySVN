/**
 * Navigation semantics for the repository browser.
 *
 * History is the easy thing to get subtly wrong — particularly truncating the
 * forward stack when you branch, and resetting per-directory state on every
 * move — so it is covered here rather than left to manual clicking.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useRepoBrowserState, ancestorsOf, parentOf } from '../useRepoBrowserState';

describe('ancestorsOf', () => {
  it('returns the root for an empty path', () => {
    expect(ancestorsOf('')).toEqual(['']);
  });

  it('accumulates every ancestor including the path itself', () => {
    expect(ancestorsOf('clients/acme-corp/website')).toEqual([
      '',
      'clients',
      'clients/acme-corp',
      'clients/acme-corp/website',
    ]);
  });
});

describe('parentOf', () => {
  it('returns the root for a top-level path', () => {
    expect(parentOf('clients')).toBe('');
  });

  it('drops the last segment', () => {
    expect(parentOf('clients/acme-corp/website')).toBe('clients/acme-corp');
  });

  it('is stable at the root', () => {
    expect(parentOf('')).toBe('');
  });
});

describe('useRepoBrowserState', () => {
  it('starts at the initial path with its ancestors expanded', () => {
    const { result } = renderHook(() => useRepoBrowserState({ initialPath: 'clients/acme-corp' }));

    expect(result.current.path).toBe('clients/acme-corp');
    expect(result.current.expanded.has('clients')).toBe(true);
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoUp).toBe(true);
  });

  it('cannot go up from the repository root', () => {
    const { result } = renderHook(() => useRepoBrowserState());
    expect(result.current.canGoUp).toBe(false);
  });

  it('moves back and forward through history', () => {
    const { result } = renderHook(() => useRepoBrowserState());

    act(() => result.current.actions.navigate('clients'));
    act(() => result.current.actions.navigate('clients/acme-corp'));
    expect(result.current.canGoForward).toBe(false);

    act(() => result.current.actions.goBack());
    expect(result.current.path).toBe('clients');
    expect(result.current.canGoForward).toBe(true);

    act(() => result.current.actions.goForward());
    expect(result.current.path).toBe('clients/acme-corp');
  });

  it('truncates the forward stack when navigating somewhere new', () => {
    const { result } = renderHook(() => useRepoBrowserState());

    act(() => result.current.actions.navigate('clients'));
    act(() => result.current.actions.navigate('clients/acme-corp'));
    act(() => result.current.actions.goBack());
    act(() => result.current.actions.navigate('internal'));

    expect(result.current.path).toBe('internal');
    expect(result.current.canGoForward).toBe(false);
  });

  it('ignores navigation to the path already showing', () => {
    const { result } = renderHook(() => useRepoBrowserState());

    act(() => result.current.actions.navigate('clients'));
    act(() => result.current.actions.navigate('clients'));
    act(() => result.current.actions.goBack());

    expect(result.current.path).toBe('');
    expect(result.current.canGoBack).toBe(false);
  });

  it('clears selection, ticks and filter when the directory changes', () => {
    const { result } = renderHook(() => useRepoBrowserState());

    act(() => {
      result.current.actions.select('README.md');
      result.current.actions.toggleChecked('README.md');
      result.current.actions.setFilter('read');
    });
    expect(result.current.checked.has('README.md')).toBe(true);

    act(() => result.current.actions.navigate('clients'));

    expect(result.current.selectedPath).toBeNull();
    expect(result.current.checked.size).toBe(0);
    expect(result.current.filter).toBe('');
  });

  it('reverses direction when the active sort column is clicked again', () => {
    const { result } = renderHook(() => useRepoBrowserState());

    act(() => result.current.actions.setSort('name'));
    expect(result.current.sort).toEqual({ key: 'name', direction: 'desc' });

    act(() => result.current.actions.setSort('revision'));
    expect(result.current.sort).toEqual({ key: 'revision', direction: 'asc' });
  });

  it('keeps a peg revision until it is cleared', () => {
    const { result } = renderHook(() => useRepoBrowserState());

    act(() => result.current.actions.setPeg({ kind: 'revision', revision: 4835 }));
    expect(result.current.peg).toEqual({ kind: 'revision', revision: 4835 });

    act(() => result.current.actions.navigate('clients'));
    expect(result.current.peg).toEqual({ kind: 'revision', revision: 4835 });

    act(() => result.current.actions.setPeg({ kind: 'head' }));
    expect(result.current.peg).toEqual({ kind: 'head' });
  });

  it('collapses every expanded path except the root', () => {
    const { result } = renderHook(() =>
      useRepoBrowserState({ initialPath: 'clients/acme-corp/website' })
    );

    act(() => result.current.actions.collapseAll());

    expect(Array.from(result.current.expanded)).toEqual(['']);
  });
});
