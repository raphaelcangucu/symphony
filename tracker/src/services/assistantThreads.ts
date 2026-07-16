import { notifyTrackerProjectSessionsChanged } from "@/lib/projectEvents";
import { graphemeCount, normalizeNullableString } from "@/lib/serviceNormalization";
import { requireNonBlank, requirePositiveInteger } from "@/lib/serviceValidation";
import type { AssistantThread } from "@/types/assistant-thread";
import type { AgentKind } from "@/types/issue";

import { http, trackerPath, unwrapData } from "./http";

export interface BackendAssistantThreadDto {
  id: number;
  scope: string;
  project_slug?: string | null;
  project_name?: string | null;
  agent_kind?: string | null;
  issue_identifier?: string | null;
  workspace_path?: unknown;
  labels?: unknown;
  needs_review?: unknown;
  title?: string | null;
  status: string;
  preview?: string | null;
  updated_at?: string | null;
}

export function normalizeAssistantThread(dto: BackendAssistantThreadDto): AssistantThread {
  return {
    id: dto.id,
    scope: dto.scope,
    agentKind: normalizeAgentKind(dto.agent_kind),
    projectSlug: dto.project_slug ?? null,
    projectName: dto.project_name ?? null,
    issueIdentifier: dto.issue_identifier ?? null,
    workspacePath: normalizeNullableString(dto.workspace_path),
    labels: normalizeStringArray(dto.labels),
    needsReview: dto.needs_review === true,
    title: dto.title ?? null,
    status: dto.status,
    preview: dto.preview ?? null,
    updatedAt: dto.updated_at ?? "",
  };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : [];
}

function normalizeAgentKind(value: string | null | undefined): AssistantThread["agentKind"] {
  return value === "codex" || value === "claude" || value === "cursor" ? value : null;
}

const LIST_CACHE_TTL_MS = 15_000;
const GET_CACHE_TTL_MS = 30_000;

type CacheEntry<T> = { value: T; at: number };
const listInFlight = new Map<string, Promise<AssistantThread[]>>();
const listCache = new Map<string, CacheEntry<AssistantThread[]>>();
const getInFlight = new Map<number, Promise<AssistantThread>>();
const getCache = new Map<number, CacheEntry<AssistantThread>>();

function readCache<T>(cache: Map<string | number, CacheEntry<T>>, key: string | number, ttlMs: number): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

/** @internal test helper */
export function clearAssistantThreadRequestCaches(): void {
  listInFlight.clear();
  listCache.clear();
  getInFlight.clear();
  getCache.clear();
}

export async function listAssistantThreads(
  scopeOrOptions: string | ListAssistantThreadsOptions = "freeform",
): Promise<AssistantThread[]> {
  const params = new URLSearchParams();
  if (typeof scopeOrOptions === "string") {
    params.set("scope", scopeOrOptions);
  } else {
    if (scopeOrOptions.scope) params.set("scope", scopeOrOptions.scope);
    if (scopeOrOptions.scopes?.length) params.set("scopes", scopeOrOptions.scopes.join(","));
    if (scopeOrOptions.projectSlug) params.set("project_slug", scopeOrOptions.projectSlug);
    if (scopeOrOptions.issueIdentifier) params.set("issue_identifier", scopeOrOptions.issueIdentifier);
    if (scopeOrOptions.limit != null) params.set("limit", String(scopeOrOptions.limit));
    if (scopeOrOptions.includeArchived === true) params.set("include_archived", "true");
  }

  const cacheKey = params.toString();
  const cached = readCache(listCache, cacheKey, LIST_CACHE_TTL_MS);
  if (cached) return cached;

  const existing = listInFlight.get(cacheKey);
  if (existing) return existing;

  const request = http
    .get(trackerPath(`/assistant/threads?${cacheKey}`))
    .then((response) => {
      const threads = unwrapData<BackendAssistantThreadDto[]>(response).map(normalizeAssistantThread);
      listCache.set(cacheKey, { value: threads, at: Date.now() });
      return threads;
    })
    .finally(() => {
      listInFlight.delete(cacheKey);
    });

  listInFlight.set(cacheKey, request);
  return request;
}

export interface ListAssistantThreadsOptions {
  scope?: string;
  scopes?: string[];
  projectSlug?: string;
  issueIdentifier?: string;
  limit?: number;
  includeArchived?: boolean;
}

export interface UpdateAssistantThreadInput {
  title?: string;
  labels?: string[];
  needsReview?: boolean;
}

const MAX_THREAD_TITLE_GRAPHEMES = 160;
const MAX_THREAD_LABELS = 12;
const MAX_THREAD_LABEL_GRAPHEMES = 40;
const UPDATE_THREAD_KEYS = ["title", "labels", "needsReview"] as const;

export async function getAssistantThread(threadId: number): Promise<AssistantThread> {
  requirePositiveInteger(threadId, "threadId");

  const cached = readCache(getCache, threadId, GET_CACHE_TTL_MS);
  if (cached) return cached;

  const existing = getInFlight.get(threadId);
  if (existing) return existing;

  const request = http
    .get(trackerPath(`/assistant/threads/${encodeURIComponent(String(threadId))}`))
    .then((response) => {
      const thread = normalizeAssistantThread(unwrapData<BackendAssistantThreadDto>(response));
      getCache.set(threadId, { value: thread, at: Date.now() });
      return thread;
    })
    .finally(() => {
      getInFlight.delete(threadId);
    });

  getInFlight.set(threadId, request);
  return request;
}

export async function updateAssistantThread(
  threadId: number,
  input: UpdateAssistantThreadInput,
): Promise<AssistantThread> {
  requirePositiveInteger(threadId, "threadId");
  const payload = normalizeUpdateAssistantThreadInput(input);
  const response = await http.patch(
    trackerPath(`/assistant/threads/${encodeURIComponent(String(threadId))}`),
    payload,
  );
  const thread = normalizeAssistantThread(unwrapData<BackendAssistantThreadDto>(response));
  getCache.set(threadId, { value: thread, at: Date.now() });
  listCache.clear();
  return thread;
}

export async function generateAssistantThreadTitle(threadId: number): Promise<AssistantThread> {
  requirePositiveInteger(threadId, "threadId");
  const response = await http.post(
    trackerPath(`/assistant/threads/${encodeURIComponent(String(threadId))}/generate_title`),
  );
  const thread = normalizeAssistantThread(unwrapData<BackendAssistantThreadDto>(response));
  getCache.set(threadId, { value: thread, at: Date.now() });
  listCache.clear();
  return thread;
}

export async function deleteAssistantThread(threadId: number): Promise<void> {
  requirePositiveInteger(threadId, "threadId");
  await http.delete(trackerPath(`/assistant/threads/${encodeURIComponent(String(threadId))}`));
  getCache.delete(threadId);
  listCache.clear();
}

function normalizeUpdateAssistantThreadInput(input: UpdateAssistantThreadInput): {
  title?: string;
  labels?: string[];
  needs_review?: boolean;
} {
  if (!isPlainObject(input)) {
    throw new Error("Assistant thread update input must be a plain object");
  }

  const enumerableKeys = Reflect.ownKeys(input).filter((key) =>
    Object.prototype.propertyIsEnumerable.call(input, key),
  );
  const unknownKey = enumerableKeys.find(
    (key) => typeof key !== "string" || !UPDATE_THREAD_KEYS.includes(key as never),
  );
  if (unknownKey !== undefined) {
    throw new Error(`Assistant thread update input contains unsupported field ${String(unknownKey)}`);
  }

  const supportedKeys = enumerableKeys as (typeof UPDATE_THREAD_KEYS)[number][];
  if (supportedKeys.length === 0) {
    throw new Error("Assistant thread update input must include at least one supported field");
  }

  const payload: { title?: string; labels?: string[]; needs_review?: boolean } = {};
  if (supportedKeys.includes("title")) {
    payload.title = normalizeTitle(input.title);
  }
  if (supportedKeys.includes("labels")) {
    payload.labels = normalizeLabels(input.labels);
  }
  if (supportedKeys.includes("needsReview")) {
    if (typeof input.needsReview !== "boolean") {
      throw new Error("needsReview must be a boolean");
    }
    payload.needs_review = input.needsReview;
  }
  return payload;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeTitle(value: unknown): string {
  const title = requireNonBlank(value as string, "title");
  if (graphemeCount(title) > MAX_THREAD_TITLE_GRAPHEMES) {
    throw new Error(`title must not exceed ${MAX_THREAD_TITLE_GRAPHEMES} graphemes`);
  }
  return title;
}

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((label) => typeof label === "string")) {
    throw new Error("labels must be an array of strings");
  }

  const labels = [...new Set(value.map((label) => label.trim()).filter(Boolean))];
  if (labels.length > MAX_THREAD_LABELS) {
    throw new Error(`labels must contain at most ${MAX_THREAD_LABELS} entries`);
  }
  if (labels.some((label) => graphemeCount(label) > MAX_THREAD_LABEL_GRAPHEMES)) {
    throw new Error(`labels must not exceed ${MAX_THREAD_LABEL_GRAPHEMES} graphemes`);
  }
  return labels;
}

export async function createFreeformThread(input: {
  title?: string;
  agentKind?: AgentKind | null;
  model?: string;
  effort?: string;
} = {}): Promise<AssistantThread> {
  const response = await http.post(trackerPath("/assistant/threads"), {
    scope: "freeform",
    title: input.title,
    agent_kind: input.agentKind ?? undefined,
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
  });
  return normalizeAssistantThread(unwrapData<BackendAssistantThreadDto>(response));
}

/**
 * Resolves the freeform thread the docked Maestro host should bind to on home /
 * observability: the most recently active freeform thread, creating one when
 * none exist. Mirrors opening `/assistant` with no id, but never leaves the
 * host without a thread.
 */
export async function ensureActiveFreeformThread(): Promise<AssistantThread> {
  const response = await http.post(trackerPath("/assistant/threads/freeform/active"), {});
  return normalizeAssistantThread(unwrapData<BackendAssistantThreadDto>(response));
}

export async function createProjectSessionThread(
  projectSlug: string,
  input: {
    title?: string;
    agentKind?: AgentKind | null;
    model?: string;
    effort?: string;
    workspacePath?: string;
  } = {},
): Promise<AssistantThread> {
  const workspacePath = normalizeOptionalWorkspacePath(input.workspacePath);
  const response = await http.post(trackerPath("/assistant/threads"), {
    scope: "project_session",
    project_slug: projectSlug,
    title: input.title,
    agent_kind: input.agentKind ?? undefined,
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    ...(workspacePath === undefined ? {} : { workspace_path: workspacePath }),
  });
  const thread = normalizeAssistantThread(unwrapData<BackendAssistantThreadDto>(response));
  notifyTrackerProjectSessionsChanged(projectSlug);
  return thread;
}

export async function createIssueSessionThread(
  projectSlug: string,
  issueIdentifier: string,
  input: {
    title?: string;
    agentKind?: AgentKind | null;
    executionMode?: "plan" | "build" | "yolo";
    model?: string;
    effort?: string;
    /** When true the session gets its own clean sibling working tree instead of sharing the issue's. */
    isolatedWorkspace?: boolean;
    /** When true the session reuses the parent issue's canonical working tree. */
    useParentWorkspace?: boolean;
    workspacePath?: string;
    /** Per-repo clone branch overrides (repo workspace path → branch). */
    cloneBranches?: Record<string, string>;
    /** Single default clone branch for hook-based projects. */
    cloneBranch?: string;
  } = {},
): Promise<AssistantThread> {
  const workspacePath = normalizeOptionalWorkspacePath(input.workspacePath);
  validateExplicitWorkspaceOptions(workspacePath, input);
  const response = await http.post(trackerPath("/assistant/threads"), {
    scope: "issue_session",
    project_slug: projectSlug,
    issue_identifier: issueIdentifier,
    title: input.title,
    agent_kind: input.agentKind ?? undefined,
    execution_mode: input.executionMode ?? "build",
    model: input.model ?? undefined,
    effort: input.effort ?? undefined,
    isolated_workspace: input.isolatedWorkspace === true ? true : undefined,
    use_parent_workspace: input.useParentWorkspace === true ? true : undefined,
    ...(workspacePath === undefined ? {} : { workspace_path: workspacePath }),
    ...(normalizeCloneBranches(input.cloneBranches, input.cloneBranch) ?? {}),
  });
  const thread = normalizeAssistantThread(unwrapData<BackendAssistantThreadDto>(response));
  notifyTrackerProjectSessionsChanged(projectSlug);
  return thread;
}

function normalizeCloneBranches(
  cloneBranches: Record<string, string> | undefined,
  cloneBranch: string | undefined,
): { clone_branches?: Record<string, string>; clone_branch?: string } | undefined {
  const overrides = Object.fromEntries(
    Object.entries(cloneBranches ?? {}).filter(([, branch]) => branch.trim() !== ""),
  );

  if (Object.keys(overrides).length > 0) {
    return { clone_branches: overrides };
  }

  const trimmed = cloneBranch?.trim();
  if (trimmed) return { clone_branch: trimmed };
  return undefined;
}

function normalizeOptionalWorkspacePath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("workspacePath must be an absolute path");
  }

  const workspacePath = value.trim();
  if (workspacePath === "" || workspacePath.includes("\0") || !workspacePath.startsWith("/")) {
    throw new Error("workspacePath must be a nonblank absolute path without NUL characters");
  }
  return workspacePath;
}

function validateExplicitWorkspaceOptions(
  workspacePath: string | undefined,
  input: { isolatedWorkspace?: boolean; useParentWorkspace?: boolean },
): void {
  if (workspacePath === undefined) return;

  // An explicit path already selects the workspace. Only omitted or false
  // legacy selection flags are non-conflicting.
  for (const [name, value] of [
    ["isolatedWorkspace", input.isolatedWorkspace],
    ["useParentWorkspace", input.useParentWorkspace],
  ] as const) {
    if (value !== undefined && value !== false) {
      throw new Error(`${name} must be omitted or false when workspacePath is supplied`);
    }
  }
}

export async function archiveAssistantThread(threadId: number): Promise<AssistantThread> {
  requirePositiveInteger(threadId, "threadId");

  const response = await http.post(
    trackerPath(`/assistant/threads/${encodeURIComponent(String(threadId))}/archive`),
  );
  return normalizeAssistantThread(unwrapData<BackendAssistantThreadDto>(response));
}
