import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import { SidebarFallback, StatusBarFallback } from '../Layout';
import { RepositoryPillButton } from '../layout/RepositoryPillButton';
import { describeRepositoryPill } from '../layout/repositoryPill';

describe('lazy shell fallbacks', () => {
  it('reserves the sidebar geometry and announces its loading state', () => {
    const { container } = render(<SidebarFallback />);
    const sidebar = screen.getByLabelText('Loading sidebar');

    expect(sidebar).toHaveAttribute('aria-busy', 'true');
    expect(sidebar).toHaveClass('h-full');
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4);
    expect(sidebar.querySelector('button')).toBeNull();
  });

  it('reserves the normal status-bar height without assistive output', () => {
    const { container } = render(<StatusBarFallback />);
    const fallback = container.firstElementChild;

    expect(fallback).toHaveClass('h-control-sm');
    expect(fallback).toHaveAttribute('aria-hidden', 'true');
  });

  it.each([
    [{ workingCopyPath: '/wc/atlas' }, 'Working copy atlas — switch repository'],
    [
      { browsedUrl: 'https://svn.example.com/project/trunk' },
      'Browsing a repository on svn.example.com — switch repository',
    ],
    [{}, 'No repository open — open the command palette to pick one'],
  ])('keeps the repository pill operable for fallback facts', (facts, accessibleName) => {
    const onActivate = vi.fn();
    render(
      <RepositoryPillButton pill={describeRepositoryPill(facts)} onActivate={onActivate} busy />
    );

    const button = screen.getByRole('button', { name: accessibleName });
    button.click();
    expect(onActivate).toHaveBeenCalledOnce();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});
