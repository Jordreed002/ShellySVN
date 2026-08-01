/**
 * The list of applications for "Open in".
 *
 * The thing worth defending: the row shows the command line that will actually
 * run. A launcher configured wrongly does nothing visible when clicked, so the
 * only defence is being able to read what was configured.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomOpenWithTool } from '@shared/types';

import { OpenWithSettings, describeCommandLine } from '../OpenWithSettings';

const list = vi.fn();
const register = vi.fn();
const remove = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { externalTools: { list, register, remove } },
  });
  list.mockResolvedValue([]);
});

afterEach(cleanup);

const tool: CustomOpenWithTool = {
  id: 'bc',
  name: 'Beyond Compare',
  command: '/usr/local/bin/bcomp',
  appliesTo: 'both',
};

describe('describeCommandLine', () => {
  it('appends the path when there is no template', () => {
    expect(describeCommandLine(tool)).toBe('/usr/local/bin/bcomp <path>');
  });

  it('shows the path where {path} puts it', () => {
    expect(describeCommandLine({ ...tool, arguments: '--diff {path} --wait' })).toBe(
      '/usr/local/bin/bcomp --diff {path} --wait'
    );
  });

  it('appends the path after arguments that never mention it', () => {
    expect(describeCommandLine({ ...tool, arguments: '--new-window' })).toBe(
      '/usr/local/bin/bcomp --new-window <path>'
    );
  });

  it('says <command> rather than nothing for a half-filled row', () => {
    expect(describeCommandLine({ ...tool, command: '  ' })).toBe('<command> <path>');
  });
});

describe('OpenWithSettings', () => {
  it('explains that legacy command strings must be re-registered', async () => {
    render(<OpenWithSettings />);
    expect(await screen.findByText(/Legacy command strings are disabled/)).toBeInTheDocument();
  });

  it('registers an editor through the main-owned registry', async () => {
    register.mockResolvedValue({ id: 'registered:1', name: 'Nova' });
    render(<OpenWithSettings />);
    fireEvent.click(screen.getByRole('button', { name: /Register application/ }));
    await waitFor(() => expect(register).toHaveBeenCalledWith('editor'));
  });

  it('lists registered applications without exposing a path', async () => {
    list.mockResolvedValue([
      {
        id: 'registered:1',
        name: 'Nova',
        roles: ['editor'],
        builtIn: false,
        available: true,
        argumentTemplate: ['{path}'],
      },
    ]);
    render(<OpenWithSettings />);
    expect(await screen.findByText('Nova')).toBeInTheDocument();
    expect(screen.getByText(/path hidden/)).toBeInTheDocument();
  });
});
