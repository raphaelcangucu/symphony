const STORAGE_KEY = "symphony:pending-thread-seed";

export interface PendingThreadSeed {
  threadId: number;
  message: string;
  createdAt: number;
}

/** Survives React StrictMode remounts after sessionStorage is cleared on first read. */
const memorySeeds = new Map<number, string>();

export function stashPendingThreadSeed(threadId: number, message: string): void {
  const trimmed = message.trim();
  if (!Number.isInteger(threadId) || threadId <= 0 || !trimmed) return;
  const payload: PendingThreadSeed = {
    threadId,
    message: trimmed,
    createdAt: Date.now(),
  };
  memorySeeds.set(threadId, trimmed);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function consumePendingThreadSeed(threadId: number): string | null {
  if (!Number.isInteger(threadId) || threadId <= 0) return null;

  const fromMemory = memorySeeds.get(threadId);
  if (fromMemory) {
    clearStorageIfThread(threadId);
    return fromMemory;
  }

  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PendingThreadSeed;
    if (parsed.threadId !== threadId || typeof parsed.message !== "string") {
      return null;
    }
    const trimmed = parsed.message.trim();
    if (!trimmed) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    memorySeeds.set(threadId, trimmed);
    sessionStorage.removeItem(STORAGE_KEY);
    return trimmed;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

/** Drop the in-memory seed after it has been sent (or abandoned). */
export function clearPendingThreadSeed(threadId: number): void {
  if (!Number.isInteger(threadId) || threadId <= 0) return;
  memorySeeds.delete(threadId);
  clearStorageIfThread(threadId);
}

function clearStorageIfThread(threadId: number): void {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as PendingThreadSeed;
    if (parsed.threadId === threadId) {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}
