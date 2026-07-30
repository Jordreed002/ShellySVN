export async function showAppMessage(options: {
  type?: 'info' | 'warning' | 'error';
  title?: string;
  message: string;
  detail?: string;
}): Promise<void> {
  await window.api.dialog.showMessage(options);
}

export async function confirmAppAction(options: {
  type?: 'info' | 'warning' | 'error';
  title?: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<boolean> {
  return window.api.dialog.confirm(options);
}

export interface AppPromptChoice {
  value: string;
  label: string;
}

export function promptAppInput(options: {
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * A fixed set of answers. Given these, the dialog is a `<select>` — asking
   * someone to *type* one of four Subversion keywords invites a typo the dialog
   * can only reject afterwards.
   */
  choices?: readonly AppPromptChoice[];
}): Promise<string | null> {
  return new Promise((resolve) => {
    const dialogId = `prompt-dialog-${Date.now()}`;
    let settled = false;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal w-[420px]';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', `${dialogId}-title`);
    modal.addEventListener('click', (event) => event.stopPropagation());

    const header = document.createElement('div');
    header.className = 'modal-header';

    const title = document.createElement('h2');
    title.id = `${dialogId}-title`;
    title.className = 'modal-title';
    title.textContent = options.title ?? 'Input';
    header.append(title);

    const body = document.createElement('div');
    body.className = 'modal-body space-y-3';

    const label = document.createElement('label');
    label.htmlFor = `${dialogId}-input`;
    label.className = 'block text-sm font-medium text-text-secondary';
    label.textContent = options.message;

    const choices = options.choices;
    let field: HTMLInputElement | HTMLSelectElement;

    if (choices && choices.length > 0) {
      const select = document.createElement('select');
      select.id = `${dialogId}-input`;
      select.className = 'input';
      for (const choice of choices) {
        const option = document.createElement('option');
        option.value = choice.value;
        option.textContent = choice.label;
        select.append(option);
      }
      // An unknown default would silently select the first option, so only a
      // value that is actually on offer gets to win.
      const preselect = choices.some((choice) => choice.value === options.defaultValue)
        ? options.defaultValue
        : choices[0].value;
      select.value = preselect ?? choices[0].value;
      field = select;
    } else {
      const input = document.createElement('input');
      input.id = `${dialogId}-input`;
      input.className = 'input';
      input.type = 'text';
      input.value = options.defaultValue ?? '';
      input.placeholder = options.placeholder ?? '';
      field = input;
    }

    body.append(label, field);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    const cancelButton = document.createElement('button');
    cancelButton.className = 'btn btn-secondary';
    cancelButton.type = 'button';
    cancelButton.textContent = options.cancelLabel ?? 'Cancel';

    const confirmButton = document.createElement('button');
    confirmButton.className = 'btn btn-primary';
    confirmButton.type = 'button';
    confirmButton.textContent = options.confirmLabel ?? 'OK';

    footer.append(cancelButton, confirmButton);
    modal.append(header, body, footer);
    overlay.append(modal);
    document.body.append(overlay);

    const cleanup = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      document.removeEventListener('keydown', handleKeyDown);
      overlay.remove();
      resolve(value);
    };

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        cleanup(null);
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        cleanup(field.value);
      }
    }

    overlay.addEventListener('click', () => cleanup(null));
    cancelButton.addEventListener('click', () => cleanup(null));
    confirmButton.addEventListener('click', () => cleanup(field.value));
    document.addEventListener('keydown', handleKeyDown);

    requestAnimationFrame(() => field.focus());
  });
}
