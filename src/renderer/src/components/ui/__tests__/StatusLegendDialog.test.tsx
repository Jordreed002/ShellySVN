/**
 * StatusLegendDialog (#94): the legend must document every status the shared
 * union can report (completeness is also enforced at compile time by
 * `Record<SvnStatusChar, StatusLegendEntry>`), must agree with the colors the
 * app actually renders (STATUS_CONFIG), and the mounted variant must open on
 * the palette's event.
 */

import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SvnStatusChar } from '@shared/types';

import {
  STATUS_LEGEND,
  STATUS_LEGEND_OPEN_EVENT,
  StatusLegendDialog,
  StatusLegendDialogMount,
} from '../StatusLegendDialog';
import { STATUS_CONFIG } from '../StatusIcon';

/** Every letter the shared union knows about. */
const EVERY_STATUS: SvnStatusChar[] = [
  ' ',
  'A',
  'C',
  'D',
  'I',
  'M',
  'R',
  'X',
  '?',
  '!',
  '~',
  'O',
];

describe('STATUS_LEGEND content', () => {
  it('documents every SvnStatusChar with a meaning and applicable actions', () => {
    expect(Object.keys(STATUS_LEGEND).sort()).toEqual([...EVERY_STATUS].sort());
    for (const status of EVERY_STATUS) {
      const item = STATUS_LEGEND[status];
      expect(item.meaning, `meaning for "${status}"`).toMatch(/\S/);
      expect(item.actions, `actions for "${status}"`).toMatch(/\S/);
    }
  });

  it('reuses STATUS_CONFIG words, letters and color tokens', () => {
    for (const status of EVERY_STATUS) {
      const item = STATUS_LEGEND[status];
      const config = STATUS_CONFIG[status];
      expect(item.label).toBe(config.label);
      expect(item.code).toBe(config.code);
      expect(item.chipClass).toBe(config.bgColor);
      expect(item.textClass).toBe(config.color);
    }
  });
});

describe('StatusLegendDialog', () => {
  it('renders nothing until open, then lists every documented status', () => {
    const onClose = vi.fn();
    const { rerender } = render(<StatusLegendDialog isOpen={false} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(<StatusLegendDialog isOpen onClose={onClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('What the status colors mean')).toBeInTheDocument();
    for (const status of EVERY_STATUS) {
      if (STATUS_LEGEND[status].code) {
        expect(screen.getByText(`svn status ${STATUS_LEGEND[status].code}`)).toBeInTheDocument();
      }
    }
  });

  it('closes through DialogBase (Escape)', () => {
    const onClose = vi.fn();
    render(<StatusLegendDialog isOpen onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('StatusLegendDialogMount', () => {
  it('opens when the palette event fires', async () => {
    render(<StatusLegendDialogMount />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent(window, new CustomEvent(STATUS_LEGEND_OPEN_EVENT));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });
});
