import { i18n } from "@/i18n";

export function addPendingSidebarAction(
  current: ReadonlySet<string>,
  key: string,
): ReadonlySet<string> {
  if (current.has(key)) return current;
  const next = new Set(current);
  next.add(key);
  return next;
}

export function removePendingSidebarAction(
  current: ReadonlySet<string>,
  key: string,
): ReadonlySet<string> {
  if (!current.has(key)) return current;
  const next = new Set(current);
  next.delete(key);
  return next;
}

export function sidebarCopyPendingFingerprint(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `${value.length}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
}

export function assertSidebarReviewAuthorization(
  canReview: boolean,
  requestedReview: boolean | null,
): void {
  if (requestedReview !== null && !canReview) {
    throw new Error(i18n.t("layout.sidebar.errors.reviewUnauthorized"));
  }
}

export function assertSidebarThreadArchiveAuthorization(canArchive: boolean): void {
  if (!canArchive) {
    throw new Error(i18n.t("layout.sidebar.errors.threadArchiveUnauthorized"));
  }
}

export function validateSidebarActionEnvelope(
  value: unknown,
  requestKeys: Readonly<Record<string, readonly string[]>>,
): { action: string; request: Record<string, unknown> } {
  if (!isPlainObject(value)) {
    throw new Error("Sidebar action request must be a plain object.");
  }
  if (typeof value.action !== "string" || !value.action.trim()) {
    throw new Error("action must be nonblank.");
  }
  const action = value.action.trim();
  const allowed = requestKeys[action];
  if (!allowed) throw new Error(`Unsupported sidebar action "${action}".`);

  const keys = Reflect.ownKeys(value).filter((key) =>
    Object.prototype.propertyIsEnumerable.call(value, key),
  );
  const unsupported = keys.find(
    (key) => typeof key !== "string" || !allowed.includes(key),
  );
  if (unsupported !== undefined) {
    throw new Error(
      `Sidebar action request contains unsupported field ${String(unsupported)}.`,
    );
  }
  const missing = allowed.find(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );
  if (missing) throw new Error(`Sidebar action request is missing ${missing}.`);
  return { action, request: value };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
