import React from 'react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { IssueKeyText } from '../IssueKeyText';
import { GITHUB_ISSUE_PATTERN, JIRA_ISSUE_PATTERN } from '@renderer/lib/issueTracker';

describe('IssueKeyText', () => {
  const openExternal = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    window.api = {
      app: { openExternal },
    } as unknown as Window['api'];
  });

  it('renders plain text when no pattern or template is configured', () => {
    const { container } = render(<IssueKeyText text="fix PROJ-1" pattern="" urlTemplate="" />);
    expect(container.textContent).toBe('fix PROJ-1');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders issue keys as links that open via the external bridge', () => {
    const { container } = render(
      <IssueKeyText
        text="fix PROJ-1 today"
        pattern={JIRA_ISSUE_PATTERN}
        urlTemplate="https://jira.acme.com/browse/{id}"
      />
    );

    const link = screen.getByRole('button', { name: 'Open issue PROJ-1 in tracker' });
    expect(link.textContent).toBe('PROJ-1');
    expect(container.textContent).toBe('fix PROJ-1 today');

    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith('https://jira.acme.com/browse/PROJ-1');
  });

  it('never renders a clickable link for unsafe derived URLs', () => {
    render(
      <IssueKeyText
        text="PROJ-1"
        pattern={JIRA_ISSUE_PATTERN}
        urlTemplate="javascript:alert('{id}')"
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('falls back to plain text for an invalid pattern', () => {
    const { container } = render(
      <IssueKeyText text="PROJ-1" pattern="([bad" urlTemplate="https://x/{id}" />
    );
    expect(container.textContent).toBe('PROJ-1');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('resolves GitHub references through the preset', () => {
    render(
      <IssueKeyText
        text="see #12 and other/repo#34"
        pattern={GITHUB_ISSUE_PATTERN}
        urlTemplate="https://github.com/base/repo/issues/{id}"
        preset="github"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open issue #12 in tracker' }));
    expect(openExternal).toHaveBeenLastCalledWith('https://github.com/base/repo/issues/12');

    fireEvent.click(screen.getByRole('button', { name: 'Open issue other/repo#34 in tracker' }));
    expect(openExternal).toHaveBeenLastCalledWith('https://github.com/other/repo/issues/34');
  });

  it('keeps unresolvable keys (no URL template) as plain text', () => {
    render(<IssueKeyText text="PROJ-1" pattern={JIRA_ISSUE_PATTERN} urlTemplate="" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
