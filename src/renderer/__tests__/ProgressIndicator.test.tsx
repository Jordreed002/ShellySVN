import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { ProgressIndicator, useProgressTracker } from '../src/components/ui/ProgressIndicator';

describe('ProgressIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    cleanup();
  });

  describe('Basic Rendering', () => {
    it('renders running state with spinner', () => {
      render(<ProgressIndicator status="running" totalItems={10} itemsCompleted={3} />);

      expect(screen.getByText('Processing...')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText('items')).toBeInTheDocument();
    });

    it('renders completed state with checkmark', () => {
      render(<ProgressIndicator status="completed" totalItems={10} itemsCompleted={10} />);

      expect(screen.getByText('Complete')).toBeInTheDocument();
    });

    it('renders error state with error message', () => {
      render(<ProgressIndicator status="error" error="Connection failed" />);

      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getByText('Connection failed')).toBeInTheDocument();
    });

    it('renders cancelled state', () => {
      render(<ProgressIndicator status="cancelled" />);

      expect(screen.getByText('Cancelled')).toBeInTheDocument();
    });
  });

  describe('Item Count Display', () => {
    it('shows item count as "X of Y items"', () => {
      render(<ProgressIndicator status="running" totalItems={23} itemsCompleted={5} />);

      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('23')).toBeInTheDocument();
      expect(screen.getByText('items')).toBeInTheDocument();
    });

    it('hides item count when totalItems is 0', () => {
      render(<ProgressIndicator status="running" totalItems={0} itemsCompleted={0} />);

      expect(screen.queryByText('items')).not.toBeInTheDocument();
    });

    it('shows downloading 5 of 23 items during sparse checkout', () => {
      render(
        <ProgressIndicator
          status="running"
          operationType="download"
          totalItems={23}
          itemsCompleted={5}
        />
      );

      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('23')).toBeInTheDocument();
      expect(screen.getByText('items')).toBeInTheDocument();
    });
  });

  describe('Size Display', () => {
    it('shows size in bytes', () => {
      render(<ProgressIndicator status="running" totalBytes={1024} bytesTransferred={512} />);

      expect(screen.getByText('512 B')).toBeInTheDocument();
      expect(screen.getByText('1 KB')).toBeInTheDocument();
    });

    it('shows size in KB', () => {
      render(
        <ProgressIndicator status="running" totalBytes={2048000} bytesTransferred={1024000} />
      );

      expect(screen.getByText('1000 KB')).toBeInTheDocument();
      expect(screen.getByText('2.0 MB')).toBeInTheDocument();
    });

    it('shows size in MB with decimal', () => {
      render(
        <ProgressIndicator status="running" totalBytes={10485760} bytesTransferred={5242880} />
      );

      expect(screen.getByText('5.0 MB')).toBeInTheDocument();
      expect(screen.getByText('10.0 MB')).toBeInTheDocument();
    });

    it('hides size when totalBytes is 0', () => {
      render(<ProgressIndicator status="running" totalBytes={0} bytesTransferred={0} />);

      expect(screen.queryByText('0 B')).not.toBeInTheDocument();
    });
  });

  describe('Estimated Time Remaining', () => {
    it('shows estimated time remaining when provided', () => {
      render(<ProgressIndicator status="running" estimatedTimeRemaining={120} />);

      expect(screen.getByText('~2m remaining')).toBeInTheDocument();
    });

    it('shows seconds for short times', () => {
      render(<ProgressIndicator status="running" estimatedTimeRemaining={45} />);

      expect(screen.getByText('~45s remaining')).toBeInTheDocument();
    });

    it('shows hours for long times', () => {
      render(<ProgressIndicator status="running" estimatedTimeRemaining={3661} />);

      expect(screen.getByText('~1h 1m remaining')).toBeInTheDocument();
    });

    it('hides estimated time when 0', () => {
      render(<ProgressIndicator status="running" estimatedTimeRemaining={0} />);

      expect(screen.queryByText(/remaining/)).not.toBeInTheDocument();
    });

    it('hides estimated time when completed', () => {
      render(<ProgressIndicator status="completed" estimatedTimeRemaining={120} />);

      expect(screen.queryByText(/remaining/)).not.toBeInTheDocument();
    });
  });

  describe('Cancel Button', () => {
    it('shows cancel button when canCancel is true and running', () => {
      const onCancel = vi.fn();
      render(<ProgressIndicator status="running" canCancel={true} onCancel={onCancel} />);

      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('calls onCancel when cancel button is clicked', () => {
      const onCancel = vi.fn();
      render(<ProgressIndicator status="running" canCancel={true} onCancel={onCancel} />);

      fireEvent.click(screen.getByText('Cancel'));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('hides cancel button when canCancel is false', () => {
      render(<ProgressIndicator status="running" canCancel={false} onCancel={vi.fn()} />);

      expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    });

    it('hides cancel button when not running', () => {
      render(<ProgressIndicator status="completed" canCancel={true} onCancel={vi.fn()} />);

      expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    });

    it('allows cancellation during long-running operations', async () => {
      const onCancel = vi.fn();

      const { rerender } = render(
        <ProgressIndicator
          status="running"
          totalItems={1000}
          itemsCompleted={250}
          canCancel={true}
          onCancel={onCancel}
        />
      );

      expect(screen.getByText('250')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Cancel'));
      expect(onCancel).toHaveBeenCalled();

      rerender(
        <ProgressIndicator
          status="cancelled"
          totalItems={1000}
          itemsCompleted={250}
          canCancel={true}
          onCancel={onCancel}
        />
      );

      expect(screen.getByText('Cancelled')).toBeInTheDocument();
    });
  });

  describe('Close Button', () => {
    it('shows close button when completed and onClose provided', () => {
      const onClose = vi.fn();
      render(<ProgressIndicator status="completed" onClose={onClose} />);

      const closeButtons = screen.getAllByRole('button');
      expect(closeButtons.length).toBeGreaterThan(0);
    });

    it('shows close button on error', () => {
      const onClose = vi.fn();
      render(<ProgressIndicator status="error" error="Test error" onClose={onClose} />);

      const closeButtons = screen.getAllByRole('button');
      expect(closeButtons.length).toBeGreaterThan(0);
    });
  });

  describe('Progress Bar', () => {
    it('shows determinate progress bar when progress is known', () => {
      const { container } = render(
        <ProgressIndicator status="running" totalItems={10} itemsCompleted={5} />
      );

      const progressBar = container.querySelector('.bg-accent');
      expect(progressBar).toBeInTheDocument();
    });

    it('shows indeterminate progress bar when progress is unknown', () => {
      const { container } = render(<ProgressIndicator status="running" indeterminate={true} />);

      const indeterminateBar = container.querySelector('.animate-indeterminate-progress');
      expect(indeterminateBar).toBeInTheDocument();
    });

    it('updates progress bar width based on percentage', () => {
      const { container, rerender } = render(
        <ProgressIndicator status="running" totalItems={100} itemsCompleted={25} />
      );

      let progressBar = container.querySelector('[style*="width"]');
      expect(progressBar).toHaveStyle({ width: '25%' });

      rerender(<ProgressIndicator status="running" totalItems={100} itemsCompleted={75} />);

      progressBar = container.querySelector('[style*="width"]');
      expect(progressBar).toHaveStyle({ width: '75%' });
    });

    it('shows success color when completed', () => {
      const { container } = render(
        <ProgressIndicator status="completed" totalItems={100} itemsCompleted={100} />
      );

      const progressBar = container.querySelector('.bg-success');
      expect(progressBar).toBeInTheDocument();
    });
  });

  describe('Current Item Display', () => {
    it('shows current item when provided and running', () => {
      render(<ProgressIndicator status="running" currentItem="/path/to/file.txt" />);

      expect(screen.getByText('Current')).toBeInTheDocument();
      expect(screen.getByTitle('/path/to/file.txt')).toBeInTheDocument();
    });

    it('hides current item when not running', () => {
      render(<ProgressIndicator status="completed" currentItem="/path/to/file.txt" />);

      expect(screen.queryByText('Current')).not.toBeInTheDocument();
    });

    it('truncates long file paths', () => {
      const longPath = '/very/long/path/that/should/be/truncated/to/fit/the/display/area/file.txt';
      render(<ProgressIndicator status="running" currentItem={longPath} />);

      const displayedText = screen.getByTitle(longPath).textContent;
      expect(displayedText?.length).toBeLessThan(longPath.length);
      expect(displayedText).toContain('...');
    });
  });

  describe('Compact Mode', () => {
    it('renders minimal UI in compact mode', () => {
      const { container } = render(
        <ProgressIndicator status="running" totalItems={10} itemsCompleted={5} compact={true} />
      );

      expect(screen.getByText('5/10')).toBeInTheDocument();
      expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('shows cancel button in compact mode', () => {
      const onCancel = vi.fn();
      render(
        <ProgressIndicator status="running" compact={true} canCancel={true} onCancel={onCancel} />
      );

      const cancelButton = screen.getByTitle('Cancel');
      expect(cancelButton).toBeInTheDocument();

      fireEvent.click(cancelButton);
      expect(onCancel).toHaveBeenCalled();
    });

    it('shows completion icon in compact mode', () => {
      const { container } = render(<ProgressIndicator status="completed" compact={true} />);

      const checkIcon = container.querySelector('.text-success');
      expect(checkIcon).toBeInTheDocument();
    });
  });

  describe('Operation Types', () => {
    it('shows download icon for download operation', () => {
      const { container } = render(
        <ProgressIndicator
          status="running"
          operationType="download"
          totalItems={10}
          itemsCompleted={5}
        />
      );

      const downloadIcons = container.querySelectorAll('svg');
      expect(downloadIcons.length).toBeGreaterThan(0);
    });

    it('shows upload icon for upload operation', () => {
      const { container } = render(
        <ProgressIndicator
          status="running"
          operationType="upload"
          totalItems={10}
          itemsCompleted={5}
        />
      );

      const uploadIcons = container.querySelectorAll('svg');
      expect(uploadIcons.length).toBeGreaterThan(0);
    });
  });

  describe('Progress Percentage Display', () => {
    it('shows percentage based on item progress', () => {
      render(<ProgressIndicator status="running" totalItems={100} itemsCompleted={33} />);

      expect(screen.getByText('33%')).toBeInTheDocument();
    });

    it('shows percentage based on byte progress', () => {
      render(<ProgressIndicator status="running" totalBytes={1000} bytesTransferred={750} />);

      expect(screen.getByText('75%')).toBeInTheDocument();
    });

    it('prefers byte progress over item progress', () => {
      render(
        <ProgressIndicator
          status="running"
          totalItems={100}
          itemsCompleted={50}
          totalBytes={1000}
          bytesTransferred={250}
        />
      );

      expect(screen.getByText('25%')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles zero progress gracefully', () => {
      render(<ProgressIndicator status="running" totalItems={100} itemsCompleted={0} />);

      expect(screen.getByText('0%')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('handles completion gracefully', () => {
      render(
        <ProgressIndicator
          status="completed"
          totalItems={100}
          itemsCompleted={100}
          totalBytes={10000}
          bytesTransferred={10000}
        />
      );

      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('handles missing total gracefully', () => {
      render(<ProgressIndicator status="running" itemsCompleted={5} />);

      expect(screen.getByText('Processing...')).toBeInTheDocument();
    });
  });
});

describe('useProgressTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined estimated time initially', () => {
    const { result } = renderHook(() => useProgressTracker(0, 100, true));

    expect(result.current.estimatedTime).toBeUndefined();
  });

  it('calculates estimated time based on progress rate', async () => {
    const { result, rerender } = renderHook(
      ({ completed, total, running }) => useProgressTracker(completed, total, running),
      { initialProps: { completed: 0, total: 100, running: true } }
    );

    expect(result.current.estimatedTime).toBeUndefined();

    vi.advanceTimersByTime(2000);
    rerender({ completed: 10, total: 100, running: true });

    expect(result.current.estimatedTime).toBeGreaterThan(0);
  });

  it('resets when operation stops', () => {
    const { result, rerender } = renderHook(
      ({ completed, total, running }) => useProgressTracker(completed, total, running),
      { initialProps: { completed: 50, total: 100, running: true } }
    );

    vi.advanceTimersByTime(2000);

    rerender({ completed: 50, total: 100, running: false });

    expect(result.current.estimatedTime).toBeUndefined();
  });
});

function renderHook<T>(hook: () => T) {
  const result = { current: null as T | null };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  const utils = render(<TestComponent />);

  const rerender = () => utils.rerender(<TestComponent />);

  return { result, rerender };
}
