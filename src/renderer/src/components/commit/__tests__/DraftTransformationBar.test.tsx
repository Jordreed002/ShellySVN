import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DraftTransformationBar } from '../DraftTransformationBar';

describe('DraftTransformationBar', () => {
  it('renders only profile-enabled transformations and invokes the selected action', () => {
    const onTransform = vi.fn();
    render(
      <DraftTransformationBar
        transformations={['shorter', 'match-style']}
        disabled={false}
        onTransform={onTransform}
      />
    );
    expect(screen.queryByRole('button', { name: 'Add body' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Match style' }));
    expect(onTransform).toHaveBeenCalledWith('match-style');
  });

  it('disables transformations while generation is active', () => {
    render(<DraftTransformationBar transformations={['shorter']} disabled onTransform={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Shorter' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });
});
