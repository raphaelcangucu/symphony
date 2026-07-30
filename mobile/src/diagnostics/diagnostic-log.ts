export type DiagnosticScope = "request" | "socket" | "system";

export type DiagnosticEntry = {
  id: string;
  at: string;
  scope: DiagnosticScope;
  event: string;
  details: Record<string, unknown>;
};

export type DiagnosticInput = Omit<DiagnosticEntry, "id" | "at">;

export type DiagnosticLog = {
  record(input: DiagnosticInput, secrets?: string[]): void;
  list(): DiagnosticEntry[];
  clear(): void;
  subscribe(listener: () => void): { remove(): void };
};

type DiagnosticLogOptions = {
  limit?: number;
  now?: () => string;
  createId?: () => string;
};

const sensitiveKey = /authorization|cookie|token|secret|password|api[-_]?key/i;

export function createDiagnosticLog({
  limit = 100,
  now = () => new Date().toISOString(),
  createId = defaultId,
}: DiagnosticLogOptions = {}): DiagnosticLog {
  const entries: DiagnosticEntry[] = [];
  const listeners = new Set<() => void>();
  const safeLimit = Math.max(1, Math.floor(limit));

  return {
    record(input, secrets = []) {
      entries.unshift({
        id: createId(),
        at: now(),
        scope: input.scope,
        event: sanitizeText(input.event, secrets),
        details: sanitizeDiagnosticValue(input.details, secrets) as Record<string, unknown>,
      });
      if (entries.length > safeLimit) entries.length = safeLimit;
      listeners.forEach((listener) => listener());
    },
    list() {
      return entries.map((entry) => ({
        ...entry,
        details: clone(entry.details),
      }));
    },
    clear() {
      entries.length = 0;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
}

export function sanitizeDiagnosticValue(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === "string") return sanitizeText(value, secrets);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticValue(item, secrets));
  }
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : sanitizeDiagnosticValue(item, secrets),
    ]),
  );
}

export const diagnosticLog = createDiagnosticLog();

function sanitizeText(value: string, secrets: string[]): string {
  let sanitized = value;
  for (const secret of secrets) {
    const trimmed = secret.trim();
    if (trimmed) sanitized = sanitized.split(trimmed).join("[REDACTED]");
  }
  sanitized = sanitized.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]");
  sanitized = sanitized.replace(
    /([?&](?:token|secret|password|api[_-]?key)=)[^&#\s]*/gi,
    "$1[REDACTED]",
  );
  return sanitized;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function defaultId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `diagnostic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
