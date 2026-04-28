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

export function promptAppInput(options: {
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
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

    const input = document.createElement('input');
    input.id = `${dialogId}-input`;
    input.className = 'input';
    input.type = 'text';
    input.value = options.defaultValue ?? '';
    input.placeholder = options.placeholder ?? '';

    body.append(label, input);

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
        cleanup(input.value);
      }
    }

    overlay.addEventListener('click', () => cleanup(null));
    cancelButton.addEventListener('click', () => cleanup(null));
    confirmButton.addEventListener('click', () => cleanup(input.value));
    document.addEventListener('keydown', handleKeyDown);

    requestAnimationFrame(() => input.focus());
  });
}
