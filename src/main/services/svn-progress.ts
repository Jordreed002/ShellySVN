import type { IpcMainInvokeEvent } from 'electron';
import type { CheckoutProgress, SvnOperationProgress } from '@shared/types';
import { redactValue } from '../utils/redaction';
import { DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES, runSvn, type RunSvnOptions } from './svn-executor';

const activeOperations = new Map<string, AbortController>();

export function parseSvnOutputRevision(output: string): number | null {
  const match = output.match(/(?:Committed|Exported|Updated to|Checked out) revision (\d+)\./);
  return match ? parseInt(match[1], 10) : null;
}

function parseProgressPath(line: string): string | null {
  const statusMatch = line.match(/^([AUCDGER ])\s+(.+)$/);
  if (statusMatch) {
    return statusMatch[2].trim();
  }

  const wordMatch = line.match(/^(?:Adding|Deleting|Sending|Replacing)\s+(.+)$/);
  return wordMatch?.[1]?.trim() || null;
}

function createProgressPayload(
  operationId: string,
  operation: SvnOperationProgress['operation'],
  progress: CheckoutProgress
): SvnOperationProgress {
  return { ...progress, operationId, operation };
}

export async function runSvnOperationWithProgress(
  event: IpcMainInvokeEvent,
  operationId: string,
  operation: SvnOperationProgress['operation'],
  args: string[],
  options: RunSvnOptions = {}
): Promise<{ success: boolean; revision: number | null; output?: string; error?: string }> {
  const controller = new AbortController();
  activeOperations.set(operationId, controller);

  let filesProcessed = 0;
  let currentFile = '';
  let revision: number | null = null;
  let revisionBuffer = '';
  let lineBuffer = '';
  const processedPaths = new Set<string>();

  const sendProgress = (progress: CheckoutProgress) => {
    event.sender.send(
      'svn:operation:progress',
      createProgressPayload(operationId, operation, progress)
    );
  };

  try {
    sendProgress({ status: 'running', filesProcessed });

    const result = await runSvn(args, {
      ...options,
      signal: controller.signal,
      maxStdoutBytes: options.maxStdoutBytes ?? DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
      maxStderrBytes: options.maxStderrBytes ?? DEFAULT_STREAMED_SVN_OUTPUT_CAP_BYTES,
      onStdout: (chunk) => {
        options.onStdout?.(chunk);
        revisionBuffer = (revisionBuffer + chunk).slice(-2000);
        revision = parseSvnOutputRevision(revisionBuffer) ?? revision;

        lineBuffer += chunk;
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const parsedPath = parseProgressPath(line);
          if (!parsedPath || processedPaths.has(parsedPath)) continue;

          processedPaths.add(parsedPath);
          currentFile = parsedPath;
          filesProcessed++;
          sendProgress({
            status: 'running',
            currentFile,
            filesProcessed,
          });
        }
      },
      onStderr: (chunk) => {
        options.onStderr?.(chunk);
      },
    });

    revision = revision ?? parseSvnOutputRevision(result.stdout);
    sendProgress({
      status: 'completed',
      currentFile,
      filesProcessed,
      revision,
    });

    return { success: true, revision, output: result.stdout };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error || '');
    const message = redactValue(rawMessage) as string;
    const cancelled = message.toLowerCase().includes('cancelled');
    sendProgress({
      status: cancelled ? 'cancelled' : 'error',
      currentFile,
      filesProcessed,
      error: message,
    });
    return { success: false, revision: null, error: message };
  } finally {
    if (activeOperations.get(operationId) === controller) {
      activeOperations.delete(operationId);
    }
  }
}

export function cancelSvnOperation(operationId: string): { success: boolean; error?: string } {
  const controller = activeOperations.get(operationId);
  if (!controller) {
    return { success: false, error: 'No active SVN operation found with that ID' };
  }

  controller.abort();
  activeOperations.delete(operationId);
  return { success: true };
}
