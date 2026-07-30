import type {
  SvnCommandErrorCategory,
  SvnCommandErrorDetails,
} from '@shared/types';
import { redactValue } from './redaction';

export interface SvnCommandContext {
  command?: string;
  target?: string;
}

function classifyError(message: string): SvnCommandErrorCategory {
  if (/cancel(?:led|ed)/i.test(message)) return 'cancelled';
  if (/timed? out|timeout/i.test(message)) return 'timeout';
  if (/\b(?:E215004|E170001)\b|authentication|authorization|no more credentials/i.test(message)) {
    return 'authentication';
  }
  if (/\bE230001\b|certificate|unknown ca|hostname.*mismatch/i.test(message)) {
    return 'certificate';
  }
  if (/\bE155007\b|not a working copy|working copy.*format/i.test(message)) {
    return 'working-copy';
  }
  if (/\bE155004\b|working copy.*locked|is locked/i.test(message)) return 'locked';
  if (/\bE160028\b|out[- ]of[- ]date/i.test(message)) return 'out-of-date';
  if (/\bE170013\b|unable to connect|connection (?:failed|refused)|network/i.test(message)) {
    return 'network';
  }
  if (/\b(?:E160013|W160013|E200009)\b|not found|does not exist/i.test(message)) {
    return 'not-found';
  }
  if (/\bconflict/i.test(message)) return 'conflict';
  if (/invalid|required|must not|unsafe/i.test(message)) return 'validation';
  return 'command';
}

export function classifySvnCommandError(
  error: unknown,
  context: SvnCommandContext = {}
): SvnCommandErrorDetails {
  const existing =
    error && typeof error === 'object' && 'commandError' in error
      ? (error as { commandError?: SvnCommandErrorDetails }).commandError
      : undefined;
  if (existing) {
    return {
      ...existing,
      command: existing.command ?? context.command,
      target: existing.target ?? context.target,
    };
  }

  const rawMessage = error instanceof Error ? error.message : String(error || 'Unknown SVN error');
  const message = redactValue(rawMessage) as string;
  const svnErrorCode = /\b([EW]\d{6})\b/.exec(message)?.[1];
  const category = classifyError(message);
  return {
    message,
    ...(svnErrorCode ? { svnErrorCode } : {}),
    category,
    ...(context.command ? { command: context.command } : {}),
    ...(context.target ? { target: context.target } : {}),
    retryable: ['authentication', 'certificate', 'network', 'locked', 'out-of-date', 'timeout'].includes(
      category
    ),
    authenticationRequired: category === 'authentication',
    certificateError: category === 'certificate',
    safeStderr: message,
  };
}

/**
 * `svn info`/`status` on a path outside a checkout is a normal answer, not a
 * failure: the Explorer probes every folder the user opens. Subversion reports
 * it as E155007 / E155010 / "is not a working copy", and callers use this to
 * keep the expected case out of the error log.
 */
export function isNotAWorkingCopyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /E155007|E155010|W155010|is not a working copy|not a versioned resource/i.test(message);
}

export class SvnCommandError extends Error {
  readonly commandError: SvnCommandErrorDetails;

  constructor(error: unknown, context: SvnCommandContext = {}) {
    const commandError = classifySvnCommandError(error, context);
    super(commandError.message);
    this.name = 'SvnCommandError';
    this.commandError = commandError;
  }
}

export function getSvnReadError(error: unknown, context: SvnCommandContext = {}): {
  error: string;
  errorCode?: string;
  cancelled?: boolean;
  commandError: SvnCommandErrorDetails;
} {
  const commandError = classifySvnCommandError(error, context);
  return {
    error: commandError.message,
    ...(commandError.svnErrorCode ? { errorCode: commandError.svnErrorCode } : {}),
    ...(commandError.category === 'cancelled' ? { cancelled: true } : {}),
    commandError,
  };
}
