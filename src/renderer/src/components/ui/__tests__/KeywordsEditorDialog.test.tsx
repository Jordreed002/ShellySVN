import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockElectronAPI } from '@test-utils/electron-api-mock';
import { KeywordsEditorDialog } from '../KeywordsEditorDialog';

const SAMPLE_DATE = '2026-08-23 09:15:42Z';
const SAMPLE_URL = 'https://svn.example.com/repos/calc/trunk/src/calc.c';

function checkbox(name: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name: `${name} keyword` }) as HTMLInputElement;
}

describe('KeywordsEditorDialog', () => {
  beforeEach(() => {
    window.api = createMockElectronAPI();
  });
  afterEach(cleanup);

  it('checks the keywords from the current value and previews their expansion', async () => {
    const onApply = vi.fn();
    render(
      <KeywordsEditorDialog
        isOpen
        onClose={vi.fn()}
        path="/wc/src/calc.c"
        initialValue="Rev Date"
        onApply={onApply}
      />
    );

    expect(checkbox('Rev').checked).toBe(true);
    expect(checkbox('Date').checked).toBe(true);
    expect(checkbox('Author').checked).toBe(false);
    expect(checkbox('Id').checked).toBe(false);

    const preview = screen.getByLabelText('Keyword expansion preview');
    expect(preview.textContent).toContain(`$Rev: 1234 $`);
    expect(preview.textContent).toContain(`$Date: ${SAMPLE_DATE} $`);
    // Disabled keywords stay unexpanded.
    expect(preview.textContent).toContain('$Author$');
    expect(preview.textContent).toContain('$Id$');
    // The expansion note is explicit that svn does the real substitution.
    expect(
      screen.getByText(/Substitution happens when Subversion touches the file/i)
    ).toBeTruthy();
  });

  it('toggling a keyword updates the preview and the applied value', async () => {
    const onApply = vi.fn();
    render(
      <KeywordsEditorDialog
        isOpen
        onClose={vi.fn()}
        path="/wc/src/calc.c"
        initialValue="Rev"
        onApply={onApply}
      />
    );

    fireEvent.click(checkbox('Author'));
    fireEvent.click(checkbox('Id'));

    const preview = screen.getByLabelText('Keyword expansion preview');
    expect(preview.textContent).toContain(`$Author: jordan $`);
    expect(preview.textContent).toContain(`$Id: calc.c 1234 ${SAMPLE_DATE} jordan $`);

    // Editable sample values flow into the preview.
    fireEvent.change(screen.getByLabelText('Sample revision'), { target: { value: '99' } });
    expect(preview.textContent).toContain('$Rev: 99 $');

    fireEvent.click(screen.getByRole('button', { name: /apply value/i }));
    expect(onApply).toHaveBeenCalledWith('Rev Author Id');
  });

  it('accepts custom entries and warns about unknown bare keywords', async () => {
    const onApply = vi.fn();
    render(
      <KeywordsEditorDialog
        isOpen
        onClose={vi.fn()}
        path="/wc/src/calc.c"
        initialValue=""
        onApply={onApply}
      />
    );

    const custom = screen.getByLabelText('Custom keyword entry');
    fireEvent.change(custom, { target: { value: 'BuildVersion=$Rev$-$Date$' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    fireEvent.change(custom, { target: { value: 'Frobnicate' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByText(/Not a built-in Subversion keyword/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /apply value/i }));
    expect(onApply).toHaveBeenCalledWith('BuildVersion=$Rev$-$Date$ Frobnicate');
  });

  it('warns when the target file does not look like text', () => {
    render(
      <KeywordsEditorDialog
        isOpen
        onClose={vi.fn()}
        path="/wc/logo.png"
        initialValue="Rev"
        mimeType="image/png"
        onApply={vi.fn()}
      />
    );
    expect(screen.getByText(/substitutes\s+keywords in text files/i)).toBeTruthy();
  });

  it('derives URL and HeadURL expansions from the same sample', () => {
    render(
      <KeywordsEditorDialog
        isOpen
        onClose={vi.fn()}
        path="/wc/src/calc.c"
        initialValue="URL HeadURL Header"
        onApply={vi.fn()}
      />
    );
    const preview = screen.getByLabelText('Keyword expansion preview');
    expect(preview.textContent).toContain(`$URL: ${SAMPLE_URL} $`);
    expect(preview.textContent).toContain(`$HeadURL: ${SAMPLE_URL} $`);
    expect(preview.textContent).toContain(`$Header: ${SAMPLE_URL} 1234 ${SAMPLE_DATE} jordan $`);
  });
});
