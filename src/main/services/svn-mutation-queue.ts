const mutationQueues = new Map<string, Promise<void>>();

function normalizeMutationKey(key: string): string {
  return key.trim().toLowerCase();
}

export async function runSerializedWorkingCopyMutation<T>(
  workingCopyKey: string,
  task: () => Promise<T>
): Promise<T> {
  const key = normalizeMutationKey(workingCopyKey);
  const previous = mutationQueues.get(key) ?? Promise.resolve();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  mutationQueues.set(key, tail);

  await previous.catch(() => undefined);

  try {
    return await task();
  } finally {
    release();
    if (mutationQueues.get(key) === tail) {
      mutationQueues.delete(key);
    }
  }
}

export function getMutationQueueStateForTests(): { keys: string[] } {
  return { keys: Array.from(mutationQueues.keys()) };
}
