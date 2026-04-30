import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import { RouteState } from '../src/components/ui/RouteState';

describe('RouteState', () => {
  it('renders loading and empty states as polite status regions', () => {
    const { rerender } = render(
      <RouteState variant="loading" title="Loading Repository" description="Fetching entries." />
    );

    expect(screen.getByRole('status', { name: 'Loading Repository' })).toHaveAttribute(
      'aria-live',
      'polite'
    );
    expect(screen.getByText('Fetching entries.')).toBeInTheDocument();

    rerender(<RouteState variant="empty" title="Empty Directory" />);

    expect(screen.getByRole('status', { name: 'Empty Directory' })).toBeInTheDocument();
  });

  it('renders error state as an assertive alert with retry action', () => {
    const onRetry = vi.fn();

    render(
      <RouteState
        variant="error"
        title="Error Loading Directory"
        description="Access denied"
        action={{ label: 'Retry', onClick: onRetry }}
      />
    );

    expect(screen.getByRole('alert', { name: 'Error Loading Directory' })).toHaveAttribute(
      'aria-live',
      'assertive'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders offline state with supporting route details', () => {
    render(
      <RouteState variant="offline" title="Connection Failed" description="Unable to connect.">
        <p>Check your proxy settings.</p>
      </RouteState>
    );

    expect(screen.getByRole('status', { name: 'Connection Failed' })).toBeInTheDocument();
    expect(screen.getByText('Check your proxy settings.')).toBeInTheDocument();
  });
});
