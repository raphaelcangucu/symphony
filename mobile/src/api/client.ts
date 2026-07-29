import { redactSecret } from "@/auth/connection-profile";
import { diagnosticLog, type DiagnosticLog } from "@/diagnostics/diagnostic-log";

import type {
  AgentAvailabilityMap,
  AgentKind,
  AgentUsageMap,
  AgentUsageWindow,
  AssistantAgentCatalog,
  AssistantCatalog,
  AssistantEffortOption,
  AssistantModelOption,
  AssistantThread,
  CreateThreadInput,
  CreateIssueInput,
  DevServer,
  DevServerList,
  GitDiffCommitResponse,
  GitDiffFileEntry,
  GitDiffFilesOptions,
  GitDiffFilesPage,
  GitDiffPatchOptions,
  GitDiffPatchResult,
  GitDiffPushResponse,
  GitDiffRepoStat,
  GitDiffType,
  GitDiffWorkspace,
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
  MergePullRequestResult,
  MobilePushIdentity,
  MobilePushRegistrationInput,
  ProjectSessionRow,
  ProjectSummary,
  PullRequest,
  PullRequestFixResult,
  PullRequestGroup,
  PullRequestMergeMethod,
  PullRequestPipeline,
  PullRequestResult,
  PullRequestRerunResult,
  PullRequestState,
  ThreadDocumentList,
  ThreadFileContent,
  ThreadFileKind,
  ThreadFileList,
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
  diagnostics?: DiagnosticLog;
};

export type TrackerRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal | undefined;
  tracker?: boolean;
  idempotencyKey?: string;
};

export type TrackerRequest = (path: string, options?: TrackerRequestOptions) => Promise<unknown>;

const DEFAULT_TIMEOUT_MS = 30_000;
const AGENT_KINDS: readonly AgentKind[] = ["codex", "claude", "cursor", "opencode"];

export function createTrackerClient(options: CreateTrackerClientOptions): TrackerClient {
  const origin = options.origin.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const diagnostics = options.diagnostics ?? diagnosticLog;

  async function request(
    path: string,
    requestOptions: TrackerRequestOptions = {},
  ): Promise<unknown> {
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
    const url = `${origin}${basePath}${path}`;
    const method = requestOptions.method ?? "GET";
    diagnostics.record(
      {
        scope: "request",
        event: `${method} ${basePath}${path}`,
        details: {
          url,
          method,
          headers,
          body: requestOptions.body,
          state: "started",
        },
      },
      [options.token],
    );

    try {
      const response = await fetchImpl(url, {
        method,
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

      diagnostics.record(
        {
          scope: "request",
          event: `${method} ${basePath}${path}`,
          details: { url, method, status: response.status, state: "completed" },
        },
        [options.token],
      );
      return payload;
    } catch (cause) {
      diagnostics.record(
        {
          scope: "request",
          event: `${method} ${basePath}${path}`,
          details: {
            url,
            method,
            state: timedOut ? "timeout" : "failed",
            error: cause instanceof Error ? cause.message : "Tracker request failed",
          },
        },
        [options.token],
      );
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

  return createTrackerClientFromRequest(request);
}

export function createTrackerClientFromRequest(request: TrackerRequest): TrackerClient {
  return {
    async health(signal) {
      return mapHealth(await request("/health", { signal, tracker: false }));
    },
    async viewer(signal) {
      return mapViewer(unwrapData(await request("/viewer", { signal })));
    },
    async agentAvailability(signal) {
      return mapAgentAvailability(
        unwrapData(await request("/settings/agents/availability", { signal })),
      );
    },
    async agentUsage(signal) {
      return mapAgentUsage(unwrapData(await request("/settings/agents/usage", { signal })));
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
    async assistantCatalogForHost(signal) {
      const payload = unwrapData(await request("/assistant/config", { signal }));
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
    async subtasks(projectSlug, identifier, signal) {
      return readArray(
        unwrapData(
          await request(`${issuePath(projectSlug)}/${segment(identifier)}/subtasks`, { signal }),
        ),
        "subtasks",
      ).map(mapIssue);
    },
    async createSubtask(projectSlug, identifier, input, signal) {
      return mapIssue(
        unwrapData(
          await request(`${issuePath(projectSlug)}/${segment(identifier)}/subtasks`, {
            method: "POST",
            body: issueMutationPayload(input),
            signal,
          }),
        ),
      );
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
    async threadDocuments(threadId, signal) {
      return mapThreadDocumentList(
        unwrapData(await request(`${threadPath(threadId)}/documents`, { signal })),
      );
    },
    async threadDocument(threadId, path, signal) {
      const encodedPath = safeDocumentPath(path).split("/").map(encodeURIComponent).join("/");
      const payload = asRecord(
        unwrapData(await request(`${threadPath(threadId)}/documents/${encodedPath}`, { signal })),
        "thread document",
      );
      return {
        path: requireText(payload.path, "thread document path"),
        content: typeof payload.content === "string" ? payload.content : "",
      };
    },
    async threadFiles(threadId, signal) {
      return mapThreadFileList(
        unwrapData(await request(`${threadPath(threadId)}/files`, { signal })),
      );
    },
    async threadFile(threadId, path, signal) {
      const encodedPath = safeRelativePath(path, "workspace file path")
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      return mapThreadFileContent(
        unwrapData(await request(`${threadPath(threadId)}/files/${encodedPath}`, { signal })),
      );
    },
    async threadDevServers(threadId, signal) {
      return mapDevServerList(
        unwrapData(await request(`${threadPath(threadId)}/dev_servers`, { signal })),
      );
    },
    async startThreadDevServers(threadId, signal) {
      return mapDevServerList(
        unwrapData(
          await request(`${threadPath(threadId)}/dev_servers/start`, {
            method: "POST",
            signal,
          }),
        ),
      );
    },
    async restartThreadDevServers(threadId, signal) {
      return mapDevServerList(
        unwrapData(
          await request(`${threadPath(threadId)}/dev_servers/restart`, {
            method: "POST",
            signal,
          }),
        ),
      );
    },
    async threadDiffStats(threadId, type = "uncommitted", signal) {
      const query = diffTypeQuery(type);
      const payload = asRecord(
        await request(`${threadPath(threadId)}/diff/stats?${query.toString()}`, { signal }),
        "thread diff stats",
      );
      return {
        stats: readArray(payload.data, "thread diff stats").map(mapGitDiffRepoStat),
        workspace: mapGitDiffWorkspace(payload.workspace),
      };
    },
    async threadDiffFiles(threadId, diffOptions = {}, signal) {
      const query = diffFilesQuery(diffOptions);
      return mapGitDiffFilesPage(
        await request(`${threadPath(threadId)}/diff/files?${query.toString()}`, { signal }),
      );
    },
    async threadDiffPatch(threadId, diffOptions, signal) {
      const query = diffPatchQuery(diffOptions);
      const payload = asRecord(
        await request(`${threadPath(threadId)}/diff/patch?${query.toString()}`, { signal }),
        "thread diff patch",
      );
      return {
        ...mapGitDiffPatch(unwrapData(payload)),
        workspace: mapGitDiffWorkspace(payload.workspace),
      };
    },
    async commitThreadDiff(threadId, message, signal) {
      const commitMessage = requireText(message, "commit message");
      const payload = asRecord(
        await request(`${threadPath(threadId)}/diff/commit`, {
          method: "POST",
          body: { message: commitMessage },
          signal,
        }),
        "thread diff commit",
      );
      return {
        commits: readArray(payload.data, "thread diff commits").map(mapGitDiffCommit),
        workspace: mapGitDiffWorkspace(payload.workspace),
      };
    },
    async pushThreadDiff(threadId, signal) {
      const payload = asRecord(
        await request(`${threadPath(threadId)}/diff/push`, {
          method: "POST",
          signal,
        }),
        "thread diff push",
      );
      return {
        results: readArray(payload.data, "thread diff push results").map(mapGitDiffPushResult),
        workspace: mapGitDiffWorkspace(payload.workspace),
      };
    },
    async issuePullRequests(projectSlug, identifier, refresh = false, signal) {
      const suffix = refresh ? "?refresh=1" : "";
      return mapPullRequestResult(
        await request(`${issuePullRequestPath(projectSlug, identifier)}${suffix}`, { signal }),
      );
    },
    async linkIssuePullRequest(projectSlug, identifier, url, signal) {
      await request(`${issuePullRequestPath(projectSlug, identifier)}/link`, {
        method: "POST",
        body: { url: requireText(url, "pull request URL") },
        signal,
      });
    },
    async unlinkIssuePullRequest(projectSlug, identifier, url, signal) {
      await request(`${issuePullRequestPath(projectSlug, identifier)}/link`, {
        method: "DELETE",
        body: { url: requireText(url, "pull request URL") },
        signal,
      });
    },
    async requestPullRequestFix(projectSlug, identifier, signal) {
      return mapPullRequestFix(
        unwrapData(
          await request(`${issuePullRequestPath(projectSlug, identifier)}/fix`, {
            method: "POST",
            signal,
          }),
        ),
      );
    },
    async updatePullRequestBranch(projectSlug, identifier, number, signal) {
      const payload = asRecord(
        unwrapData(
          await request(
            `${issuePullRequestPath(projectSlug, identifier)}/${positiveInteger(number, "pull request number")}/update_branch`,
            { method: "POST", signal },
          ),
        ),
        "pull request branch update",
      );
      return { updated: payload.updated === true };
    },
    async rerunPullRequestJobs(projectSlug, identifier, number, signal) {
      const payload = asRecord(
        unwrapData(
          await request(
            `${issuePullRequestPath(projectSlug, identifier)}/${positiveInteger(number, "pull request number")}/rerun_failed`,
            { method: "POST", signal },
          ),
        ),
        "pull request reruns",
      );
      return readArray(payload.reruns ?? [], "pull request reruns").map(mapPullRequestRerun);
    },
    async mergeIssuePullRequest(projectSlug, identifier, number, input, signal) {
      const method = pullRequestMergeMethod(input.method);
      return mapPullRequestMerge(
        unwrapData(
          await request(
            `${issuePullRequestPath(projectSlug, identifier)}/${positiveInteger(number, "pull request number")}/merge`,
            {
              method: "POST",
              body: { method, bypass: input.bypass === true },
              signal,
            },
          ),
        ),
        method,
      );
    },
    async registerMobilePush(input, signal) {
      const payload = asRecord(
        unwrapData(
          await request("/mobile_push/subscriptions", {
            method: "POST",
            body: mobilePushRegistrationPayload(input),
            signal,
          }),
        ),
        "mobile push registration",
      );
      return {
        registered: payload.registered === true,
        deviceId: requireText(payload.device_id, "mobile push device id"),
      };
    },
    async unregisterMobilePush(input, signal) {
      const payload = asRecord(
        unwrapData(
          await request("/mobile_push/subscriptions", {
            method: "DELETE",
            body: mobilePushIdentityPayload(input),
            signal,
          }),
        ),
        "mobile push deletion",
      );
      return { deleted: payload.deleted === true };
    },
    async sendTestMobilePush(signal) {
      const payload = asRecord(
        unwrapData(
          await request("/mobile_push/test", {
            method: "POST",
            signal,
          }),
        ),
        "mobile push test",
      );
      return {
        sent: payload.sent === true,
        deviceCount: finiteNumber(payload.device_count, 0),
      };
    },
  };
}

function threadPath(threadId: number): string {
  if (!Number.isInteger(threadId) || threadId <= 0) {
    throw new TrackerProtocolError("Tracker thread id must be a positive integer");
  }
  return `/assistant/threads/${threadId}`;
}

function safeDocumentPath(path: string): string {
  const normalized = requireText(path, "document path").replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    !normalized.toLocaleLowerCase().endsWith(".md") ||
    segments.some((item) => item === "" || item === "." || item === "..")
  ) {
    throw new TrackerProtocolError("Tracker document path must be a safe relative markdown path");
  }
  return normalized;
}

function diffTypeQuery(type: GitDiffType): URLSearchParams {
  const query = new URLSearchParams();
  query.set("type", type);
  return query;
}

function diffFilesQuery(options: GitDiffFilesOptions): URLSearchParams {
  const query = diffTypeQuery(options.type ?? "uncommitted");
  if (options.repo?.trim()) query.set("repo", options.repo.trim());
  if (options.query?.trim()) query.set("q", options.query.trim());
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.cursor?.trim()) query.set("cursor", options.cursor.trim());
  return query;
}

function diffPatchQuery(options: GitDiffPatchOptions): URLSearchParams {
  const query = diffTypeQuery(options.type ?? "uncommitted");
  query.set("repo", requireText(options.repo, "diff repository"));
  query.set("path", safeRelativePath(options.path, "diff file path"));
  return query;
}

function safeRelativePath(path: string, label: string): string {
  const normalized = requireText(path, label).replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    segments.some((item) => item === "" || item === "." || item === "..")
  ) {
    throw new TrackerProtocolError(`Tracker ${label} must be a safe relative path`);
  }
  return normalized;
}

function issuePath(projectSlug: string): string {
  return `/projects/${segment(requireText(projectSlug, "project slug"))}/issues`;
}

function issuePullRequestPath(projectSlug: string, identifier: string): string {
  return `${issuePath(projectSlug)}/${segment(identifier)}/pull_requests`;
}

function segment(value: string): string {
  return encodeURIComponent(requireText(value, "path segment"));
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TrackerProtocolError(`Tracker ${label} must be a positive integer`);
  }
  return value;
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

function mobilePushIdentityPayload(input: MobilePushIdentity): Record<string, unknown> {
  return {
    profile_id: requireText(input.profileId, "mobile push profile id"),
    device_id: requireText(input.deviceId, "mobile push device id"),
  };
}

function mobilePushRegistrationPayload(
  input: MobilePushRegistrationInput,
): Record<string, unknown> {
  return {
    ...mobilePushIdentityPayload(input),
    platform: input.platform,
    token: requireText(input.token, "Expo push token"),
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

function mapThreadFileList(payload: unknown): ThreadFileList {
  const record = asRecord(payload, "thread files");
  return {
    available: record.available === true,
    reason: optionalText(record.reason),
    files: readArray(record.files ?? [], "thread files").map((value) => {
      const file = asRecord(value, "thread file");
      const path = requireText(file.path, "thread file path");
      return {
        id: typeof file.id === "string" ? file.id : path,
        path,
        name: typeof file.name === "string" ? file.name : path.split("/").at(-1) || path,
        title: typeof file.title === "string" ? file.title : path.split("/").at(-1) || path,
        kind: threadFileKind(file.kind),
        size: finiteNumber(file.size, 0),
        updatedAt: optionalText(file.updated_at),
      };
    }),
  };
}

function mapThreadFileContent(payload: unknown): ThreadFileContent {
  const record = asRecord(payload, "thread file content");
  const kind = threadFileKind(record.kind);
  const mimeType = requireText(record.mime_type, "thread file mime type");
  const encoded = optionalText(record.content_base64);
  return {
    path: requireText(record.path, "thread file path"),
    kind,
    mimeType,
    content: typeof record.content === "string" ? record.content : null,
    dataUri: kind === "image" && encoded ? `data:${mimeType};base64,${encoded}` : null,
  };
}

function threadFileKind(value: unknown): ThreadFileKind {
  if (value === "markdown" || value === "text" || value === "image") return value;
  throw new TrackerProtocolError("Tracker returned an unsupported workspace file kind");
}

function mapAgentAvailability(payload: unknown): AgentAvailabilityMap {
  const record = asRecord(payload, "agent availability");
  return Object.fromEntries(
    Object.entries(record).flatMap(([agent, value]) => {
      if (!isRecord(value)) return [];
      return [
        [
          agent,
          {
            available: value.available === true,
            version: optionalText(value.version),
            command: typeof value.command === "string" ? value.command : agent,
            path: optionalText(value.path),
            authenticated: typeof value.authenticated === "boolean" ? value.authenticated : null,
            detail: optionalText(value.detail),
          },
        ],
      ];
    }),
  );
}

function mapAgentUsage(payload: unknown): AgentUsageMap {
  const record = asRecord(payload, "agent usage");
  return Object.fromEntries(
    Object.entries(record).map(([agent, value]) => {
      if (value === null) return [agent, null];
      const entry = asRecord(value, `${agent} usage`);
      return [
        agent,
        {
          agentKind:
            typeof entry.agent_kind === "string" && entry.agent_kind.trim()
              ? entry.agent_kind
              : agent,
          plan: optionalText(entry.plan),
          creditsRemaining: optionalNumber(entry.credits_remaining),
          creditsUnlimited: entry.credits_unlimited === true,
          fetchedAt: optionalText(entry.fetched_at),
          stale: entry.stale === true,
          windows: mapUsageWindows(entry.windows),
          modelLimits: mapUsageWindows(entry.model_limits),
        },
      ];
    }),
  );
}

function mapUsageWindows(value: unknown): AgentUsageWindow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const usedPercent = optionalNumber(item.used_percent);
    if (usedPercent === null) return [];
    return [
      {
        kind: typeof item.kind === "string" ? item.kind : "unknown",
        usedPercent,
        resetsAt: optionalText(item.resets_at),
        windowMinutes: optionalNumber(item.window_minutes),
      },
    ];
  });
}

function mapProject(payload: unknown): ProjectSummary {
  const record = asRecord(payload, "project");
  return {
    id: requireIdentifier(record.id, "project id"),
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
    model: optionalText(record.model),
    effort: optionalText(record.effort),
    agentGoal: optionalText(record.agent_goal),
    branchName: optionalText(record.branch_name),
    parentIdentifier: optionalText(record.parent_identifier),
    createdAt: optionalText(record.inserted_at) ?? "",
    updatedAt: optionalText(record.updated_at) ?? "",
  };
}

function mapComment(payload: unknown): IssueComment {
  const record = asRecord(payload, "comment");
  return {
    id: requireIdentifier(record.id, "comment id"),
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

function mapThreadDocumentList(payload: unknown): ThreadDocumentList {
  const record = asRecord(payload, "thread documents");
  return {
    available: record.available === true,
    reason: optionalText(record.reason),
    documents: readArray(record.documents ?? [], "thread documents").map((value) => {
      const document = asRecord(value, "thread document");
      const path = requireText(document.path, "thread document path");
      return {
        id: optionalText(document.id) ?? path,
        kind: "draft",
        path,
        title: optionalText(document.title) ?? path,
        updatedAt: optionalText(document.updated_at),
      };
    }),
  };
}

function mapDevServerList(payload: unknown): DevServerList {
  const record = asRecord(payload, "dev servers");
  return {
    available: record.available === true,
    reason: optionalText(record.reason),
    servers: readArray(record.servers ?? [], "dev servers").flatMap((value) => {
      const server = mapDevServer(value);
      return server ? [server] : [];
    }),
  };
}

function mapDevServer(payload: unknown): DevServer | null {
  const record = asRecord(payload, "dev server");
  const id = Number(record.id);
  const slug = optionalText(record.slug);
  if (!Number.isInteger(id) || id <= 0 || !slug) return null;
  return {
    id,
    slug,
    url: optionalText(record.url),
    localUrl: optionalText(record.local_url),
    publicUrl: optionalText(record.public_url),
    status: optionalText(record.status) ?? "unknown",
    primary: record.primary === true,
  };
}

function mapGitDiffWorkspace(payload: unknown): GitDiffWorkspace {
  const record = asRecord(payload, "diff workspace");
  return {
    path: typeof record.path === "string" ? record.path : "",
    available: record.available === true,
  };
}

function mapGitDiffRepoStat(payload: unknown): GitDiffRepoStat {
  const record = asRecord(payload, "diff repository stat");
  return {
    repo: requireText(record.repo, "diff repository"),
    branch: optionalText(record.branch),
    base: optionalText(record.base),
    filesChanged: finiteNumber(record.files_changed, 0),
    additions: finiteNumber(record.additions, 0),
    deletions: finiteNumber(record.deletions, 0),
    untracked: finiteNumber(record.untracked, 0),
  };
}

function mapGitDiffFilesPage(payload: unknown): GitDiffFilesPage {
  const record = asRecord(payload, "thread diff files");
  return {
    files: readArray(record.files, "thread diff files").map(mapGitDiffFileEntry),
    total: finiteNumber(record.total, 0),
    limit: finiteNumber(record.limit, 0),
    nextCursor: optionalText(record.next_cursor),
    workspace: mapGitDiffWorkspace(record.workspace),
  };
}

function mapGitDiffFileEntry(payload: unknown): GitDiffFileEntry {
  const record = asRecord(payload, "diff file");
  return {
    repo: requireText(record.repo, "diff file repository"),
    path: requireText(record.path, "diff file path"),
    oldPath: optionalText(record.old_path),
    status: requireText(record.status, "diff file status"),
    additions:
      record.additions === null || record.additions === undefined
        ? null
        : finiteNumber(record.additions, 0),
    deletions:
      record.deletions === null || record.deletions === undefined
        ? null
        : finiteNumber(record.deletions, 0),
    binary: record.binary === true,
  };
}

function mapGitDiffPatch(payload: unknown): Omit<GitDiffPatchResult, "workspace"> {
  const record = asRecord(payload, "diff patch");
  return {
    repo: requireText(record.repo, "diff patch repository"),
    path: requireText(record.path, "diff patch path"),
    status: requireText(record.status, "diff patch status"),
    binary: record.binary === true,
    truncated: record.truncated === true,
    patch: typeof record.patch === "string" ? record.patch : "",
  };
}

function mapGitDiffCommit(payload: unknown): GitDiffCommitResponse["commits"][number] {
  const record = asRecord(payload, "diff commit");
  return {
    repo: requireText(record.repo, "diff commit repository"),
    sha: requireText(record.sha, "diff commit sha"),
    message: requireText(record.message, "diff commit message"),
    files: readArray(record.files ?? [], "diff commit files").map((path) =>
      requireText(path, "diff commit file"),
    ),
  };
}

function mapGitDiffPushResult(payload: unknown): GitDiffPushResponse["results"][number] {
  const record = asRecord(payload, "diff push result");
  const error = optionalText(record.error);
  return {
    repo: requireText(record.repo, "diff push repository"),
    ok: record.ok === true,
    ...(error ? { error } : {}),
  };
}

function mapPullRequestResult(payload: unknown): PullRequestResult {
  const record = asRecord(payload, "pull requests");
  return {
    pullRequests: readArray(record.data ?? [], "pull requests").map(mapPullRequest),
    supported: record.supported === true,
    available: record.available === true,
    children: readArray(record.children ?? [], "pull request groups")
      .map(mapPullRequestGroup)
      .filter((group) => group.identifier && group.pullRequests.length > 0),
  };
}

function mapPullRequest(payload: unknown): PullRequest {
  const record = asRecord(payload, "pull request");
  const number = positiveInteger(Number(record.number), "pull request number");
  return {
    number,
    title: optionalText(record.title),
    url: optionalText(record.url),
    state: pullRequestState(record.state),
    repo: optionalText(record.repo),
    origin: record.origin === "manual" ? "manual" : "auto",
    isDraft: record.is_draft === true,
    merged: record.merged === true,
    headRef: optionalText(record.head_ref),
    baseRef: optionalText(record.base_ref),
    author: optionalText(record.author),
    mergeable: optionalText(record.mergeable),
    checksState: optionalText(record.checks_state),
    pipelines: readArray(record.pipelines ?? [], "pull request pipelines").map(
      mapPullRequestPipeline,
    ),
    statuses: readArray(record.statuses ?? [], "pull request statuses").map((value) => {
      const status = asRecord(value, "pull request status");
      return {
        context: optionalText(status.context),
        state: optionalText(status.state),
        url: optionalText(status.url),
        description: optionalText(status.description),
      };
    }),
    conversation: readArray(record.conversation ?? [], "pull request conversation").map((value) => {
      const entry = asRecord(value, "pull request conversation entry");
      return {
        author: optionalText(entry.author),
        body: typeof entry.body === "string" ? entry.body : "",
        kind: entry.kind === "review" ? "review" : "comment",
        reviewState: optionalText(entry.review_state),
        createdAt: optionalText(entry.created_at),
      };
    }),
    baseBehindBy:
      record.base_behind_by === null || record.base_behind_by === undefined
        ? null
        : finiteNumber(record.base_behind_by, 0),
  };
}

function mapPullRequestPipeline(payload: unknown): PullRequestPipeline {
  const record = asRecord(payload, "pull request pipeline");
  return {
    name: optionalText(record.name) ?? "Checks",
    url: optionalText(record.url),
    jobs: readArray(record.jobs ?? [], "pull request jobs").map((value) => {
      const job = asRecord(value, "pull request job");
      return {
        name: optionalText(job.name),
        status: optionalText(job.status),
        conclusion: optionalText(job.conclusion),
        url: optionalText(job.url),
      };
    }),
  };
}

function mapPullRequestGroup(payload: unknown): PullRequestGroup {
  const record = asRecord(payload, "pull request group");
  return {
    identifier: optionalText(record.identifier) ?? "",
    title: optionalText(record.title),
    pullRequests: readArray(record.pull_requests ?? [], "grouped pull requests").map(
      mapPullRequest,
    ),
  };
}

function mapPullRequestFix(payload: unknown): PullRequestFixResult {
  const record = asRecord(payload, "pull request fix");
  return {
    movedTo: optionalText(record.moved_to) ?? "Rework",
    commentPosted: record.comment_posted === true,
    jobs: readArray(record.jobs ?? [], "pull request fix jobs").map((value) => {
      const job = asRecord(value, "pull request fix job");
      return {
        name: optionalText(job.name),
        conclusion: optionalText(job.conclusion),
        url: optionalText(job.url),
      };
    }),
  };
}

function mapPullRequestRerun(payload: unknown): PullRequestRerunResult {
  const record = asRecord(payload, "pull request rerun");
  const error = optionalText(record.error);
  const status =
    typeof record.status === "number" && Number.isFinite(record.status) ? record.status : undefined;
  return {
    runId: finiteNumber(record.run_id, 0),
    ok: record.ok === true,
    ...(error ? { error } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

function mapPullRequestMerge(
  payload: unknown,
  fallbackMethod: PullRequestMergeMethod,
): MergePullRequestResult {
  const record = asRecord(payload, "pull request merge");
  const sha = optionalText(record.sha);
  const message = optionalText(record.message);
  return {
    merged: record.merged === true,
    method: readPullRequestMergeMethod(record.method) ?? fallbackMethod,
    bypass: record.bypass === true,
    ...(sha ? { sha } : {}),
    ...(message ? { message } : {}),
    issue: record.issue === null || record.issue === undefined ? null : mapIssue(record.issue),
  };
}

function pullRequestState(payload: unknown): PullRequestState {
  return payload === "open" || payload === "closed" || payload === "merged" || payload === "draft"
    ? payload
    : "unknown";
}

function readPullRequestMergeMethod(payload: unknown): PullRequestMergeMethod | null {
  return payload === "merge" || payload === "squash" || payload === "rebase" ? payload : null;
}

function pullRequestMergeMethod(payload: unknown): PullRequestMergeMethod {
  const method = readPullRequestMergeMethod(payload);
  if (!method) throw new TrackerProtocolError("Tracker pull request merge method is invalid");
  return method;
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

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function requireIdentifier(value: unknown, label: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return requireText(value, label);
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
