import type { WebSocket } from "ws";

const HOST_ID = process.env.MOCK_HOST_ID || "host_mock";
const DEFAULT_DELAY_MS = readDelay("MOCK_RPC_DELAY_MS", 0);
const METHODS = [
  "system.identity",
  "system.health",
  "system.capabilities",
  "system.heartbeat",
  "system.usage",
  "system.tracker",
  "devices.list",
  "devices.revoke",
  "devices.self_revoke",
  "projects.request",
  "tasks.request",
  "sessions.request",
  "sessions.subscribe",
  "sessions.command",
  "workspace.request",
  "git.request",
  "previews.request",
  "pull_requests.request",
  "notifications.request",
  "terminal.subscribe",
  "terminal.command",
  "session.tabs.list",
  "session.tabs.subscribe",
  "session.tabs.activate",
  "session.tabs.createTerminal",
  "session.tabs.close",
  "terminal.list",
  "terminal.send",
  "terminal.updateViewport",
  "terminal.focus",
  "terminal.rename",
  "terminal.close",
  "terminal.clearBuffer",
  "terminal.setDisplayMode",
  "terminal.getAutoRestoreFit",
  "terminal.setAutoRestoreFit",
  "markdown.readTab",
  "markdown.saveTab",
] as const;

export type RpcRequest = {
  type: "rpc";
  id: string;
  method: string;
  params: Record<string, unknown>;
  deadline_ms?: number;
};

export type RpcResult = {
  type: "result";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    data?: unknown;
  };
  meta: {
    host_id: string;
    protocol: 1;
    server_timestamp: string;
  };
};

export type RpcEvent = {
  type: "event";
  subscription_id: string;
  sequence: number;
  event: string;
  payload: unknown;
};

export type RpcResponse = RpcResult | RpcEvent;

type Send = (response: RpcResponse) => void;
type Subscription = {
  id: string;
  kind: "sessions" | "terminal" | "session-tabs" | "orca-terminal";
  threadId: number;
  terminalHandle?: string;
  sequence: number;
  send: Send;
  timers: Set<ReturnType<typeof setTimeout>>;
};

const subscriptions = new Map<WebSocket, Map<string, Subscription>>();
const pendingResponses = new Map<WebSocket, Map<string, Set<ReturnType<typeof setTimeout>>>>();
let nextSubscription = 0;
let nextIssue = 102;
let issue = mockIssue();
const comments = [mockComment()];
const subtasks: Record<string, unknown>[] = [];
let mockSessionSnapshotVersion = 1;
let mockActiveTabId = "thread:101";
let mockAutoRestoreFitMs: number | null = null;
const mockDisplayModes = new Map<string, "auto" | "desktop">();
let mockSessionTabs = [mockPrimaryTerminalTab()];

export const mockScenarioSummary = {
  projectCount: 1,
  taskCount: 1,
  sessionCount: 1,
  rpcDelayMs: DEFAULT_DELAY_MS,
};

export function success(id: string, result: unknown): RpcResult {
  return {
    type: "result",
    id,
    ok: true,
    result,
    meta: metadata(),
  };
}

export function error(
  id: string,
  code: string,
  message: string,
  retryable = false,
  data?: unknown,
): RpcResult {
  return {
    type: "result",
    id,
    ok: false,
    error: {
      code,
      message,
      retryable,
      ...(data === undefined ? {} : { data }),
    },
    meta: metadata(),
  };
}

export function handleRequest(request: RpcRequest, send: Send, ws: WebSocket): void {
  const respond: Send = (response) => {
    const delay = responseDelayFor(request.method);
    if (delay > 0) {
      scheduleResponse(ws, request.id, response, delay, send);
    } else {
      send(response);
    }
  };

  if (process.env.MOCK_ERROR_METHOD === request.method) {
    respond(
      error(request.id, "mock_injected_error", `Injected mock failure for ${request.method}`, true),
    );
    return;
  }

  try {
    switch (request.method) {
      case "system.identity":
        respond(
          success(request.id, {
            host_id: HOST_ID,
            name: "Symphony Mock Host — NOT REAL",
            protocol: 1,
          }),
        );
        break;
      case "system.health":
        respond(success(request.id, { status: "healthy" }));
        break;
      case "system.capabilities":
        respond(success(request.id, { methods: [...METHODS] }));
        break;
      case "system.heartbeat":
        respond(success(request.id, { nonce: request.params.nonce ?? null }));
        break;
      case "system.usage":
        respond(success(request.id, { connections: 1, subscriptions: countSubscriptions(ws) }));
        break;
      case "devices.list":
        respond(
          success(request.id, {
            devices: [
              {
                device_id: "device_mock",
                name: "Mock Android",
                scope: "mobile",
                status: "active",
                last_seen_at: now(),
              },
            ],
          }),
        );
        break;
      case "devices.revoke":
      case "devices.self_revoke":
        respond(success(request.id, { revoked: true }));
        break;
      case "system.tracker":
        respond(success(request.id, systemTrackerResponse(request.params)));
        break;
      case "projects.request":
        respond(success(request.id, projectResponse(request.params)));
        break;
      case "tasks.request":
        respond(success(request.id, taskResponse(request.params)));
        break;
      case "sessions.request":
        respond(success(request.id, sessionResponse(request.params)));
        break;
      case "workspace.request":
        respond(success(request.id, workspaceResponse(request.params)));
        break;
      case "git.request":
        respond(success(request.id, gitResponse(request.params)));
        break;
      case "previews.request":
        respond(success(request.id, previewResponse(request.params)));
        break;
      case "pull_requests.request":
        respond(success(request.id, pullRequestResponse(request.params)));
        break;
      case "notifications.request":
        respond(success(request.id, notificationResponse(request.params)));
        break;
      case "sessions.subscribe":
        subscribe("sessions", request, respond, ws);
        break;
      case "terminal.subscribe":
        if (text(request.params.terminal)) {
          subscribeCopiedTerminal(request, respond, ws);
        } else {
          subscribe("terminal", request, respond, ws);
        }
        break;
      case "sessions.command":
        handleSessionCommand(request, respond, ws);
        break;
      case "terminal.command":
        handleTerminalCommand(request, respond, ws);
        break;
      case "session.tabs.list":
        respond(success(request.id, copiedSessionSnapshot(request.params)));
        break;
      case "session.tabs.subscribe":
        subscribeCopiedSessionTabs(request, respond, ws);
        break;
      case "session.tabs.activate":
        activateCopiedSessionTab(request, respond, ws);
        break;
      case "session.tabs.createTerminal":
        createCopiedTerminalTab(request, respond, ws);
        break;
      case "session.tabs.close":
        closeCopiedSessionTab(request, respond, ws);
        break;
      case "terminal.list":
        respond(success(request.id, copiedTerminalList(request.params)));
        break;
      case "terminal.send":
        sendCopiedTerminalInput(request, respond, ws);
        break;
      case "terminal.updateViewport":
        respond(
          success(request.id, {
            terminal: text(request.params.terminal),
            ...record(request.params.viewport),
            displayMode: copiedDisplayMode(text(request.params.terminal)),
          }),
        );
        break;
      case "terminal.focus":
        focusCopiedTerminal(request, respond, ws);
        break;
      case "terminal.rename":
        renameCopiedTerminal(request, respond, ws);
        break;
      case "terminal.close":
        closeCopiedTerminal(request, respond, ws);
        break;
      case "terminal.clearBuffer":
        respond(
          success(request.id, {
            clear: {
              handle: text(request.params.terminal),
              cleared: true,
            },
          }),
        );
        break;
      case "terminal.setDisplayMode": {
        const handle = text(request.params.terminal);
        const mode = request.params.mode === "desktop" ? "desktop" : "auto";
        mockDisplayModes.set(handle, mode);
        respond(success(request.id, { mode }));
        break;
      }
      case "terminal.getAutoRestoreFit":
        respond(success(request.id, { ms: mockAutoRestoreFitMs }));
        break;
      case "terminal.setAutoRestoreFit":
        mockAutoRestoreFitMs = normalizeAutoRestoreFitMs(request.params.ms);
        respond(success(request.id, { ms: mockAutoRestoreFitMs }));
        break;
      case "markdown.readTab":
        respond(success(request.id, copiedMarkdownTab(request.params)));
        break;
      case "markdown.saveTab":
        respond(
          error(request.id, "read_only", "Symphony markdown tabs are read-only on mobile", false),
        );
        break;
      default:
        respond(
          error(request.id, "method_not_allowed", "RPC method is not available to mobile", false),
        );
    }
  } catch {
    respond(
      error(
        request.id,
        "route_not_allowed",
        "Tracker route is not available over Symphony mobile RPC",
        false,
      ),
    );
  }
}

export function unsubscribe(ws: WebSocket, subscriptionId: string): boolean {
  const entries = subscriptions.get(ws);
  const subscription = entries?.get(subscriptionId);
  if (!entries || !subscription) return false;
  for (const timer of subscription.timers) clearTimeout(timer);
  entries.delete(subscriptionId);
  if (entries.size === 0) subscriptions.delete(ws);
  return true;
}

export function cancelRequest(ws: WebSocket, requestId: string): boolean {
  const requests = pendingResponses.get(ws);
  const timers = requests?.get(requestId);
  if (!requests || !timers || timers.size === 0) return false;
  for (const timer of timers) clearTimeout(timer);
  requests.delete(requestId);
  if (requests.size === 0) pendingResponses.delete(ws);
  return true;
}

export function cleanupConnection(ws: WebSocket): void {
  const entries = subscriptions.get(ws);
  if (entries) {
    for (const subscription of entries.values()) {
      for (const timer of subscription.timers) clearTimeout(timer);
    }
    subscriptions.delete(ws);
  }

  const requests = pendingResponses.get(ws);
  if (requests) {
    for (const timers of requests.values()) {
      for (const timer of timers) clearTimeout(timer);
    }
  }
  pendingResponses.delete(ws);
}

function mockPrimaryTerminalTab(): Record<string, unknown> {
  return {
    type: "terminal",
    id: "thread:101",
    title: "Dev10x mobile",
    terminal: "thread:101",
    launchAgent: "codex",
    status: "ready",
    isActive: true,
  };
}

function copiedSessionSnapshot(params: Record<string, unknown>): Record<string, unknown> {
  const threadId = worktreeId(params.worktree);
  const primaryHandle = `thread:${threadId}`;
  const tabs =
    threadId === 101
      ? mockSessionTabs
      : [
          {
            ...mockPrimaryTerminalTab(),
            id: primaryHandle,
            terminal: primaryHandle,
          },
        ];
  const activeTabId = tabs.some((tab) => tab.id === mockActiveTabId)
    ? mockActiveTabId
    : primaryHandle;
  return {
    worktree: String(threadId),
    publicationEpoch: `${HOST_ID}:${threadId}`,
    snapshotVersion: mockSessionSnapshotVersion,
    tabs: tabs.map((tab) => ({ ...tab, isActive: tab.id === activeTabId })),
    activeTabId,
    activeTabType: "terminal",
  };
}

function copiedTerminalList(params: Record<string, unknown>): Record<string, unknown> {
  const snapshot = copiedSessionSnapshot(params);
  const terminals = (snapshot.tabs as Record<string, unknown>[]).map((tab) => ({
    handle: tab.terminal,
    title: tab.title,
    isActive: tab.isActive,
    worktreeId: snapshot.worktree,
    hasRunningProcess: tab.status === "ready",
  }));
  return {
    terminals,
    totalCount: terminals.length,
    truncated: false,
  };
}

function subscribeCopiedSessionTabs(request: RpcRequest, send: Send, ws: WebSocket): void {
  const threadId = worktreeId(request.params.worktree);
  const subscription = registerSubscription("session-tabs", threadId, send, ws);
  send(success(request.id, { subscription_id: subscription.id }));
  schedule(subscription, () =>
    emit(subscription, "session.tabs.snapshot", {
      type: "snapshot",
      ...copiedSessionSnapshot({ worktree: `id:${threadId}` }),
    }),
  );
}

function subscribeCopiedTerminal(request: RpcRequest, send: Send, ws: WebSocket): void {
  const handle = text(request.params.terminal) || "thread:101";
  const threadId = terminalThreadId(handle);
  const subscription = registerSubscription("orca-terminal", threadId, send, ws, handle);
  const viewport = record(request.params.viewport);
  const cols = positiveInteger(viewport.cols, 80);
  const rows = positiveInteger(viewport.rows, 24);
  send(success(request.id, { subscription_id: subscription.id }));
  schedule(subscription, () =>
    emit(subscription, "terminal.scrollback", {
      type: "scrollback",
      serialized: "$ dev10x mobile --mock\nDev10x mock host online\nSymphony RPC: encrypted\n",
      lines: ["$ dev10x mobile --mock", "Dev10x mock host online", "Symphony RPC: encrypted"],
      truncated: false,
      cols,
      rows,
      displayMode: copiedDisplayMode(handle),
    }),
  );
}

function registerSubscription(
  kind: Subscription["kind"],
  threadId: number,
  send: Send,
  ws: WebSocket,
  terminalHandle?: string,
): Subscription {
  const id = `sub_mock_${++nextSubscription}`;
  const subscription: Subscription = {
    id,
    kind,
    threadId,
    ...(terminalHandle ? { terminalHandle } : {}),
    sequence: 0,
    send,
    timers: new Set(),
  };
  const entries = subscriptions.get(ws) ?? new Map();
  entries.set(id, subscription);
  subscriptions.set(ws, entries);
  return subscription;
}

function activateCopiedSessionTab(request: RpcRequest, send: Send, ws: WebSocket): void {
  const threadId = worktreeId(request.params.worktree);
  const tabId = text(request.params.tabId);
  const exists = mockSessionTabs.some((tab) => tab.id === tabId);
  if (!exists) {
    send(error(request.id, "not_found", "Session tab was not found"));
    return;
  }
  mockActiveTabId = tabId;
  mockSessionSnapshotVersion += 1;
  const snapshot = copiedSessionSnapshot({ worktree: `id:${threadId}` });
  send(success(request.id, snapshot));
  emitCopiedSessionUpdate(ws, threadId, snapshot);
}

function createCopiedTerminalTab(request: RpcRequest, send: Send, ws: WebSocket): void {
  const threadId = worktreeId(request.params.worktree);
  const agent = text(request.params.launchAgent) || text(request.params.agent);
  const handle = `tab:${threadId}:c3ltcGhvbnk:mock-${mockSessionTabs.length}`;
  const tab = {
    type: "terminal",
    id: handle,
    title: agent ? titleCase(agent) : "Terminal",
    terminal: handle,
    ...(agent ? { launchAgent: agent } : {}),
    status: "ready",
    isActive: request.params.activate !== false,
  };
  mockSessionTabs = [...mockSessionTabs, tab];
  if (request.params.activate !== false) mockActiveTabId = handle;
  mockSessionSnapshotVersion += 1;
  send(success(request.id, { tab: { ...tab, isActive: mockActiveTabId === handle } }));
  emitCopiedSessionUpdate(ws, threadId, copiedSessionSnapshot({ worktree: `id:${threadId}` }));
}

function closeCopiedSessionTab(request: RpcRequest, send: Send, ws: WebSocket): void {
  const threadId = worktreeId(request.params.worktree);
  const tabId = text(request.params.tabId);
  if (tabId === `thread:${threadId}`) {
    send(error(request.id, "protected_terminal", "The primary Symphony terminal cannot be closed"));
    return;
  }
  const before = mockSessionTabs.length;
  mockSessionTabs = mockSessionTabs.filter((tab) => tab.id !== tabId);
  if (mockSessionTabs.length === before) {
    send(error(request.id, "not_found", "Session tab was not found"));
    return;
  }
  mockActiveTabId = `thread:${threadId}`;
  mockSessionSnapshotVersion += 1;
  const snapshot = copiedSessionSnapshot({ worktree: `id:${threadId}` });
  send(success(request.id, { closed: true, tabId, snapshot }));
  emitCopiedSessionUpdate(ws, threadId, snapshot);
}

function sendCopiedTerminalInput(request: RpcRequest, send: Send, ws: WebSocket): void {
  const handle = text(request.params.terminal);
  const raw = rawText(request.params.text);
  const suffix =
    request.params.interrupt === true ? "\u0003" : request.params.enter === true ? "\r" : "";
  const input = raw + suffix;
  send(
    success(request.id, {
      send: {
        handle,
        accepted: true,
        bytesWritten: new TextEncoder().encode(input).byteLength,
      },
    }),
  );
  for (const subscription of matchingTerminalSubscriptions(ws, handle)) {
    schedule(subscription, () =>
      emit(subscription, "terminal.data", {
        type: "data",
        chunk: `${raw}${suffix ? "\n" : ""}mock: command accepted\n`,
      }),
    );
  }
}

function focusCopiedTerminal(request: RpcRequest, send: Send, ws: WebSocket): void {
  const handle = text(request.params.terminal);
  const tab = mockSessionTabs.find((candidate) => candidate.terminal === handle);
  if (!tab) {
    send(error(request.id, "not_found", "Terminal was not found"));
    return;
  }
  mockActiveTabId = String(tab.id);
  mockSessionSnapshotVersion += 1;
  send(success(request.id, { focus: { handle, focused: true } }));
  emitCopiedSessionUpdate(
    ws,
    terminalThreadId(handle),
    copiedSessionSnapshot({ worktree: `id:${terminalThreadId(handle)}` }),
  );
}

function renameCopiedTerminal(request: RpcRequest, send: Send, ws: WebSocket): void {
  const handle = text(request.params.terminal);
  const title = text(request.params.title) || "Terminal";
  let found = false;
  mockSessionTabs = mockSessionTabs.map((tab) => {
    if (tab.terminal !== handle) return tab;
    found = true;
    return { ...tab, title };
  });
  if (!found) {
    send(error(request.id, "not_found", "Terminal was not found"));
    return;
  }
  mockSessionSnapshotVersion += 1;
  send(success(request.id, { rename: { handle, title } }));
  emitCopiedSessionUpdate(
    ws,
    terminalThreadId(handle),
    copiedSessionSnapshot({ worktree: `id:${terminalThreadId(handle)}` }),
  );
}

function closeCopiedTerminal(request: RpcRequest, send: Send, ws: WebSocket): void {
  closeCopiedSessionTab(
    {
      ...request,
      params: {
        worktree: `id:${terminalThreadId(text(request.params.terminal))}`,
        tabId: text(request.params.terminal),
      },
    },
    (response) => {
      if (response.type === "result" && response.ok) {
        send(
          success(request.id, {
            close: { handle: text(request.params.terminal), closed: true },
          }),
        );
      } else {
        send(response);
      }
    },
    ws,
  );
}

function copiedMarkdownTab(params: Record<string, unknown>): Record<string, unknown> {
  const tabId = text(params.tabId) || "docs/mock-comparison.md";
  const content =
    "# Dev10x mobile\n\nThis read-only document comes from the Symphony mock RPC host.";
  return {
    tabId,
    content,
    baseVersion: "mock-markdown-v1",
    editable: false,
    readOnlyReason: "Symphony markdown tabs are read-only on mobile",
  };
}

function emitCopiedSessionUpdate(
  ws: WebSocket,
  threadId: number,
  snapshot: Record<string, unknown>,
): void {
  for (const subscription of matchingSubscriptions(ws, "session-tabs", threadId)) {
    schedule(subscription, () =>
      emit(subscription, "session.tabs.updated", {
        type: "updated",
        ...snapshot,
      }),
    );
  }
}

function matchingTerminalSubscriptions(ws: WebSocket, handle: string): Subscription[] {
  return [...(subscriptions.get(ws)?.values() ?? [])].filter(
    (subscription) =>
      subscription.kind === "orca-terminal" && subscription.terminalHandle === handle,
  );
}

function copiedDisplayMode(handle: string): "auto" | "desktop" {
  return mockDisplayModes.get(handle) ?? "auto";
}

function normalizeAutoRestoreFitMs(value: unknown): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(5_000, Math.min(3_600_000, Math.round(parsed)));
}

function worktreeId(selector: unknown): number {
  const raw = text(selector).replace(/^id:/, "");
  return positiveInteger(raw, 101);
}

function terminalThreadId(handle: string): number {
  const match = /^(?:thread|tab):(\d+)(?::|$)/.exec(handle);
  return positiveInteger(match?.[1], 101);
}

function titleCase(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function subscribe(
  kind: Subscription["kind"],
  request: RpcRequest,
  send: Send,
  ws: WebSocket,
): void {
  const threadId = positiveInteger(request.params.thread_id, 101);
  const subscription = registerSubscription(kind, threadId, send, ws);
  send(success(request.id, { subscription_id: subscription.id }));

  if (kind === "sessions") {
    schedule(subscription, () =>
      emit(subscription, "sessions.history_loaded", {
        messages: [
          message("mock-user", "user", "Compare the Orca and Symphony mobile experience."),
          message(
            "mock-assistant",
            "assistant",
            "Mock host connected through the production encrypted RPC client.",
          ),
        ],
      }),
    );
  } else {
    schedule(subscription, () =>
      emit(subscription, "terminal.joined", {
        session: {
          output:
            "$ symphony mobile --mock\nEncrypted mock host online\nWorkspace: /work/symphony\n",
        },
      }),
    );
    schedule(subscription, () =>
      emit(subscription, "terminal.output", {
        data: "$ git status --short\n M mobile/scripts/mock-server.ts\n",
      }),
    );
  }
}

function handleSessionCommand(request: RpcRequest, send: Send, ws: WebSocket): void {
  const event = text(request.params.event);
  const payload = record(request.params.payload);
  const threadId = positiveInteger(request.params.thread_id, 101);
  send(success(request.id, { accepted: true, event }));
  const targets = matchingSubscriptions(ws, "sessions", threadId);

  if (event === "send_message") {
    const content = text(payload.message) || "Continue";
    const userMessage = message(`user-${Date.now()}`, "user", content);
    const assistant = message(
      `assistant-${Date.now()}`,
      "assistant",
      "Mock response received over encrypted Symphony RPC.",
    );
    for (const subscription of targets) {
      schedule(subscription, () =>
        emit(subscription, "sessions.message_created", { message: userMessage }),
      );
      schedule(subscription, () =>
        emit(subscription, "sessions.turn_status", {
          status: "running",
          can_resume: false,
        }),
      );
      schedule(subscription, () =>
        emit(subscription, "sessions.assistant_delta", {
          delta: "Mock response received over encrypted Symphony RPC.",
        }),
      );
      schedule(subscription, () =>
        emit(subscription, "sessions.assistant_completed", { message: assistant }),
      );
    }
  } else if (event === "sync_history") {
    for (const subscription of targets) {
      schedule(subscription, () =>
        emit(subscription, "sessions.history_synced", {
          messages: [
            message(
              "mock-assistant",
              "assistant",
              "Mock host connected through the production encrypted RPC client.",
            ),
          ],
        }),
      );
    }
  } else if (event === "submit_approval" || event === "submit_user_input") {
    for (const subscription of targets) {
      schedule(subscription, () =>
        emit(subscription, "sessions.turn_status", {
          status: "running",
          can_resume: false,
        }),
      );
    }
  }
}

function handleTerminalCommand(request: RpcRequest, send: Send, ws: WebSocket): void {
  const event = text(request.params.event);
  const payload = record(request.params.payload);
  const threadId = positiveInteger(request.params.thread_id, 101);
  send(success(request.id, { accepted: true, event }));
  if (event !== "input") return;
  const data = text(payload.data);
  if (!data) return;
  for (const subscription of matchingSubscriptions(ws, "terminal", threadId)) {
    schedule(subscription, () =>
      emit(subscription, "terminal.output", {
        data: `${data}${data.endsWith("\n") ? "" : "\n"}mock: command accepted\n`,
      }),
    );
  }
}

function systemTrackerResponse(params: Record<string, unknown>): unknown {
  const { pathname: path, method } = parsedRequest(params);
  if (
    method !== "GET" ||
    !["/viewer", "/settings/agents/availability", "/settings/agents/usage"].includes(path)
  ) {
    throw new Error("Mock tracker route is not available");
  }
  if (path === "/viewer") return { data: { id: "mock-user", name: "Raphael Mock" } };
  if (path === "/settings/agents/availability") {
    return {
      data: {
        codex: {
          available: true,
          version: "mock",
          command: "codex",
          path: "/mock/bin/codex",
          authenticated: true,
          detail: null,
        },
      },
    };
  }
  return {
    data: {
      codex: {
        agent_kind: "codex",
        plan: "mock",
        credits_remaining: null,
        credits_unlimited: true,
        fetched_at: now(),
        stale: false,
        windows: [],
        model_limits: [],
      },
    },
  };
}

function projectResponse(params: Record<string, unknown>): unknown {
  requireRequest(params, "GET", "/projects");
  return { data: [{ id: "1", slug: "symphony", name: "Symphony" }] };
}

function taskResponse(params: Record<string, unknown>): unknown {
  const { pathname, method, body } = parsedRequest(params);
  const base = /^\/projects\/[^/]+\/issues$/;
  const formOptions = /^\/projects\/[^/]+\/issues\/form_options$/;
  const issuePath = /^\/projects\/[^/]+\/issues\/[^/]+$/;
  const commentsPath = /^\/projects\/[^/]+\/issues\/[^/]+\/comments$/;
  const blockersPath = /^\/projects\/[^/]+\/issues\/[^/]+\/blockers$/;
  const subtasksPath = /^\/projects\/[^/]+\/issues\/[^/]+\/subtasks$/;
  const dispatchPath = /^\/projects\/[^/]+\/issues\/[^/]+\/dispatch$/;
  const goalPath = /^\/projects\/[^/]+\/issues\/[^/]+\/goal$/;
  if (
    !(
      (base.test(pathname) && ["GET", "POST"].includes(method)) ||
      (formOptions.test(pathname) && method === "GET") ||
      (issuePath.test(pathname) && ["GET", "PATCH"].includes(method)) ||
      (commentsPath.test(pathname) && ["GET", "POST"].includes(method)) ||
      (blockersPath.test(pathname) && method === "GET") ||
      (subtasksPath.test(pathname) && ["GET", "POST"].includes(method)) ||
      (dispatchPath.test(pathname) && method === "POST") ||
      (goalPath.test(pathname) && method === "POST")
    )
  ) {
    throw new Error("Mock tracker route is not available");
  }
  if (pathname.endsWith("/form_options")) {
    return {
      data: {
        statuses: ["Todo", "In Progress", "Done"],
        labels: [{ id: "mobile", name: "Mobile", color: "#60a5fa" }],
        assignees: [{ id: "mock-user", login: "raphael", name: "Raphael" }],
        agents: [{ value: "codex", label: "Codex", default: true }],
        effective_agent: "codex",
      },
    };
  }
  if (pathname.endsWith("/comments")) {
    if (method === "POST") {
      const comment = {
        ...mockComment(),
        id: String(comments.length + 1),
        body: text(body.body) || "Mock comment",
      };
      comments.push(comment);
      return { data: comment };
    }
    return { data: comments };
  }
  if (pathname.endsWith("/blockers")) {
    return {
      data: [
        {
          identifier: "SYM-99",
          title: "Review encrypted transport",
          status: "In Progress",
          relation_type: "blocked_by",
        },
      ],
    };
  }
  if (pathname.endsWith("/subtasks")) {
    if (method === "POST") {
      const subtask = {
        ...mockIssue(),
        id: String(nextIssue),
        identifier: `SYM-${nextIssue++}`,
        title: text(body.title) || "Mock subtask",
        parent_identifier: "SYM-101",
      };
      subtasks.push(subtask);
      return { data: subtask };
    }
    return { data: subtasks };
  }
  if (pathname.endsWith("/dispatch")) {
    return {
      data: {
        action: text(body.action) || "continue_work",
        message: "Mock agent action accepted",
        issue,
      },
    };
  }
  if (pathname.endsWith("/goal")) {
    return { data: { action: text(body.action) || "get", status: "running" } };
  }
  const segments = pathname.split("/").filter(Boolean);
  const identifier = segments[3];
  if (method === "POST" && !identifier) {
    issue = {
      ...issue,
      id: String(nextIssue),
      identifier: `SYM-${nextIssue++}`,
      title: text(body.title) || "Mock task",
      status: text(body.status) || "Todo",
    };
    return { data: issue };
  }
  if (method === "PATCH" && identifier) {
    issue = { ...issue, ...selectIssueFields(body) };
    return { data: issue };
  }
  return identifier ? { data: issue } : { data: [issue] };
}

function sessionResponse(params: Record<string, unknown>): unknown {
  const { pathname, method, body } = parsedRequest(params);
  if (
    !(
      (pathname === "/assistant/threads" && ["GET", "POST"].includes(method)) ||
      (/^\/projects\/[^/]+\/sessions$/.test(pathname) && method === "GET") ||
      (/^\/projects\/[^/]+\/assistant\/config$/.test(pathname) && method === "GET")
    )
  ) {
    throw new Error("Mock tracker route is not available");
  }
  if (/\/projects\/[^/]+\/sessions$/.test(pathname)) {
    return {
      data: [
        {
          id: "thread:101",
          thread_id: 101,
          title: "Compare Orca mobile",
          kind: "workspace_session",
          scope: "project_session",
          href: "/session/101",
          updated_at: now(),
          aggregate_status: "running",
          agent_kind: "codex",
          issue_identifier: "SYM-101",
          workspace_path: "/work/symphony",
          workspace_id: "101",
          pinned: false,
          archived: false,
        },
      ],
      meta: { next_cursor: null },
    };
  }
  if (pathname.endsWith("/assistant/config")) {
    return {
      data: {
        default_agent: "codex",
        agents: [
          {
            agent: "codex",
            agent_label: "Codex",
            default_model: "gpt-5.6-sol",
            models: [
              {
                model: "gpt-5.6-sol",
                label: "GPT-5.6 Sol",
                efforts: [{ effort: "high", label: "High" }],
              },
            ],
          },
        ],
      },
    };
  }
  const thread = mockThread();
  if (method === "POST") {
    return {
      data: {
        ...thread,
        scope: text(body.scope) || thread.scope,
        project_slug: text(body.project_slug) || thread.project_slug,
      },
    };
  }
  return { data: [thread] };
}

function workspaceResponse(params: Record<string, unknown>): unknown {
  const { pathname: path, method } = parsedRequest(params);
  if (
    method !== "GET" ||
    !/^\/assistant\/threads\/[^/]+\/(?:documents|files)(?:\/.+)?$/.test(path)
  ) {
    throw new Error("Mock tracker route is not available");
  }
  if (path.includes("/documents/")) {
    return {
      data: {
        path: path.split("/documents/")[1],
        content: "# Mock comparison\n\nPort the proven Orca mock-server workflow.",
      },
    };
  }
  if (path.endsWith("/documents")) {
    return {
      data: {
        available: true,
        reason: null,
        documents: [
          {
            id: "docs/mock-comparison.md",
            path: "docs/mock-comparison.md",
            title: "Mock comparison",
            updated_at: now(),
          },
        ],
      },
    };
  }
  if (path.includes("/files/")) {
    const filePath = path.split("/files/")[1] ?? "mobile/scripts/mock-server.ts";
    return {
      data: {
        path: filePath,
        kind: "text",
        mime_type: "text/typescript",
        content: 'export const backend = "mock";\n',
        data_uri: null,
      },
    };
  }
  return {
    data: {
      available: true,
      reason: null,
      files: [
        {
          id: "mobile/scripts/mock-server.ts",
          path: "mobile/scripts/mock-server.ts",
          name: "mock-server.ts",
          title: "Symphony mock server",
          kind: "text",
          size: 420,
          updated_at: now(),
        },
        {
          id: "docs/mock-comparison.md",
          path: "docs/mock-comparison.md",
          name: "mock-comparison.md",
          title: "Orca comparison",
          kind: "markdown",
          size: 180,
          updated_at: now(),
        },
      ],
    },
  };
}

function gitResponse(params: Record<string, unknown>): unknown {
  const { pathname, method, body } = parsedRequest(params);
  if (
    !(
      (/^\/assistant\/threads\/[^/]+\/diff\/(?:stats|files|patch)$/.test(pathname) &&
        method === "GET") ||
      (/^\/assistant\/threads\/[^/]+\/diff\/(?:commit|push)$/.test(pathname) && method === "POST")
    )
  ) {
    throw new Error("Mock tracker route is not available");
  }
  const workspace = { path: "/work/symphony", available: true };
  if (pathname.endsWith("/stats")) {
    return {
      data: [
        {
          repo: "symphony",
          branch: "agent/mobile-companion-e2e",
          base: "main",
          files_changed: 2,
          additions: 84,
          deletions: 8,
          untracked: 1,
        },
      ],
      workspace,
    };
  }
  if (pathname.endsWith("/files")) {
    return {
      files: [
        {
          repo: "symphony",
          path: "mobile/scripts/mock-server.ts",
          old_path: null,
          status: "modified",
          additions: 72,
          deletions: 4,
          binary: false,
        },
      ],
      total: 1,
      limit: 100,
      next_cursor: null,
      workspace,
    };
  }
  if (pathname.endsWith("/patch")) {
    return {
      data: {
        repo: "symphony",
        path: "mobile/scripts/mock-server.ts",
        status: "modified",
        binary: false,
        truncated: false,
        patch: "@@ -1 +1 @@\n-legacy\n+encrypted mock server\n",
      },
      workspace,
    };
  }
  if (pathname.endsWith("/commit")) {
    return {
      data: [
        {
          repo: "symphony",
          sha: "mockc0ffee123",
          message: text(body.message) || "Add mock server",
          files: ["mobile/scripts/mock-server.ts"],
        },
      ],
      workspace,
    };
  }
  return { data: [{ repo: "symphony", ok: true }], workspace };
}

function previewResponse(params: Record<string, unknown>): unknown {
  const { pathname, method } = parsedRequest(params);
  if (
    !(
      (/^\/assistant\/threads\/[^/]+\/dev_servers$/.test(pathname) && method === "GET") ||
      (/^\/assistant\/threads\/[^/]+\/dev_servers\/(?:start|restart)$/.test(pathname) &&
        method === "POST")
    )
  ) {
    throw new Error("Mock tracker route is not available");
  }
  return {
    data: {
      available: true,
      reason: null,
      servers: [
        {
          id: 7,
          slug: "mobile",
          url: "http://127.0.0.1:8081",
          local_url: "http://127.0.0.1:8081",
          public_url: null,
          status: "ready",
          primary: true,
        },
      ],
    },
  };
}

function pullRequestResponse(params: Record<string, unknown>): unknown {
  const { pathname: path, method } = parsedRequest(params);
  const root = /^\/projects\/[^/]+\/issues\/[^/]+\/pull_requests$/;
  const link = /^\/projects\/[^/]+\/issues\/[^/]+\/pull_requests\/link$/;
  const fix = /^\/projects\/[^/]+\/issues\/[^/]+\/pull_requests\/fix$/;
  const action =
    /^\/projects\/[^/]+\/issues\/[^/]+\/pull_requests\/\d+\/(?:update_branch|rerun_failed|merge)$/;
  if (
    !(
      (root.test(path) && method === "GET") ||
      (link.test(path) && ["POST", "DELETE"].includes(method)) ||
      (fix.test(path) && method === "POST") ||
      (action.test(path) && method === "POST")
    )
  ) {
    throw new Error("Mock tracker route is not available");
  }
  if (path.endsWith("/fix")) return { data: { moved_to: "In Progress" } };
  if (path.endsWith("/update_branch")) return { data: { updated: true } };
  if (path.endsWith("/rerun_failed")) return { data: { reruns: [] } };
  if (path.endsWith("/merge")) return { data: { merged: true, method: "squash" } };
  if (path.endsWith("/link")) return { data: { linked: true } };
  return {
    data: [
      {
        number: 7,
        title: "Add direct encrypted multi-host mobile control",
        url: "https://github.com/example/symphony/pull/7",
        state: "open",
        repo: "symphony",
        origin: "auto",
        is_draft: true,
        merged: false,
        head_ref: "agent/mobile-companion-e2e",
        base_ref: "main",
        author: "raphael",
        mergeable: "MERGEABLE",
        checks_state: "SUCCESS",
        pipelines: [],
        statuses: [],
        conversation: [],
        base_behind_by: 0,
      },
    ],
    supported: true,
    available: true,
    children: [],
  };
}

function notificationResponse(params: Record<string, unknown>): unknown {
  const { pathname, method, body } = parsedRequest(params);
  if (
    !(
      (pathname === "/mobile_push/subscriptions" && ["POST", "DELETE"].includes(method)) ||
      (pathname === "/mobile_push/test" && method === "POST")
    )
  ) {
    throw new Error("Mock tracker route is not available");
  }
  if (pathname.endsWith("/test")) return { data: { sent: true, device_count: 1 } };
  if (method === "DELETE") return { data: { deleted: true } };
  return {
    data: {
      registered: true,
      device_id: text(body.device_id) || "mock-native-device",
      platform: text(body.platform) || "android",
    },
  };
}

function emit(subscription: Subscription, event: string, payload: unknown): void {
  subscription.sequence += 1;
  subscription.send({
    type: "event",
    subscription_id: subscription.id,
    sequence: subscription.sequence,
    event,
    payload,
  });
}

function schedule(subscription: Subscription, callback: () => void): void {
  const timer = setTimeout(() => {
    subscription.timers.delete(timer);
    callback();
  }, 0);
  subscription.timers.add(timer);
}

function matchingSubscriptions(
  ws: WebSocket,
  kind: Subscription["kind"],
  threadId: number,
): Subscription[] {
  return [...(subscriptions.get(ws)?.values() ?? [])].filter(
    (subscription) => subscription.kind === kind && subscription.threadId === threadId,
  );
}

function countSubscriptions(ws: WebSocket): number {
  return subscriptions.get(ws)?.size ?? 0;
}

function requestPath(params: Record<string, unknown>): string {
  return text(params.path) || "/";
}

function requireRequest(params: Record<string, unknown>, method: string, path: string): void {
  const request = parsedRequest(params);
  if (request.method !== method || request.pathname !== path) {
    throw new Error("Mock tracker route is not available");
  }
}

function parsedRequest(params: Record<string, unknown>): {
  pathname: string;
  method: string;
  body: Record<string, unknown>;
} {
  const url = new URL(requestPath(params), "http://mock.local");
  return {
    pathname: decodeURIComponent(url.pathname),
    method: text(params.method) || "GET",
    body: record(params.body),
  };
}

function mockIssue(): Record<string, unknown> {
  return {
    id: "101",
    identifier: "SYM-101",
    display_identifier: "SYM-101",
    project_slug: "symphony",
    title: "Compare Orca and Symphony mobile",
    description: "Port the standalone encrypted mock-server workflow.",
    status: "In Progress",
    priority: 1,
    position: 1,
    labels: ["mobile", "orca"],
    assignee_id: "raphael",
    creator: "raphael",
    agent_kind: "codex",
    agent_goal: "Validate the complete mobile experience",
    branch_name: "agent/mobile-companion-e2e",
    parent_identifier: null,
    inserted_at: now(),
    updated_at: now(),
  };
}

function mockComment(): Record<string, unknown> {
  return {
    id: "1",
    body: "This data comes from the standalone Symphony mock server.",
    author: "raphael",
    kind: "comment",
    inserted_at: now(),
    updated_at: now(),
  };
}

function mockThread(): Record<string, unknown> {
  return {
    id: 101,
    scope: "project_session",
    project_slug: "symphony",
    project_name: "Symphony",
    issue_identifier: "SYM-101",
    workspace_path: "/work/symphony",
    title: "Compare Orca mobile",
    status: "active",
    preview: "Encrypted mock host is ready",
    updated_at: now(),
    agent_kind: "codex",
    needs_review: false,
  };
}

function message(id: string, role: string, content: string): Record<string, unknown> {
  return { id, role, content, tool_calls: [], inserted_at: now() };
}

function selectIssueFields(body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ["title", "description", "status", "priority"] as const) {
    if (body[key] !== undefined) result[key] = body[key];
  }
  return result;
}

function responseDelayFor(method: string): number {
  const key = `MOCK_RPC_DELAY_${method.replace(/\W/g, "_").toUpperCase()}_MS`;
  return readDelay(key, DEFAULT_DELAY_MS);
}

function scheduleResponse(
  ws: WebSocket,
  requestId: string,
  response: RpcResponse,
  delay: number,
  send: Send,
): void {
  const requests = pendingResponses.get(ws) ?? new Map();
  const timers = requests.get(requestId) ?? new Set();
  const timer = setTimeout(() => {
    timers.delete(timer);
    if (timers.size === 0) requests.delete(requestId);
    if (requests.size === 0) pendingResponses.delete(ws);
    send(response);
  }, delay);
  timers.add(timer);
  requests.set(requestId, timers);
  pendingResponses.set(ws, requests);
}

function readDelay(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function metadata(): RpcResult["meta"] {
  return { host_id: HOST_ID, protocol: 1, server_timestamp: now() };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function rawText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function now(): string {
  return new Date().toISOString();
}
