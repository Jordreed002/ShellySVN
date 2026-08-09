import type { SvnCommandErrorDetails } from '@shared/types';

export function assertSuccessfulSvnRead<
  T extends {
    error?: string;
    parseError?: string;
    cancelled?: boolean;
    commandError?: SvnCommandErrorDetails;
  },
>(result: T): T {
  const message =
    result.error ||
    (result.cancelled ? 'SVN operation cancelled' : undefined) ||
    (result.parseError ? `Failed to parse SVN response: ${result.parseError}` : undefined);
  if (message) {
    const error = new Error(message) as Error & { commandError?: SvnCommandErrorDetails };
    error.commandError = result.commandError;
    throw error;
  }
  return result;
}
