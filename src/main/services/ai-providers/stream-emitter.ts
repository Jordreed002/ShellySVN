import type { AiStreamEvent } from '@shared/types';

type AiStreamListener = (event: AiStreamEvent) => void;

let listener: AiStreamListener | undefined;

/**
 * Install the process-wide sink for AI stream events. The IPC layer forwards
 * every event to renderers on the `ai:stream` channel; tests may install their
 * own collector.
 */
export function setAiStreamListener(next: AiStreamListener | undefined): void {
  listener = next;
}

export function getAiStreamListener(): AiStreamListener | undefined {
  return listener;
}

/** Emit a stream event; listener failures never break the AI operation. */
export function emitAiStreamEvent(event: AiStreamEvent): void {
  try {
    listener?.(event);
  } catch {
    // Diagnostics sinks must never fail the provider operation itself.
  }
}
