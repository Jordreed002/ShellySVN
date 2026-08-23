import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import { ErrorPanel } from '../ErrorPanel';

describe('ErrorPanel', () => {
  it('renders the message as an alert', () => {
    render(<ErrorPanel message="svn:log did not respond within 45s" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('svn:log did not respond within 45s');
    expect(alert).not.toHaveTextContent('Retry');
  });

  it('shows the title as a lead-in when one is given', () => {
    render(<ErrorPanel title="Failed to load history" message="E175002: connection refused" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load history');
    expect(screen.getByRole('alert')).toHaveTextContent('E175002: connection refused');
  });

  it('renders no retry button when there is nothing to retry', () => {
    render(<ErrorPanel message="gone" />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('invokes onRetry when the Retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<ErrorPanel message="E175002" onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('can use a custom retry label and disables the button while retrying', () => {
    const onRetry = vi.fn();
    render(<ErrorPanel message="E175002" onRetry={onRetry} retryLabel="Reload" isRetrying />);

    const button = screen.getByRole('button', { name: 'Reload' }) as HTMLButtonElement;
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('renders the banner variant as a slim strip', () => {
    render(
      <ErrorPanel variant="banner" title="Refresh failed" message="E175002" onRetry={() => {}} />
    );

    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('border-b');
    expect(alert).toHaveTextContent('Refresh failed');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
