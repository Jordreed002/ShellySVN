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

const openFile = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { dialog: { openFile } },
  });
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
  it('explains that PATH editors come for free when the list is empty', () => {
    render(<OpenWithSettings tools={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/offered automatically/)).toBeInTheDocument();
  });

  it('adds a row, and reports the whole list back', () => {
    const onChange = vi.fn();
    render(<OpenWithSettings tools={[tool]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Add application/ }));

    const [next] = onChange.mock.calls[0];
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ name: '', command: '', appliesTo: 'both' });
    expect(next[1].id).toEqual(expect.any(String));
  });

  it('edits a field without disturbing the others', () => {
    const onChange = vi.fn();
    render(<OpenWithSettings tools={[tool]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Arguments'), {
      target: { value: '--diff {path}' },
    });

    expect(onChange).toHaveBeenCalledWith([{ ...tool, arguments: '--diff {path}' }]);
  });

  it('narrows an application to folders only', () => {
    const onChange = vi.fn();
    render(<OpenWithSettings tools={[tool]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Offer this application for'), {
      target: { value: 'folders' },
    });

    expect(onChange).toHaveBeenCalledWith([{ ...tool, appliesTo: 'folders' }]);
  });

  it('removes the row it was asked to remove', () => {
    const onChange = vi.fn();
    const second = { ...tool, id: 'other', name: 'Nova' };
    render(<OpenWithSettings tools={[tool, second]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Beyond Compare' }));

    expect(onChange).toHaveBeenCalledWith([second]);
  });

  it('fills the command from the file picker', async () => {
    openFile.mockResolvedValue('/Applications/Nova.app');
    const onChange = vi.fn();
    render(<OpenWithSettings tools={[tool]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Browse/ }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith([{ ...tool, command: '/Applications/Nova.app' }])
    );
  });

  it('leaves the row alone when the picker is cancelled', async () => {
    openFile.mockResolvedValue(null);
    const onChange = vi.fn();
    render(<OpenWithSettings tools={[tool]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Browse/ }));

    await waitFor(() => expect(openFile).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the command line each row will run', () => {
    render(
      <OpenWithSettings tools={[{ ...tool, arguments: '--flag {path}' }]} onChange={vi.fn()} />
    );
    expect(screen.getByText('/usr/local/bin/bcomp --flag {path}')).toBeInTheDocument();
  });
});
