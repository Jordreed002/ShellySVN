import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import { ProgressIndicator } from '../src/components/ui/ProgressIndicator';
import { StatusBar } from '../src/components/ui/StatusBar';

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { showStatusBar: true, recentRepositories: [] } }),
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => ({ location: { search: {} } }),
}));

vi.mock('../src/components/sidebar/sidebarData', () => ({
  useWorkingCopyInfo: () => ({ data: undefined }),
}));

describe('status and progress accessibility', () => {
  it('announces determinate operation progress with progressbar metadata', () => {
    render(
      <ProgressIndicator
        status="running"
        itemsCompleted={3}
        totalItems={10}
        currentItem="C:\\wc\\src\\app.ts"
      />
    );

    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Processing. 30% complete.'
    );
    expect(screen.getByRole('progressbar', { name: 'Operation progress' })).toHaveAttribute(
      'aria-valuenow',
      '30'
    );
    expect(screen.getByText(/app\.ts$/)).toBeInTheDocument();
  });

  it('announces indeterminate and failed operations through live regions', () => {
    const { rerender } = render(<ProgressIndicator status="running" indeterminate />);

    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Processing. Progress is indeterminate.'
    );
    expect(screen.getByRole('progressbar', { name: 'Operation progress' })).not.toHaveAttribute(
      'aria-valuenow'
    );

    rerender(<ProgressIndicator status="error" error="Network unavailable" />);

    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByText('Network unavailable')).toBeInTheDocument();
  });

  it('exposes the app status bar as a polite status region', () => {
    render(<StatusBar />);

    const region = screen.getByRole('status', { name: 'Application status' });
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('No working copy open');
  });
});
