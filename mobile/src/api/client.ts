import { redactSecret } from "@/auth/connection-profile";

import type {
  AgentKind,
  AssistantAgentCatalog,
  AssistantCatalog,
  AssistantEffortOption,
  AssistantModelOption,
  AssistantThread,
  CreateThreadInput,
  CreateIssueInput,
  GoalControlInput,
  Health,
  IssueBlocker,
  IssueComment,
  IssueDispatchInput,
  IssueDispatchResult,
  IssueFormOptions,
  IssueListOptions,
  IssueMutationInput,
  IssuePriority,
  IssueSummary,
  ProjectSessionRow,
  ProjectSummary,
  ThreadListOptions,
  TrackerClient,
  Viewer,
} from "./contracts";
import {
  TrackerAuthError,
  TrackerProtocolError,
  TrackerRequestError,
  TrackerTimeoutError,
} from "./errors";

type CreateTrackerClientOptions = {
  origin: string;
  token: string;
  locale: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal | undefined;
  tracker?: boolean;
  idempotencyKey?: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const AGENT_KINDS: readonly AgentKind[] = ["codex", "claude", "cursor", "opencode"];

export function createTrackerClient(options: CreateTrackerClientOptions): TrackerClient {
  const origin = options.origin.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request(path: string, requestOptions: RequestOptions = {}): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    requestOptions.signal?.addEventListener("abort", onCallerAbort, { once: true });

    const basePath = requestOptions.tracker === false ? "/api" : "/api/tracker/v1";
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${options.token}`,
      "X-Symphony-Locale": options.locale,
    };
    if (requestOptions.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (requestOptions.idempotencyKey) {
      headers["Idempotency-Key"] = requestOptions.idempotencyKey;
    }

    try {
      const response = await fetchImpl(`${origin}${basePath}${path}`, {
        method: requestOptions.method ?? "GET",
        headers,
        signal: controller.signal,
        ...(requestOptions.body === undefined ? {} : { body: JSON.stringify(requestOptions.body) }),
      });

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        throw new TrackerProtocolError(
          `Tracker returned unsupported content type: ${contentType || "missing"}`,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new TrackerProtocolError("Tracker returned invalid JSON");
      }

      if (!response.ok) {
        const message = redactSecret(
          readErrorMessage(payload) ?? `Tracker request failed`,
          options.token,
        );
        if (response.status === 401 || response.status === 403) {
          throw new TrackerAuthError(message, response.status);
        }
        throw new TrackerRequestError(message, response.status);
      }

      return payload;
    } catch (cause) {
      if (cause instanceof TrackerRequestError) throw cause;
      if (timedOut) throw new TrackerTimeoutError();
      if (controller.signal.aborted && requestOptions.signal?.aborted) {
        throw new TrackerRequestError("Tracker request was cancelled");
      }
      const message = cause instanceof Error ? cause.message : "Tracker request failed";
      throw new TrackerRequestError(redactSecret(message, options.token));
    } finally {
      clearTimeout(timeout);
      requestOptions.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  return {
    async health(signal) {
      return mapHealth(await request("/health", { signal, tracker: false }));
    },
    async viewer(signal) {
      return mapViewer(unwrapData(await request("/viewer", { signal })));
    },
    async projects(signal) {
      return readArray(unwrapData(await request("/projects", { signal })), "projects").map(
        mapProject,
      );
    },
    async threads(threadOptions = {}, signal) {
      const query = threadListQuery(threadOptions);
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return readArray(
        unwrapData(await request(`/assistant/threads${suffix}`, { signal })),
        "threads",
      ).map(mapThread);
    },
    async projectSessions(projectSlug, projectOptions = {}, signal) {
      const query = new URLSearchParams();
      if (projectOptions.limit !== undefined) {
        query.set("limit", String(projectOptions.limit));
      }
      if (projectOptions.cursor?.trim()) query.set("cursor", projectOptions.cursor.trim());
      if (projectOptions.includeArchived === true) query.set("include_archived", "true");
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      const payload = asRecord(
        await request(
          `/projects/${encodeURIComponent(requireText(projectSlug, "project slug"))}/sessions${suffix}`,
          { signal },
        ),
        "project sessions",
      );
      const meta = isRecord(payload.meta) ? payload.meta : {};
      return {
        sessions: readArray(payload.data, "project sessions").map(mapProjectSession),
        nextCursor: optionalText(meta.next_cursor),
      };
    },
    async assistantCatalog(projectSlug, signal) {
      const payload = unwrapData(
        await request(
          `/projects/${encodeURIComponent(requireText(projectSlug, "project slug"))}/assistant/config`,
          { signal },
        ),
      );
      return mapAssistantCatalog(payload);
    },
    async createThread(input, signal) {
      const payload = createThreadPayload(input);
      return mapThread(
        unwrapData(
          await request("/assistant/threads", {
            method: "POST",
            body: payload,
            idempotencyKey: input.requestKey,
            signal,
          }),
        ),
      );
    },
    async issues(projectSlug, issueOptions = {}, signal) {
      const query = issueListQuery(issueOptions);
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return readArray(
        unwrapData(
          await request(`${issuePath(projectSlug)}${suffix}`, {
            signal,
          }),
        ),
        "issues",
      ).map(mapIssue);
    },
    async issue(projectSlug, identifier, signal) {
      return mapIssue(
        unwrapData(await request(`${issuePath(projectSlug)}/${segment(identifier)}`, { signal })),
      );
    },
    async issueFormOptions(projectSlug, signal) {
      return mapIssueFormOptions(
        unwrapData(await request(`${issuePath(projectSlug)}/form_options`, { signal })),
      );
    },
    async createIssue(projectSlug, input, signal) {
      return mapIssue(
        unwrapData(
          await request(issuePath(projectSlug), {
            method: "POST",
            body: issueMutationPayload(input),
            signal,
          }),
        ),
      );
    },
    async updateIssue(projectSlug, identifier, input, signal) {
      return mapIssue(
        unwrapData(
          await request(`${issuePath(projectSlug)}/${segment(identifier)}`, {
            method: "PATCH",
            body: issueMutationPayload(input),
            signal,
          }),
        ),
      );
    },
    async comments(projectSlug, identifier, signal) {
      return readArray(
        unwrapData(
          await request(`${issuePath(projectSlug)}/${segment(identifier)}/comments`, { signal }),
        ),
        "comments",
      ).map(mapComment);
    },
    async createComment(projectSlug, identifier, body, signal) {
      return mapComment(
        unwrapData(
          await request(`${issuePath(projectSlug)}/${segment(identifier)}/comments`, {
            method: "POST",
            body: { body: requireText(body, "comment body") },
            signal,
          }),
        ),
      );
    },
    async blockers(projectSlug, identifier, signal) {
      return readArray(
        unwrapData(
          await request(`${issuePath(projectSlug)}/${segment(identifier)}/blockers`, { signal }),
        ),
        "blockers",
      ).map(mapBlocker);
    },
    async dispatchIssue(projectSlug, identifier, input, signal) {
      return mapDispatchResult(
        unwrapData(
          await request(`${issuePath(projectSlug)}/${segment(identifier)}/dispatch`, {
            method: "POST",
            body: dispatchPayload(input),
            signal,
          }),
        ),
      );
    },
    async goalControl(projectSlug, identifier, input, signal) {
      return asRecord(
        unwrapData(
          await request(`${issuePath(projectSlug)}/${segment(identifier)}/goal`, {
            method: "POST",
            body: goalPayload(input),
            signal,
          }),
        ),
        "goal",
      );
    },
  };
}

function issuePath(projectSlug: string): string {
  return `/projects/${segment(requireText(projectSlug, "project slug"))}/issues`;
}

function segment(value: string): string {
  return encodeURIComponent(requireText(value, "path segment"));
}

function issueListQuery(options: IssueListOptions): URLSearchParams {
  const query = new URLSearchParams();
  if (options.query?.trim()) query.set("q", options.query.trim());
  if (options.assignee?.trim()) query.set("assignee", options.assignee.trim());
  if (options.creator?.trim()) query.set("creator", options.creator.trim());
  return query;
}

function issueMutationPayload(
  input: CreateIssueInput | IssueMutationInput,
): Record<string, unknown> {
  return {
    ...("title" in input && input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.labelIds !== undefined ? { label_ids: input.labelIds } : {}),
    ...(input.assigneeIds !== undefined ? { assignee_ids: input.assigneeIds } : {}),
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.goal !== undefined ? { goal: input.goal } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.effort !== undefined ? { effort: input.effort } : {}),
  };
}

function dispatchPayload(input: IssueDispatchInput): Record<string, unknown> {
  return {
    action: input.action,
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.goal ? { goal: input.goal } : {}),
    ...(input.instructions ? { instructions: input.instructions } : {}),
    ...(input.targetStatus ? { target_status: input.targetStatus } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
  };
}

function goalPayload(input: GoalControlInput): Record<string, unknown> {
  return {
    action: input.action,
    ...(input.objective ? { objective: input.objective } : {}),
    ...(input.tokenBudget !== undefined ? { token_budget: input.tokenBudget } : {}),
  };
}

function threadListQuery(options: ThreadListOptions): URLSearchParams {
  const query = new URLSearchParams();
  if (options.scope) query.set("scope", options.scope);
  if (options.scopes?.length) query.set("scopes", options.scopes.join(","));
  if (options.projectSlug) query.set("project_slug", options.projectSlug);
  if (options.issueIdentifier) query.set("issue_identifier", options.issueIdentifier);
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.includeArchived === true) query.set("include_archived", "true");
  return query;
}

function createThreadPayload(input: CreateThreadInput): Record<string, unknown> {
  const settings = {
    agent_kind: input.agentKind,
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
  };
  if (input.scope === "freeform") {
    return { scope: input.scope, ...settings };
  }
  if (input.scope === "project_session") {
    return {
      scope: input.scope,
      project_slug: input.projectSlug,
      ...(input.workspacePath ? { workspace_path: input.workspacePath } : {}),
      ...settings,
    };
  }
  return {
    scope: input.scope,
    project_slug: input.projectSlug,
    issue_identifier: input.issueIdentifier,
    ...(input.workspacePath ? { workspace_path: input.workspacePath } : {}),
    ...(input.isolatedWorkspace === true ? { isolated_workspace: true } : {}),
    ...(input.useParentWorkspace === true ? { use_parent_workspace: true } : {}),
    ...(input.cloneBranch ? { clone_branch: input.cloneBranch } : {}),
    ...settings,
  };
}

function mapHealth(payload: unknown): Health {
  const record = asRecord(payload, "health");
  return { status: requireText(record.status, "health status") };
}

function mapViewer(payload: unknown): Viewer {
  const record = asRecord(payload, "viewer");
  return {
    id: requireText(record.id, "viewer id"),
    name: requireText(record.name, "viewer name"),
  };
}

function mapProject(payload: unknown): ProjectSummary {
  const record = asRecord(payload, "project");
  return {
    id: requireText(record.id, "project id"),
    slug: requireText(record.slug, "project slug"),
    name: requireText(record.name, "project name"),
  };
}

function mapIssue(payload: unknown): IssueSummary {
  const record = asRecord(payload, "issue");
  return {
    id: requireText(record.id, "issue id"),
    identifier: requireText(record.identifier, "issue identifier"),
    displayIdentifier:
      optionalText(record.display_identifier) ?? requireText(record.identifier, "issue identifier"),
    projectSlug: requireText(record.project_slug, "issue project slug"),
    title: requireText(record.title, "issue title"),
    description: optionalText(record.description),
    status: issueStatus(record.status),
    priority: issuePriority(record.priority),
    position: finiteNumber(record.position, 0),
    labels: issueLabels(record.labels),
    assignee: optionalText(record.assignee_id),
    creator: optionalText(record.creator),
    agentKind: readAgentKind(record.agent_kind),
    agentGoal: optionalText(record.agent_goal),
    branchName: optionalText(record.branch_name),
    createdAt: optionalText(record.inserted_at) ?? "",
    updatedAt: optionalText(record.updated_at) ?? "",
  };
}

function mapComment(payload: unknown): IssueComment {
  const record = asRecord(payload, "comment");
  return {
    id: requireText(record.id, "comment id"),
    body: requireText(record.body, "comment body"),
    author: optionalText(record.author),
    kind: optionalText(record.kind) ?? "comment",
    createdAt: optionalText(record.inserted_at) ?? "",
    updatedAt: optionalText(record.updated_at) ?? "",
  };
}

function mapIssueFormOptions(payload: unknown): IssueFormOptions {
  const record = asRecord(payload, "issue form options");
  const agents = readArray(record.agents ?? [], "issue agents").flatMap((value) => {
    const agent = asRecord(value, "issue agent");
    const kind = readAgentKind(agent.value);
    return kind
      ? [
          {
            value: kind,
            label: optionalText(agent.label) ?? kind,
            default: agent.default === true,
          },
        ]
      : [];
  });
  const effectiveAgent =
    readAgentKind(record.effective_agent) ?? agents.find((agent) => agent.default)?.value;
  if (!effectiveAgent) {
    throw new TrackerProtocolError("Tracker issue form options have no effective agent");
  }
  return {
    statuses: readArray(record.statuses ?? [], "issue statuses").map(issueStatus),
    labels: readArray(record.labels ?? [], "issue labels").map((value) => {
      const label = asRecord(value, "issue label");
      return {
        id: optionalText(label.id),
        name: requireText(label.name, "issue label name"),
        color: optionalText(label.color),
      };
    }),
    assignees: readArray(record.assignees ?? [], "issue assignees").map((value) => {
      const assignee = asRecord(value, "issue assignee");
      return {
        id: optionalText(assignee.id),
        login: optionalText(assignee.login),
        name: optionalText(assignee.name),
      };
    }),
    agents,
    effectiveAgent,
  };
}

function mapBlocker(payload: unknown): IssueBlocker {
  const record = asRecord(payload, "blocker");
  return {
    identifier: requireText(record.identifier ?? record.target_identifier, "blocker identifier"),
    title: optionalText(record.title) ?? "",
    status: issueStatusOrNull(record.status),
    relationType: optionalText(record.relation_type ?? record.type) ?? "blocked_by",
  };
}

function mapDispatchResult(payload: unknown): IssueDispatchResult {
  const record = asRecord(payload, "issue dispatch");
  const action = record.action;
  if (
    action !== "resume" &&
    action !== "hard_reset" &&
    action !== "stop" &&
    action !== "continue_work"
  ) {
    throw new TrackerProtocolError("Tracker issue dispatch action is invalid");
  }
  return {
    action,
    message: optionalText(record.message) ?? "",
    issue: mapIssue(record.issue),
  };
}

function issueStatus(value: unknown): string {
  const status = issueStatusOrNull(value);
  if (!status) throw new TrackerProtocolError("Tracker issue status is missing");
  return status;
}

function issueStatusOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (isRecord(value)) return optionalText(value.name);
  return null;
}

function issuePriority(value: unknown): IssuePriority | null {
  const priority = Number(value);
  return Number.isInteger(priority) && priority >= 0 && priority <= 4
    ? (priority as IssuePriority)
    : null;
}

function issueLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((label) => {
    if (typeof label === "string" && label.trim()) return [label.trim()];
    if (isRecord(label)) {
      const name = optionalText(label.name);
      return name ? [name] : [];
    }
    return [];
  });
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mapThread(payload: unknown): AssistantThread {
  const record = asRecord(payload, "assistant thread");
  const id = Number(record.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new TrackerProtocolError("Tracker assistant thread is missing a valid id");
  }
  return {
    id,
    scope: requireText(record.scope, "assistant thread scope"),
    projectSlug: optionalText(record.project_slug),
    projectName: optionalText(record.project_name),
    issueIdentifier: optionalText(record.issue_identifier),
    workspacePath: optionalText(record.workspace_path),
    title: optionalText(record.title),
    status: typeof record.status === "string" ? record.status : "idle",
    preview: optionalText(record.preview),
    updatedAt: typeof record.updated_at === "string" ? record.updated_at : "",
    agentKind: readAgentKind(record.agent_kind),
    needsReview: record.needs_review === true,
  };
}

function mapProjectSession(payload: unknown): ProjectSessionRow {
  const record = asRecord(payload, "project session");
  const threadId = Number(record.thread_id);
  return {
    id: requireText(record.id, "project session id"),
    threadId: Number.isInteger(threadId) && threadId > 0 ? threadId : null,
    title: typeof record.title === "string" ? record.title : "",
    kind: typeof record.kind === "string" ? record.kind : "chat",
    scope: typeof record.scope === "string" ? record.scope : "project",
    href: normalizeHref(typeof record.href === "string" ? record.href : ""),
    updatedAt: typeof record.updated_at === "string" ? record.updated_at : "",
    aggregateStatus: optionalText(record.aggregate_status),
    agentKind: readAgentKind(record.agent_kind),
    issueIdentifier: optionalText(record.issue_identifier),
    workspacePath: optionalText(record.workspace_path),
    workspaceId: optionalText(record.workspace_id),
    pinned: record.pinned === true,
    archived: record.archived === true,
  };
}

function mapAssistantCatalog(payload: unknown): AssistantCatalog {
  const record = asRecord(payload, "assistant catalog");
  const agents = readArray(record.agents, "assistant agents")
    .map(mapAgentCatalog)
    .filter((agent): agent is AssistantAgentCatalog => agent !== null);
  if (agents.length === 0) {
    throw new TrackerProtocolError("Tracker assistant catalog has no supported agents");
  }
  return {
    defaultAgent: readAgentKind(record.default_agent) ?? agents[0]!.agent,
    agents,
  };
}

function mapAgentCatalog(payload: unknown): AssistantAgentCatalog | null {
  const record = asRecord(payload, "assistant agent");
  const agent = readAgentKind(record.agent);
  if (!agent) return null;
  const models = readArray(record.models ?? [], "assistant models").map(mapModel);
  return {
    agent,
    agentLabel: typeof record.agent_label === "string" ? record.agent_label : agent,
    defaultModel: optionalText(record.default_model),
    models,
  };
}

function mapModel(payload: unknown): AssistantModelOption {
  const record = asRecord(payload, "assistant model");
  return {
    model: requireText(record.model, "assistant model id"),
    label:
      typeof record.label === "string"
        ? record.label
        : requireText(record.model, "assistant model id"),
    efforts: readArray(record.efforts ?? [], "assistant efforts").map(mapEffort),
  };
}

function mapEffort(payload: unknown): AssistantEffortOption {
  if (typeof payload === "string") return { effort: payload, label: payload };
  const record = asRecord(payload, "assistant effort");
  return {
    effort: requireText(record.effort ?? record.id, "assistant effort id"),
    label:
      typeof record.label === "string"
        ? record.label
        : requireText(record.effort ?? record.id, "assistant effort id"),
  };
}

function normalizeHref(href: string): string {
  return href.startsWith("/tracker/") ? href.slice("/tracker".length) : href;
}

function readAgentKind(value: unknown): AgentKind | null {
  return typeof value === "string" && AGENT_KINDS.includes(value as AgentKind)
    ? (value as AgentKind)
    : null;
}

function unwrapData(payload: unknown): unknown {
  const record = asRecord(payload, "response envelope");
  if (!("data" in record)) {
    throw new TrackerProtocolError("Tracker response is missing data");
  }
  return record.data;
}

function readErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.message === "string") return payload.message;
  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  return null;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TrackerProtocolError(`Tracker ${label} payload is invalid`);
  }
  return value;
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TrackerProtocolError(`Tracker ${label} payload is not an array`);
  }
  return value;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TrackerProtocolError(`Tracker ${label} is missing`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
