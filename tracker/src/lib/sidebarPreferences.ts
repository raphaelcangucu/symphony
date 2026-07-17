import type { SidebarSortMode } from "@/types/sidebar";

export const SIDEBAR_PREFERENCES_STORAGE_KEY = "symphony:sidebar:v1";
export const LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY = "tracker-sidebar-collapsed";
export const SIDEBAR_PREFERENCES_VERSION = 1 as const;
export const SIDEBAR_MAX_ID_COLLECTION_SIZE = 256;
export const SIDEBAR_MAX_LAST_READ_ENTRIES = 512;
export const SIDEBAR_MAX_ID_LENGTH = 512;

export type SidebarGroupMode = "none" | "workspaceKind" | "status";
export type SidebarFilterAgent = "codex" | "claude" | "cursor" | "opencode";

export interface SidebarPreferences {
  version: typeof SIDEBAR_PREFERENCES_VERSION;
  collapsed: boolean;
  expandedProjectIds: string[];
  expandedWorkspaceIds: string[];
  pinnedProjectIds: string[];
  pinnedWorkspaceIds: string[];
  pinnedSessionIds: string[];
  sort: SidebarSortMode;
  group: SidebarGroupMode;
  filters: {
    statuses: string[];
    agents: SidebarFilterAgent[];
    showArchived: boolean;
    activityOnly: boolean;
  };
  lastReadAtBySession: Record<string, string>;
  revealedProjectIds: string[];
  revealedWorkspaceIds: string[];
}

const VALID_SORT_MODES = new Set<SidebarSortMode>(["activity", "name"]);
const VALID_GROUP_MODES = new Set<SidebarGroupMode>(["none", "workspaceKind", "status"]);
const VALID_AGENTS = new Set<SidebarFilterAgent>(["codex", "claude", "cursor", "opencode"]);
const UNSAFE_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function defaultSidebarPreferences(): SidebarPreferences {
  return {
    version: SIDEBAR_PREFERENCES_VERSION,
    collapsed: false,
    expandedProjectIds: [],
    expandedWorkspaceIds: [],
    pinnedProjectIds: [],
    pinnedWorkspaceIds: [],
    pinnedSessionIds: [],
    sort: "activity",
    group: "none",
    filters: {
      statuses: [],
      agents: [],
      showArchived: false,
      activityOnly: false,
    },
    lastReadAtBySession: Object.create(null) as Record<string, string>,
    revealedProjectIds: [],
    revealedWorkspaceIds: [],
  };
}

export function migrateSidebarPreferences(
  raw: unknown,
  legacyCollapsed?: unknown,
): SidebarPreferences {
  const defaults = defaultSidebarPreferences();
  const parsed = parseRawPreferences(raw);
  const source =
    isPlainRecord(parsed) && parsed.version === SIDEBAR_PREFERENCES_VERSION ? parsed : null;
  if (!source) {
    const collapsed = parseLegacyCollapsed(legacyCollapsed);
    return collapsed === null ? defaults : { ...defaults, collapsed };
  }

  const filters = isPlainRecord(source.filters) ? source.filters : null;
  const collapsed =
    typeof source.collapsed === "boolean"
      ? source.collapsed
      : parseLegacyCollapsed(legacyCollapsed) ?? defaults.collapsed;

  return {
    version: SIDEBAR_PREFERENCES_VERSION,
    collapsed,
    expandedProjectIds: sanitizeStringCollection(source.expandedProjectIds),
    expandedWorkspaceIds: sanitizeStringCollection(source.expandedWorkspaceIds),
    pinnedProjectIds: sanitizeStringCollection(source.pinnedProjectIds),
    pinnedWorkspaceIds: sanitizeStringCollection(source.pinnedWorkspaceIds),
    pinnedSessionIds: sanitizeStringCollection(source.pinnedSessionIds),
    sort: isAllowedString(source.sort, VALID_SORT_MODES) ? source.sort : defaults.sort,
    group: isAllowedString(source.group, VALID_GROUP_MODES) ? source.group : defaults.group,
    filters: {
      statuses: sanitizeStringCollection(filters?.statuses),
      agents: sanitizeAllowedCollection(filters?.agents, VALID_AGENTS),
      showArchived:
        typeof filters?.showArchived === "boolean"
          ? filters.showArchived
          : defaults.filters.showArchived,
      activityOnly:
        typeof filters?.activityOnly === "boolean"
          ? filters.activityOnly
          : defaults.filters.activityOnly,
    },
    lastReadAtBySession: sanitizeLastReadMap(source.lastReadAtBySession),
    revealedProjectIds: sanitizeStringCollection(source.revealedProjectIds),
    revealedWorkspaceIds: sanitizeStringCollection(source.revealedWorkspaceIds),
  };
}

export function readSidebarPreferences(storage?: Storage): SidebarPreferences {
  const target = storage ?? safelyResolveLocalStorage();
  if (!target) return defaultSidebarPreferences();

  try {
    const raw = target.getItem(SIDEBAR_PREFERENCES_STORAGE_KEY);
    const legacyCollapsed = target.getItem(LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY);
    return withEphemeralReveal(migrateSidebarPreferences(raw, legacyCollapsed));
  } catch {
    return defaultSidebarPreferences();
  }
}

export function writeSidebarPreferences(
  preferences: SidebarPreferences,
  storage?: Storage,
): boolean {
  const target = storage ?? safelyResolveLocalStorage();
  if (!target) return false;

  try {
    const snapshot = withEphemeralReveal(migrateSidebarPreferences(preferences));
    target.setItem(SIDEBAR_PREFERENCES_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

/**
 * "More" reveals (revealed*Ids) are a transient per-view expansion, not a saved
 * preference. Clearing them at the persistence boundary keeps each reload
 * collapsed to the default page size while leaving the in-memory updater — which
 * calls migrateSidebarPreferences directly — free to reveal within a session.
 */
function withEphemeralReveal(preferences: SidebarPreferences): SidebarPreferences {
  if (
    preferences.revealedProjectIds.length === 0 &&
    preferences.revealedWorkspaceIds.length === 0
  ) {
    return preferences;
  }
  return { ...preferences, revealedProjectIds: [], revealedWorkspaceIds: [] };
}

function safelyResolveLocalStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function parseRawPreferences(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  if (raw.trim().length === 0) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseLegacyCollapsed(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  if (value.trim() === "true") return true;
  if (value.trim() === "false") return false;
  return null;
}

function sanitizeStringCollection(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const sanitized: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const id = sanitizeId(candidate);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    sanitized.push(id);
    if (sanitized.length >= SIDEBAR_MAX_ID_COLLECTION_SIZE) break;
  }
  return sanitized;
}

function sanitizeAllowedCollection<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T[] {
  return sanitizeStringCollection(value).filter((candidate): candidate is T =>
    allowed.has(candidate as T),
  );
}

function sanitizeLastReadMap(value: unknown): Record<string, string> {
  const sanitized = Object.create(null) as Record<string, string>;
  if (!isPlainRecord(value)) return sanitized;

  let count = 0;
  for (const [rawId, timestamp] of Object.entries(value)) {
    if (count >= SIDEBAR_MAX_LAST_READ_ENTRIES) break;
    const id = sanitizeId(rawId);
    if (!id || UNSAFE_RECORD_KEYS.has(id) || !isIsoTimestamp(timestamp)) continue;
    sanitized[id] = timestamp;
    count += 1;
  }
  return sanitized;
}

function sanitizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > SIDEBAR_MAX_ID_LENGTH) return null;
  return trimmed;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zoneHourText, zoneMinuteText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const zoneHour = zoneHourText === undefined ? 0 : Number(zoneHourText);
  const zoneMinute = zoneMinuteText === undefined ? 0 : Number(zoneMinuteText);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
    return false;
  }
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (zoneHour > 14 || zoneMinute > 59 || (zoneHour === 14 && zoneMinute !== 0)) return false;
  return Number.isFinite(Date.parse(value));
}

function isAllowedString<T extends string>(value: unknown, allowed: ReadonlySet<T>): value is T {
  return typeof value === "string" && allowed.has(value as T);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
