import type { WebSocket } from "ws";

import { handleMockFilePreviewRequest } from "./mock-server-file-preview-data";
import { handleMockGitRequest } from "./mock-server-git-state";
import { handleMockTaskRequest } from "./mock-server-task-state";
import {
  mockPrimaryTerminalTab,
  mockRepos,
  mockSessionSnapshot,
  mockTerminalList,
  mockTerminalScrollback,
  mockWorktrees,
  type MockTerminalTab,
} from "./mock-server-terminal-fixtures";

const HOST_ID = process.env.MOCK_HOST_ID || "host_mock";
const ORCA_RUNTIME_PROTOCOL_VERSION = 3;
const ORCA_MIN_COMPATIBLE_MOBILE_VERSION = 2;
const DEFAULT_DELAY_MS = readDelay("MOCK_RPC_DELAY_MS", 0);
const METHODS = [
  "system.identity",
  "system.health",
  "system.capabilities",
  "system.heartbeat",
  "system.usage",
  "system.tracker",
  "status.get",
  "settings.get",
  "ui.get",
  "preflight.check",
  "stats.summary",
  "accounts.list",
  "repo.list",
  "worktree.ps",
  "worktree.show",
  "devices.list",
  "devices.revoke",
  "devices.self_revoke",
  "projects.request",
  "tasks.request",
  "sessions.request",
  "sessions.subscribe",
  "sessions.command",
  "orchestrator.executions.list",
  "orchestrator.executions.subscribe",
  "orchestrator.session.subscribe",
  "orchestrator.session.command",
  "evidence.list",
  "evidence.artifact.read",
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
  "files.list",
  "files.readDir",
  "files.read",
  "files.readPreview",
  "files.open",
  "files.openDiff",
  "files.resolveTerminalPath",
  "files.readTerminalArtifact",
  "files.readTerminalArtifactPreview",
  "files.writeTerminalArtifact",
  "clipboard.startImageUpload",
  "clipboard.appendImageUploadChunk",
  "clipboard.commitImageUpload",
  "clipboard.abortImageUpload",
  "clipboard.saveImageAsTempFile",
  "git.status",
  "git.upstreamStatus",
  "git.stage",
  "git.bulkStage",
  "git.unstage",
  "git.bulkUnstage",
  "git.discard",
  "git.commit",
  "git.fetch",
  "git.pull",
  "git.push",
  "git.diff",
  "git.branchDiff",
  "git.branchCompare",
  "git.commitCompare",
  "git.history",
  "git.generateCommitMessage",
  "git.cancelGenerateCommitMessage",
  "git.generatePullRequestFields",
  "hostedReview.getCreationEligibility",
  "symphony.tasks.list",
  "symphony.tasks.get",
  "notifications.subscribe",
  "notifications.unsubscribe",
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
  kind:
    | "sessions"
    | "terminal"
    | "session-tabs"
    | "orca-terminal"
    | "notifications"
    | "orchestrator-executions"
    | "orchestrator-session";
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
let mockSessionTabs: MockTerminalTab[] = [mockPrimaryTerminalTab()];
const mockClipboardUploads = new Map<
  string,
  { expected: number; received: number; chunks: string[] }
>();
let nextClipboardUpload = 0;

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

  if (handleMockGitRequest(request, respond, success)) {
    return;
  }

  if (handleMockTaskRequest(request, respond, success)) {
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
        respond(
          success(request.id, {
            connections: 1,
            subscriptions: countSubscriptions(ws),
          }),
        );
        break;
      case "status.get":
        respond(
          success(request.id, {
            runtimeId: HOST_ID,
            product: "Symphony",
            displayName: "Symphony Mock Host — NOT REAL",
            protocolVersion: ORCA_RUNTIME_PROTOCOL_VERSION,
            minCompatibleMobileVersion: ORCA_MIN_COMPATIBLE_MOBILE_VERSION,
            capabilities: ["mobile.tasks.v1", ...METHODS],
          }),
        );
        break;
      case "settings.get":
        respond(
          success(request.id, {
            settings: {
              defaultTaskSource: "dev10x",
              visibleTaskProviders: ["dev10x"],
            },
          }),
        );
        break;
      case "ui.get":
        respond(success(request.id, { ui: {} }));
        break;
      case "preflight.check":
        respond(
          success(request.id, {
            git: { installed: true },
            gh: { installed: false },
            glab: { installed: false },
          }),
        );
        break;
      case "stats.summary":
        respond(
          success(request.id, {
            totalAgentsSpawned: 1,
            totalPRsCreated: 0,
            totalAgentTimeMs: 3_600_000,
            firstEventAt: Date.parse("2026-07-25T18:00:00Z"),
          }),
        );
        break;
      case "accounts.list":
        respond(
          success(request.id, {
            claude: { accounts: [], activeAccountId: null },
            codex: { accounts: [], activeAccountId: null },
            rateLimits: {
              claude: null,
              codex: null,
              inactiveClaudeAccounts: [],
              inactiveCodexAccounts: [],
            },
          }),
        );
        break;
      case "repo.list":
        respond(success(request.id, { repos: mockRepos() }));
        break;
      case "worktree.ps": {
        const limit = positiveInteger(request.params.limit, 200);
        respond(success(request.id, { worktrees: mockWorktrees().slice(0, limit) }));
        break;
      }
      case "worktree.show": {
        const requested = text(request.params.worktree).replace(/^(?:id|worktree):/, "");
        const worktree = mockWorktrees().find(
          (candidate) => String(candidate.worktreeId ?? candidate.id) === requested,
        );
        if (worktree) respond(success(request.id, { worktree }));
        else respond(error(request.id, "not_found", "Workspace was not found"));
        break;
      }
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
      case "notifications.subscribe":
        subscribeMockNotifications(request, respond, ws);
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
      case "orchestrator.executions.list":
        respond(success(request.id, { executions: mockOrchestratorExecutions() }));
        break;
      case "orchestrator.executions.subscribe":
        subscribeMockOrchestratorExecutions(request, respond, ws);
        break;
      case "orchestrator.session.subscribe":
        subscribeMockOrchestratorSession(request, respond, ws);
        break;
      case "orchestrator.session.command":
        handleMockOrchestratorCommand(request, respond, ws);
        break;
      case "evidence.list":
        respond(success(request.id, mockTaskEvidence()));
        break;
      case "evidence.artifact.read":
        respond(success(request.id, mockEvidenceArtifact(request.params)));
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
      case "clipboard.startImageUpload":
        startMockClipboardUpload(request, respond);
        break;
      case "clipboard.appendImageUploadChunk":
        appendMockClipboardChunk(request, respond);
        break;
      case "clipboard.commitImageUpload":
        commitMockClipboardUpload(request, respond);
        break;
      case "clipboard.abortImageUpload":
        mockClipboardUploads.delete(text(request.params.uploadId));
        respond(success(request.id, { aborted: true }));
        break;
      case "clipboard.saveImageAsTempFile":
        respond(success(request.id, "/tmp/dev10x-mobile-clipboard/mock-image.png"));
        break;
      case "files.writeTerminalArtifact":
        respond(
          success(request.id, {
            written: true,
            byteLength: rawText(request.params.content).length,
          }),
        );
        break;
      default:
        if (!handleMockFilePreviewRequest(request, respond, success, error)) {
          respond(
            error(request.id, "method_not_allowed", "RPC method is not available to mobile", false),
          );
        }
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

function mockTaskEvidence(): Record<string, unknown> {
  return {
    records: [
      {
        id: 1,
        run_id: "mock-run-1",
        session_id: "assistant-thread:101",
        status: "passed",
        ui_change: true,
        inserted_at: now(),
        provenance: {
          execution_path: "session",
          agent_kind: "codex",
          thread_id: 101,
          execution_session_id: null,
          requested_model: "gpt-5.6-sol",
          requested_effort: "high",
          resolved_model: "gpt-5.6-sol",
          resolved_effort: "high",
        },
        manifest: {
          issue: "SYM-101",
          generated_at: now(),
          ui_change: true,
          runs: [
            {
              kind: "e2e",
              repo: "symphony",
              command: "npm run test:e2e:android",
              status: "passed",
              duration_ms: 4200,
              report: {
                path: "artifacts/mock-report.md",
                label: "Focused test report",
              },
              proof: { assertions: "development fixture" },
            },
          ],
        },
      },
    ],
  };
}

function mockEvidenceArtifact(params: Record<string, unknown>): Record<string, unknown> {
  const content = Buffer.from(
    "# Dev10x mock evidence\n\nDevelopment-only task evidence fixture.\n",
    "utf8",
  );
  const offset = Math.max(0, Number(params.offset) || 0);
  const length = Math.max(1, Number(params.length) || content.length);
  const chunk = content.subarray(offset, Math.min(offset + length, content.length));
  const nextOffset = offset + chunk.length;
  return {
    content: chunk.toString("base64"),
    content_type: "text/markdown",
    size: content.length,
    offset,
    next_offset: nextOffset,
    eof: nextOffset >= content.length,
  };
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

function copiedSessionSnapshot(params: Record<string, unknown>): Record<string, unknown> {
  const threadId = worktreeId(params.worktree);
  const tabs = threadId === 101 ? mockSessionTabs : [mockPrimaryTerminalTab(threadId)];
  return mockSessionSnapshot({
    hostId: HOST_ID,
    threadId,
    tabs,
    activeTabId: mockActiveTabId,
    snapshotVersion: mockSessionSnapshotVersion,
  });
}

function copiedTerminalList(params: Record<string, unknown>): Record<string, unknown> {
  return mockTerminalList(copiedSessionSnapshot(params));
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
    emit(
      subscription,
      "terminal.scrollback",
      mockTerminalScrollback({
        cols,
        rows,
        displayMode: copiedDisplayMode(handle),
      }),
    ),
  );
}

function subscribeMockNotifications(request: RpcRequest, send: Send, ws: WebSocket): void {
  const subscription = registerSubscription("notifications", 0, send, ws);
  send(success(request.id, { subscription_id: subscription.id }));
  schedule(subscription, () =>
    emit(subscription, "notifications.ready", {
      type: "ready",
      subscriptionId: subscription.id,
    }),
  );
  schedule(subscription, () =>
    emit(subscription, "notifications.notification", {
      type: "notification",
      source: "dev10x-host",
      title: "Dev10x host",
      body: "DEV-101 needs your approval",
      notificationId: "DEV-101:approval",
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
  send(
    success(request.id, {
      tab: { ...tab, isActive: mockActiveTabId === handle },
    }),
  );
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
  const tabId = text(params.tabId) || "docs/mock-evidence.md";
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

function startMockClipboardUpload(request: RpcRequest, send: Send): void {
  const expected = Number(request.params.expectedBase64Length);
  if (!Number.isInteger(expected) || expected < 0 || expected > 24 * 1024 * 1024) {
    send(error(request.id, "image_too_large", "Clipboard image is too large"));
    return;
  }
  const uploadId = `mock-upload-${++nextClipboardUpload}`;
  mockClipboardUploads.set(uploadId, { expected, received: 0, chunks: [] });
  send(success(request.id, { uploadId }));
}

function appendMockClipboardChunk(request: RpcRequest, send: Send): void {
  const uploadId = text(request.params.uploadId);
  const upload = mockClipboardUploads.get(uploadId);
  const offset = Number(request.params.offset);
  const chunk = rawText(request.params.contentBase64);
  if (!upload) {
    send(error(request.id, "upload_not_found", "Clipboard image upload was not found"));
    return;
  }
  if (offset !== upload.received || upload.received + chunk.length > upload.expected) {
    send(
      error(request.id, "invalid_upload_offset", "Clipboard image chunk offset is out of order"),
    );
    return;
  }
  upload.chunks.push(chunk);
  upload.received += chunk.length;
  send(success(request.id, { receivedBase64Length: upload.received }));
}

function commitMockClipboardUpload(request: RpcRequest, send: Send): void {
  const uploadId = text(request.params.uploadId);
  const upload = mockClipboardUploads.get(uploadId);
  mockClipboardUploads.delete(uploadId);
  if (!upload || upload.received !== upload.expected) {
    send(error(request.id, "incomplete_upload", "Clipboard image upload is incomplete"));
    return;
  }
  send(success(request.id, `/tmp/dev10x-mobile-clipboard/${uploadId}.png`));
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
          message("mock-user", "user", "Explore the complete Dev10x mobile experience."),
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
        emit(subscription, "sessions.assistant_completed", {
          message: assistant,
        }),
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

function mockOrchestratorExecutions(): Record<string, unknown>[] {
  return [
    {
      issue_identifier: "SYM-101",
      execution_session_id: 101,
      session_id: "101",
      status: "live",
      agent_kind: "codex",
      model: null,
      last_message: "Building the Dev10x mobile RPC experience",
      last_event_at: now(),
      turn_count: 2,
    },
  ];
}

function mockOrchestratorEntries(): Record<string, unknown>[] {
  return [
    {
      kind: "user",
      title: "Operator",
      body: "Implement the unified mobile chat.",
      language: "markdown",
      status: "completed",
      collapsed: false,
      call_id: null,
    },
    {
      kind: "assistant",
      title: "Codex",
      body: "Dev10x is following this real Symphony execution transcript.",
      language: "markdown",
      status: "completed",
      collapsed: false,
      call_id: null,
    },
    {
      kind: "tool_call",
      title: "exec_command",
      body: '{"cmd":"mix test"}',
      language: "json",
      status: "completed",
      collapsed: false,
      call_id: "mock-call-1",
    },
    {
      kind: "tool_result",
      title: "exec_command output",
      body: "Focused tests passed",
      language: "text",
      status: "completed",
      collapsed: false,
      call_id: "mock-call-1",
    },
  ];
}

function subscribeMockOrchestratorExecutions(request: RpcRequest, send: Send, ws: WebSocket): void {
  const subscription = registerSubscription("orchestrator-executions", 0, send, ws);
  send(success(request.id, { subscription_id: subscription.id }));
  schedule(subscription, () =>
    emit(subscription, "orchestrator.executions.snapshot", {
      data: mockOrchestratorExecutions(),
    }),
  );
}

function subscribeMockOrchestratorSession(request: RpcRequest, send: Send, ws: WebSocket): void {
  const executionSessionId = positiveInteger(request.params.execution_session_id, 101);
  const subscription = registerSubscription("orchestrator-session", executionSessionId, send, ws);
  send(success(request.id, { subscription_id: subscription.id }));
  schedule(subscription, () =>
    emit(subscription, "orchestrator.session.joined", {
      entries: mockOrchestratorEntries(),
      agent_kind: "codex",
      preferred_agent_kind: "codex",
      log_fallback: false,
    }),
  );
}

function handleMockOrchestratorCommand(request: RpcRequest, send: Send, ws: WebSocket): void {
  const executionSessionId = positiveInteger(request.params.execution_session_id, 101);
  const event = text(request.params.event);
  const payload = record(request.params.payload);
  if (event !== "steer" || !text(payload.message)) {
    send(error(request.id, "invalid_params", "A steer message is required"));
    return;
  }
  send(success(request.id, { accepted: true }));
  for (const subscription of matchingSubscriptions(
    ws,
    "orchestrator-session",
    executionSessionId,
  )) {
    schedule(subscription, () =>
      emit(subscription, "orchestrator.session.entries", {
        entries: [
          {
            kind: "user",
            title: "Operator",
            body: text(payload.message),
            language: "markdown",
            status: "completed",
            collapsed: false,
            call_id: null,
          },
          {
            kind: "assistant",
            title: "Codex",
            body: "Steer received by the Symphony orchestrator.",
            language: "markdown",
            status: "completed",
            collapsed: false,
            call_id: null,
          },
        ],
      }),
    );
    schedule(subscription, () => emit(subscription, "orchestrator.session.steer_ok", {}));
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
          title: "Dev10x mobile workspace",
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
        content: "# Mock evidence\n\nExercise the proven Dev10x mock-server workflow.",
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
            id: "docs/mock-evidence.md",
            path: "docs/mock-evidence.md",
            title: "Mock evidence",
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
          id: "docs/mock-evidence.md",
          path: "docs/mock-evidence.md",
          name: "mock-evidence.md",
          title: "Dev10x evidence",
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
    title: "Exercise Dev10x and Symphony mobile",
    description: "Port the standalone encrypted mock-server workflow.",
    status: "In Progress",
    priority: 1,
    position: 1,
    labels: ["mobile", "dev10x"],
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
    title: "Dev10x mobile workspace",
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
