/**
 * @vitest-environment jsdom
 *
 * The revert-depth prompt used to ask people to *type* one of `empty`, `files`,
 * `immediates` or `infinity`, and rejected anything else after the fact. A fixed
 * set of answers is a select.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { promptAppInput } from '../dialogs';

const DEPTHS = [
  { value: 'infinity', label: 'Fully recursive' },
  { value: 'immediates', label: 'Immediate children' },
  { value: 'files', label: 'Files only' },
  { value: 'empty', label: 'Only this item' },
] as const;

function field(): HTMLSelectElement | HTMLInputElement {
  const element = document.querySelector('.modal-body select, .modal-body input');
  if (!element) throw new Error('prompt has no field');
  return element as HTMLSelectElement | HTMLInputElement;
}

function clickButton(text: string) {
  const button = Array.from(document.querySelectorAll('.modal-footer button')).find(
    (candidate) => candidate.textContent === text
  );
  if (!button) throw new Error(`no ${text} button`);
  (button as HTMLButtonElement).click();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('promptAppInput with choices', () => {
  it('renders a select of the offered answers and returns the chosen one', async () => {
    const answer = promptAppInput({
      message: 'How much of this folder should be reverted?',
      defaultValue: 'infinity',
      choices: DEPTHS,
    });

    const select = field() as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      'infinity',
      'immediates',
      'files',
      'empty',
    ]);
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Fully recursive',
      'Immediate children',
      'Files only',
      'Only this item',
    ]);
    expect(select.value).toBe('infinity');

    select.value = 'files';
    clickButton('OK');

    await expect(answer).resolves.toBe('files');
  });

  it('falls back to the first choice rather than silently mis-selecting one', async () => {
    const answer = promptAppInput({
      message: 'Depth',
      defaultValue: 'nonsense',
      choices: DEPTHS,
    });

    expect((field() as HTMLSelectElement).value).toBe('infinity');

    clickButton('Cancel');
    await expect(answer).resolves.toBeNull();
  });

  it('still resolves on Enter, and reports a cancel as null', async () => {
    const submitted = promptAppInput({ message: 'Depth', choices: DEPTHS });
    (field() as HTMLSelectElement).value = 'empty';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await expect(submitted).resolves.toBe('empty');

    const escaped = promptAppInput({ message: 'Depth', choices: DEPTHS });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(escaped).resolves.toBeNull();
  });

  it('is still a text input when no choices are offered', async () => {
    const answer = promptAppInput({ message: 'Destination path:', defaultValue: '/wc/copy' });

    const input = field() as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.value).toBe('/wc/copy');

    input.value = '/wc/elsewhere';
    clickButton('OK');
    await expect(answer).resolves.toBe('/wc/elsewhere');
  });
});
