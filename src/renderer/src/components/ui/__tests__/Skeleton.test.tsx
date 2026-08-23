/**
 * Skeleton primitives (#92): shapes are decorative, the list is announced once
 * via role="status" + aria-busy, and the shimmer is a class the global
 * reduced-motion blocks can kill.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SkeletonBlock, SkeletonLine, SkeletonList } from '../Skeleton';

describe('Skeleton primitives', () => {
  it('renders individual shapes as decorative (aria-hidden)', () => {
    const { container } = render(
      <div>
        <SkeletonLine />
        <SkeletonBlock className="h-10 w-24" />
      </div>
    );
    const shapes = container.querySelectorAll('.skeleton-shimmer');
    expect(shapes).toHaveLength(2);
    for (const shape of shapes) {
      expect(shape).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('announces the list once with role=status and aria-busy', () => {
    render(<SkeletonList rows={4} label="Loading history" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAttribute('aria-label', 'Loading history');
    expect(screen.getByText('Loading history')).toBeInTheDocument();
  });

  it('renders the requested number of rows and accepts a custom row shape', () => {
    render(
      <SkeletonList
        rows={3}
        row={(index) => <div key={index}>row-{index}</div>}
      />
    );
    expect(screen.getByText('row-0')).toBeInTheDocument();
    expect(screen.getByText('row-2')).toBeInTheDocument();
    expect(screen.queryByText('row-3')).not.toBeInTheDocument();
  });

  it('defaults to five log-entry-shaped rows', () => {
    const { container } = render(<SkeletonList />);
    expect(container.querySelectorAll('[data-testid="skeleton-list"] > div')).toHaveLength(5);
  });
});
