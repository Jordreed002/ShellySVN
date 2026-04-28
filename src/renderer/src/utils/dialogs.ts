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
