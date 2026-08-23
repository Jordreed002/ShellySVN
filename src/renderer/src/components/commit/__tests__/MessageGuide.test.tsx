import React from 'react';
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageGuide } from '../MessageGuide';

describe('MessageGuide', () => {
  it('renders nothing for an empty message', () => {
    const { container } = render(<MessageGuide message="   " />);
    expect(container.textContent).toBe('');
  });

  it('counts the subject (first line) against the profile cap', () => {
    render(<MessageGuide message={'a short subject\n\nbody line'} subjectMaxLength={20} />);
    expect(screen.getByText('Subject 15/20')).toBeInTheDocument();
    expect(screen.getByText('5 words')).toBeInTheDocument();
    expect(screen.getByText('3 lines')).toBeInTheDocument();
  });

  it('does not count body length against the subject cap', () => {
    render(
      <MessageGuide
        message={'subject line\n' + 'x'.repeat(200)}
        subjectMaxLength={50}
      />
    );
    expect(screen.getByText('Subject 12/50')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('turns amber past the soft limit and red past the hard cap', () => {
    const { rerender } = render(<MessageGuide message={'s'.repeat(55)} subjectMaxLength={72} />);
    expect(screen.getByText('Subject 55/72').className).toContain('text-warning');

    rerender(<MessageGuide message={'s'.repeat(80)} subjectMaxLength={72} />);
    expect(screen.getByText('Subject 80/72').className).toContain('text-error');
    expect(screen.getByRole('status').textContent).toBe('Subject exceeds 72 characters');
  });

  it('defaults to the conventional 72-character cap', () => {
    render(<MessageGuide message={'x'.repeat(73)} />);
    expect(screen.getByText('Subject 73/72')).toBeInTheDocument();
  });
});
