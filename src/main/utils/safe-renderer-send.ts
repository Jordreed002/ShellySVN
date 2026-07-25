import type { WebContents } from 'electron';

export function sendToRenderer(
  sender: Pick<WebContents, 'isDestroyed' | 'send'>,
  channel: string,
  ...args: unknown[]
): boolean {
  if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) return false;
  try {
    sender.send(channel, ...args);
    return true;
  } catch {
    return false;
  }
}
