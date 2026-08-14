type WriteListener = () => void;

const listeners = new Set<WriteListener>();

export function announceQueuedLocalWrite(): void {
  for (const listener of listeners) listener();
}

export function subscribeToQueuedLocalWrites(listener: WriteListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
