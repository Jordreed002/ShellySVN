import type { ReviewCenterCapture } from './types';

export const REVIEW_CENTER_CAPTURE_EVENT = 'shellysvn:ai-review-capture';
export const REVIEW_CENTER_OPEN_EVENT = 'shellysvn:open-ai-review-center';

let persistenceQueue: Promise<void> = Promise.resolve();

export function captureReviewCenterResult(detail: ReviewCenterCapture): Promise<void> {
  persistenceQueue = persistenceQueue
    .catch(() => undefined)
    .then(async () => {
      const { captureResult, parseReviewCenterWorkspace, reviewCenterStorageKey } =
        await import('./reviewCenterStore');
      const key = reviewCenterStorageKey(detail.workingCopyPath);
      const stored = await window.api.store.get(key);
      const next = captureResult(
        parseReviewCenterWorkspace(stored, detail.workingCopyPath),
        detail
      );
      await window.api.store.set(key, next);
      if (detail.kind === 'plan') {
        const { commitStackStorageKey, ingestCommitPlan, parseCommitStack } =
          await import('./commitStackStore');
        const stackKey = commitStackStorageKey(detail.workingCopyPath);
        const storedStack = await window.api.store.get(stackKey);
        await window.api.store.set(
          stackKey,
          ingestCommitPlan(
            parseCommitStack(storedStack, detail.workingCopyPath),
            detail.result,
            detail.checksum
          )
        );
      }
      window.dispatchEvent(
        new CustomEvent<ReviewCenterCapture>(REVIEW_CENTER_CAPTURE_EVENT, { detail })
      );
    });
  return persistenceQueue;
}

/** Stable, non-cryptographic identity for determining whether a review is stale. */
export function checksumReviewInput(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
