import { shell } from 'electron';

const ALLOWED_EXTERNAL_SCHEMES = ['http:', 'https:', 'mailto:'];

export function isValidExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_EXTERNAL_SCHEMES.includes(parsed.protocol);
  } catch {
    return false;
  }
}

export async function openValidatedExternalUrl(
  url: string
): Promise<{ success: boolean; error?: string }> {
  if (!isValidExternalUrl(url)) {
    console.warn('[SECURITY] Blocked attempt to open invalid URL:', url.substring(0, 100));
    return {
      success: false,
      error: 'Invalid URL scheme. Only http, https, and mailto are allowed.',
    };
  }

  await shell.openExternal(url);
  return { success: true };
}

