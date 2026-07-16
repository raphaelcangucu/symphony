const STORAGE_KEY = "symphony:pending-thread-seed";

export interface PendingThreadSeed {
  threadId: number;
  message: string;
  createdAt: number;
}

export function stashPendingThreadSeed(threadId: number, message: string): void {
  const trimmed = message.trim();
  if (!Number.isInteger(threadId) || threadId <= 0 || !trimmed) return;
  const payload: PendingThreadSeed = {
    threadId,
    message: trimmed,
    createdAt: Date.now(),
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function consumePendingThreadSeed(threadId: number): string | null {
  if (!Number.isInteger(threadId) || threadId <= 0) return null;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PendingThreadSeed;
    if (parsed.threadId !== threadId || typeof parsed.message !== "string") {
      return null;
    }
    sessionStorage.removeItem(STORAGE_KEY);
    const trimmed = parsed.message.trim();
    return trimmed || null;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}
