import type { IpcMainInvokeEvent } from 'electron';

import type { WorkerProgressEvent } from './types';

export function forwardWorkerProgressToRenderer(
  event: IpcMainInvokeEvent,
  progress: WorkerProgressEvent
): void {
  event.sender.send(progress.channel, progress.payload);
}
