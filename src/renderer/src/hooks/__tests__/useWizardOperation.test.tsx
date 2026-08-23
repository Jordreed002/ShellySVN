import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SvnOperationProgress } from '@shared/types';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import { useWizardOperation } from '../useWizardOperation';

function progress(partial: Partial<SvnOperationProgress>): SvnOperationProgress {
  return { operationId: 'op-1', operation: 'export', status: 'running', filesProcessed: 0, ...partial };
}

describe('useWizardOperation', () => {
  beforeEach(() => {
    window.api = createMockElectronAPI();
    window.api.svn.cancelOperation = vi.fn().mockResolvedValue({ success: true });
  });

  afterEach(cleanup);

  it('tracks running → completed and records duration and progress', async () => {
    const { result } = renderHook(() => useWizardOperation<{ success: boolean }>({ label: 'Export' }));

    let resolveOperation: (value: { success: boolean }) => void = () => undefined;
    let report: ((p: SvnOperationProgress) => void) | null = null;

    act(() => {
      result.current.start((onProgress) => {
        report = onProgress;
        onProgress(progress({ operationId: 'export-7', filesProcessed: 2 }));
        return new Promise((resolve) => {
          resolveOperation = resolve;
        });
      });
    });

    expect(result.current.phase).toBe('running');
    expect(result.current.progress?.filesProcessed).toBe(2);
    expect(result.current.progress?.operationId).toBe('export-7');

    await act(async () => {
      resolveOperation({ success: true });
    });

    expect(result.current.phase).toBe('completed');
    expect(result.current.result).toEqual({ success: true });
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(window.api.svn.cancelOperation).not.toHaveBeenCalled();
    expect(typeof report).toBe('function');
  });

  it('converts failed results into an error state', async () => {
    const { result } = renderHook(() => useWizardOperation<{ success: boolean; error?: string }>());

    await act(async () => {
      await result.current.start(async () => ({ success: false, error: 'svn: E155007' }));
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('svn: E155007');
  });

  it('falls back to the label when a failure carries no message', async () => {
    const { result } = renderHook(() => useWizardOperation<{ success: boolean }>({ label: 'Import' }));

    await act(async () => {
      await result.current.start(async () => ({ success: false }));
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('Import failed');
  });

  it('cancels through svn:cancelOperation with the id learned from progress', async () => {
    const { result } = renderHook(() => useWizardOperation<{ success: boolean }>({ label: 'Export' }));

    let rejectOperation: (reason?: unknown) => void = () => undefined;
    act(() => {
      result.current.start((onProgress) => {
        onProgress(progress({ operationId: 'export-42', filesProcessed: 1 }));
        return new Promise((_resolve, reject) => {
          rejectOperation = reject;
        });
      });
    });

    act(() => {
      result.current.cancel();
    });

    expect(window.api.svn.cancelOperation).toHaveBeenCalledWith('export-42');
    expect(result.current.cancelRequested).toBe(true);
    expect(result.current.phase).toBe('running'); // until the invoke settles

    await act(async () => {
      rejectOperation(new Error('Terminated'));
    });

    expect(result.current.phase).toBe('cancelled');
  });

  it('classifies a resolved operation with cancelled status as cancelled', async () => {
    const { result } = renderHook(() => useWizardOperation<{ success: boolean }>());

    await act(async () => {
      await result.current.start((onProgress) => {
        onProgress(progress({ status: 'cancelled', operationId: 'op-x' }));
        return Promise.resolve({ success: true });
      });
    });

    expect(result.current.phase).toBe('cancelled');
  });

  it('reports plain rejections as errors, not cancellations', async () => {
    const { result } = renderHook(() => useWizardOperation<{ success: boolean }>({ label: 'Export' }));

    await act(async () => {
      await result.current.start(async () => {
        throw new Error('Network unreachable');
      });
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('Network unreachable');
  });

  it('reset returns to idle and clears progress', async () => {
    const { result } = renderHook(() => useWizardOperation<{ success: boolean }>());

    await act(async () => {
      await result.current.start(async (onProgress) => {
        onProgress(progress({ filesProcessed: 5 }));
        return { success: true };
      });
    });
    expect(result.current.phase).toBe('completed');

    act(() => {
      result.current.reset();
    });

    expect(result.current.phase).toBe('idle');
    expect(result.current.progress).toBeNull();
    expect(result.current.elapsedMs).toBeNull();
  });

  it('ignores a second start while one operation is in flight', async () => {
    const { result } = renderHook(() => useWizardOperation<{ success: boolean; tag?: string }>());
    const invocations: string[] = [];

    let resolveFirst: (value: { success: boolean }) => void = () => undefined;
    act(() => {
      result.current.start(async () => {
        invocations.push('first');
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      });
    });
    act(() => {
      result.current.start(async () => {
        invocations.push('second');
        return { success: true };
      });
    });

    expect(invocations).toEqual(['first']);

    await act(async () => {
      resolveFirst({ success: true });
    });
    expect(result.current.phase).toBe('completed');
  });
});
