import type {
  AssistantCatalog,
  AssistantThread,
  IssueComment,
  IssueSummary,
  ProjectSessionRow,
  ProjectSummary,
  TrackerClient,
} from "@/api/contracts";
import type { ConnectionProfile } from "@/auth/connection-profile";
import type { ConnectionStorage, ConnectionStorageSnapshot } from "@/auth/connection-storage";
import type { AssistantMessage } from "@/features/sessions/session-reducer";
import { createNotificationRouter } from "@/native/notifications";
import type { CreateAssistantSessionOptions } from "@/realtime/assistant-session";
import type { AppRuntime } from "@/runtime/AppRuntime";

const profile: ConnectionProfile = {
  id: "e2e-remote",
  name: "Remote",
  origin: "https://fixture.symphony.test",
  createdAt: "2026-07-24T00:00:00Z",
  lastConnectedAt: "2026-07-24T02:00:00Z",
};
const localProfile: ConnectionProfile = {
  id: "e2e-local",
  name: "Local",
  origin: "http://127.0.0.1:4000",
  createdAt: "2026-07-24T00:30:00Z",
  lastConnectedAt: "2026-07-24T01:30:00Z",
};
const snapshot: ConnectionStorageSnapshot = {
  profiles: [profile, localProfile],
  activeProfileId: profile.id,
};
const projects: ProjectSummary[] = [{ id: "project-symphony", slug: "symphony", name: "Symphony" }];
const fixtureIssue: IssueSummary = {
  id: "issue-mob-7",
  identifier: "MOB-7",
  displayIdentifier: "MOB-7",
  projectSlug: "symphony",
  title: "Complete Orca mobile parity",
  description: "Bring task and workspace operations to Symphony Mobile.",
  status: "In Progress",
  priority: 1,
  position: 1,
  labels: ["mobile", "orca"],
  assignee: "raphael",
  creator: "raphael",
  agentKind: "codex",
  agentGoal: "Ship the complete mobile experience",
  branchName: "agent/mobile-companion-e2e",
  createdAt: "2026-07-24T01:00:00Z",
  updatedAt: "2026-07-24T02:00:00Z",
};
const fixtureComment: IssueComment = {
  id: "comment-1",
  body: "Continue from the native task screen.",
  author: "raphael",
  kind: "comment",
  createdAt: "2026-07-24T01:30:00Z",
  updatedAt: "2026-07-24T01:30:00Z",
};
const fixtureThread: AssistantThread = {
  id: 42,
  scope: "project_session",
  projectSlug: "symphony",
  projectName: "Symphony",
  issueIdentifier: null,
  workspacePath: "/work/symphony",
  title: "Implement mobile sessions",
  status: "active",
  preview: "Continue with the clean native experience",
  updatedAt: "2026-07-24T02:00:00Z",
  agentKind: "codex",
  needsReview: false,
};
const fixtureCatalog: AssistantCatalog = {
  defaultAgent: "codex",
  agents: [
    {
      agent: "codex",
      agentLabel: "Codex",
      defaultModel: "gpt-5.6-sol",
      models: [
        {
          model: "gpt-5.6-sol",
          label: "GPT-5.6 Sol",
          efforts: [{ effort: "high", label: "High" }],
        },
      ],
    },
  ],
};
const projectSession: ProjectSessionRow = {
  id: "thread:42",
  threadId: 42,
  title: "Implement mobile sessions",
  kind: "workspace_session",
  scope: "project_session",
  href: "/projects/symphony/workspaces/42",
  updatedAt: "2026-07-24T02:00:00Z",
  aggregateStatus: "running",
  agentKind: "codex",
  issueIdentifier: null,
  workspacePath: "/work/symphony",
  workspaceId: "42",
  pinned: false,
  archived: false,
};

export function fixtureModeFromUrl(buildFlag: string | undefined, initialUrl: string | null) {
  if (buildFlag !== "1" || !initialUrl) return false;
  try {
    return new URL(initialUrl).searchParams.get("fixture") === "1";
  } catch {
    return false;
  }
}

export function createFixtureRuntime(): AppRuntime {
  const persistedSeeds = new Map<number, string>();
  const notificationRouter = createNotificationRouter({
    getLastResponseData: async () => null,
    addResponseListener: () => ({ remove() {} }),
  });

  return {
    connectionStorage: createFixtureConnectionStorage(),
    createTrackerClient: () => createFixtureTrackerClient(),
    createAssistantSession: (options) => {
      const suppliedSeed = options.seed?.trim();
      if (suppliedSeed) persistedSeeds.set(options.threadId, suppliedSeed);

      return createFixtureAssistantSession(options, persistedSeeds.get(options.threadId));
    },
    createTerminalSession: (options) => {
      let connected = false;
      return {
        connect() {
          if (connected) return;
          connected = true;
          options.onState("connecting");
          options.onOutput("$ pwd\n/work/symphony\n$ git status\nOn branch agent/mobile\n");
          options.onState("live");
        },
        disconnect() {
          connected = false;
        },
        sendInput(data: string) {
          options.onOutput(
            `$ pwd\n/work/symphony\n$ git status\nOn branch agent/mobile\n$ ${data.trim()}\n`,
          );
        },
        resize() {},
      };
    },
    dictate: async () => "Add the Orca workflow by voice",
    notifications: {
      platform: "android",
      port: {
        isPhysicalDevice: true,
        getPermission: async () => "granted",
        requestPermission: async () => "granted",
        getExpoPushToken: async () => "ExponentPushToken[fixture]",
      },
      router: notificationRouter,
      deviceId: async () => "fixture-device",
      openSettings: async () => undefined,
    },
  };
}

export function createFixtureConnectionStorage(): ConnectionStorage {
  let current: ConnectionStorageSnapshot = {
    profiles: [...snapshot.profiles],
    activeProfileId: snapshot.activeProfileId,
  };
  const tokens = new Map([
    [profile.id, "fixture-token"],
    [localProfile.id, "fixture-local-token"],
  ]);
  return {
    loadSnapshot: async () => ({
      profiles: [...current.profiles],
      activeProfileId: current.activeProfileId,
    }),
    loadToken: async (profileId) => tokens.get(profileId) ?? null,
    saveProfile: async (nextProfile, token) => {
      const profiles = current.profiles.some((item) => item.id === nextProfile.id)
        ? current.profiles.map((item) => (item.id === nextProfile.id ? nextProfile : item))
        : [...current.profiles, nextProfile];
      tokens.set(nextProfile.id, token);
      current = {
        profiles,
        activeProfileId: current.activeProfileId ?? nextProfile.id,
      };
      return current;
    },
    selectProfile: async (profileId) => {
      if (!current.profiles.some((item) => item.id === profileId)) {
        throw new Error("Connection profile not found");
      }
      current = { ...current, activeProfileId: profileId };
      return current;
    },
    removeProfile: async (profileId) => {
      const profiles = current.profiles.filter((item) => item.id !== profileId);
      tokens.delete(profileId);
      current = {
        profiles,
        activeProfileId:
          current.activeProfileId === profileId
            ? (profiles[0]?.id ?? null)
            : current.activeProfileId,
      };
      return current;
    },
    replaceToken: async (profileId, token) => {
      if (!current.profiles.some((item) => item.id === profileId)) {
        throw new Error("Connection profile not found");
      }
      tokens.set(profileId, token);
    },
  };
}

export function createFixtureTrackerClient(): TrackerClient {
  let issue = fixtureIssue;
  const comments = [fixtureComment];
  return {
    health: async () => ({ status: "ok" }),
    viewer: async () => ({ id: "fixture-user", name: "raphael" }),
    agentAvailability: async () => ({
      codex: {
        available: true,
        version: "fixture",
        command: "codex",
        path: "/usr/bin/codex",
        authenticated: true,
        detail: null,
      },
    }),
    agentUsage: async () => ({
      codex: {
        agentKind: "codex",
        plan: "fixture",
        creditsRemaining: null,
        creditsUnlimited: true,
        fetchedAt: "2026-07-24T02:00:00Z",
        stale: false,
        windows: [
          {
            kind: "five_hour",
            usedPercent: 42,
            resetsAt: "2026-07-24T05:00:00Z",
            windowMinutes: 300,
          },
        ],
        modelLimits: [],
      },
    }),
    projects: async () => projects,
    threads: async () => [fixtureThread],
    projectSessions: async () => ({ sessions: [projectSession], nextCursor: null }),
    assistantCatalog: async () => fixtureCatalog,
    createThread: async (input) => ({
      ...fixtureThread,
      title: null,
      preview: null,
      scope: input.scope,
      projectSlug: input.scope === "freeform" ? null : input.projectSlug,
      projectName: input.scope === "freeform" ? null : "Symphony",
      issueIdentifier: input.scope === "issue_session" ? input.issueIdentifier : null,
      workspacePath: "workspacePath" in input ? (input.workspacePath ?? null) : null,
    }),
    issues: async () => [issue],
    issue: async () => issue,
    issueFormOptions: async () => ({
      statuses: ["Todo", "In Progress", "Done"],
      labels: [{ id: "mobile", name: "Mobile", color: "#60a5fa" }],
      assignees: [{ id: "fixture-user", login: "raphael", name: "Raphael" }],
      agents: [{ value: "codex", label: "Codex", default: true }],
      effectiveAgent: "codex",
    }),
    createIssue: async (_projectSlug, input) => {
      issue = {
        ...fixtureIssue,
        title: input.title,
        description: input.description ?? null,
        status: input.status,
        priority: input.priority ?? null,
        agentKind: input.agent ?? null,
        agentGoal: input.goal ?? null,
      };
      return issue;
    },
    updateIssue: async (_projectSlug, _identifier, input) => {
      issue = {
        ...issue,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
      };
      return issue;
    },
    comments: async () => comments,
    createComment: async (_projectSlug, _identifier, body) => {
      const comment = { ...fixtureComment, id: `comment-${comments.length + 1}`, body };
      comments.push(comment);
      return comment;
    },
    blockers: async () => [],
    dispatchIssue: async (_projectSlug, _identifier, input) => ({
      action: input.action,
      message: "Fixture agent action accepted",
      issue,
    }),
    goalControl: async (_projectSlug, _identifier, input) => ({
      action: input.action,
      status: input.action === "pause" ? "paused" : "running",
    }),
    threadDocuments: async () => ({
      available: true,
      reason: null,
      documents: [
        {
          id: "docs/mobile-plan.md",
          kind: "draft",
          path: "docs/mobile-plan.md",
          title: "Mobile parity plan",
          updatedAt: "2026-07-24T02:00:00Z",
        },
      ],
    }),
    threadDocument: async (_threadId, path) => ({
      path,
      content: "# Mobile parity plan\n\nComplete the Orca-inspired experience.",
    }),
    threadFiles: async () => ({
      available: true,
      reason: null,
      files: [
        {
          id: "mobile/src/App.tsx",
          path: "mobile/src/App.tsx",
          name: "App.tsx",
          title: "App.tsx",
          kind: "text",
          size: 120,
          updatedAt: "2026-07-24T02:00:00Z",
        },
        {
          id: "docs/mobile-plan.md",
          path: "docs/mobile-plan.md",
          name: "mobile-plan.md",
          title: "Mobile parity plan",
          kind: "markdown",
          size: 80,
          updatedAt: "2026-07-24T02:00:00Z",
        },
        {
          id: "assets/orca-preview.png",
          path: "assets/orca-preview.png",
          name: "orca-preview.png",
          title: "Orca preview",
          kind: "image",
          size: 68,
          updatedAt: "2026-07-24T02:00:00Z",
        },
      ],
    }),
    threadFile: async (_threadId, path) => ({
      path,
      kind: path.endsWith(".png") ? "image" : path.endsWith(".md") ? "markdown" : "text",
      mimeType: path.endsWith(".png")
        ? "image/png"
        : path.endsWith(".md")
          ? "text/markdown"
          : "text/typescript",
      content: path.endsWith(".png")
        ? null
        : path.endsWith(".md")
          ? "# Mobile parity plan\n\nComplete the Orca-inspired experience."
          : 'export const experience = "Orca operations";\n',
      dataUri: path.endsWith(".png")
        ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/7KHdJwAAAABJRU5ErkJggg=="
        : null,
    }),
    threadDevServers: async () => fixtureDevServers(),
    startThreadDevServers: async () => fixtureDevServers(),
    restartThreadDevServers: async () => fixtureDevServers(),
    threadDiffStats: async () => ({
      stats: [
        {
          repo: "symphony",
          branch: "agent/mobile-companion-e2e",
          base: "main",
          filesChanged: 2,
          additions: 48,
          deletions: 6,
          untracked: 1,
        },
      ],
      workspace: { path: "/work/symphony", available: true },
    }),
    threadDiffFiles: async () => ({
      files: [
        {
          repo: "symphony",
          path: "mobile/src/features/source-control/DiffScreen.tsx",
          oldPath: null,
          status: "modified",
          additions: 42,
          deletions: 6,
          binary: false,
        },
        {
          repo: "symphony",
          path: "mobile/app/session/[threadId]/diff.tsx",
          oldPath: null,
          status: "added",
          additions: 6,
          deletions: 0,
          binary: false,
        },
      ],
      total: 2,
      limit: 50,
      nextCursor: null,
      workspace: { path: "/work/symphony", available: true },
    }),
    threadDiffPatch: async (_threadId, options) => ({
      repo: options.repo,
      path: options.path,
      status: "modified",
      binary: false,
      truncated: false,
      patch:
        '@@ -1,2 +1,3 @@\n import React from "react";\n-old experience\n+clean mobile experience\n+Orca operations',
      workspace: { path: "/work/symphony", available: true },
    }),
    commitThreadDiff: async (_threadId, message) => ({
      commits: [
        {
          repo: "symphony",
          sha: "abc123456789",
          message,
          files: ["mobile/src/features/source-control/DiffScreen.tsx"],
        },
      ],
      workspace: { path: "/work/symphony", available: true },
    }),
    pushThreadDiff: async () => ({
      results: [{ repo: "symphony", ok: true }],
      workspace: { path: "/work/symphony", available: true },
    }),
    issuePullRequests: async () => ({
      supported: true,
      available: true,
      children: [],
      pullRequests: [
        {
          number: 7,
          title: "Complete Orca mobile parity",
          url: "https://github.com/raphaelcangucu/symphony/pull/7",
          state: "open",
          repo: "raphaelcangucu/symphony",
          origin: "auto",
          isDraft: false,
          merged: false,
          headRef: "agent/mobile-companion-e2e",
          baseRef: "main",
          author: "raphaelcangucu",
          mergeable: "MERGEABLE",
          checksState: "success",
          pipelines: [
            {
              name: "CI",
              url: null,
              jobs: [
                {
                  name: "mobile",
                  status: "COMPLETED",
                  conclusion: "SUCCESS",
                  url: null,
                },
              ],
            },
          ],
          statuses: [],
          conversation: [],
          baseBehindBy: 0,
        },
      ],
    }),
    linkIssuePullRequest: async () => undefined,
    unlinkIssuePullRequest: async () => undefined,
    requestPullRequestFix: async () => ({
      movedTo: "Rework",
      commentPosted: true,
      jobs: [],
    }),
    updatePullRequestBranch: async () => ({ updated: true }),
    rerunPullRequestJobs: async () => [{ runId: 99, ok: true }],
    mergeIssuePullRequest: async (_projectSlug, _identifier, _number, input) => ({
      merged: true,
      method: input.method,
      bypass: input.bypass === true,
      sha: "abc123456789",
      message: "Fixture pull request merged",
      issue,
    }),
    registerMobilePush: async (input) => ({
      registered: true,
      deviceId: input.deviceId,
    }),
    unregisterMobilePush: async () => ({ deleted: true }),
    sendTestMobilePush: async () => ({ sent: true, deviceCount: 1 }),
  };
}

function fixtureDevServers() {
  return {
    available: true,
    reason: null,
    servers: [
      {
        id: 7,
        slug: "mobile",
        url: "http://127.0.0.1:8081",
        localUrl: "http://127.0.0.1:8081",
        publicUrl: "https://preview.fixture.symphony.test",
        status: "ready",
        primary: true,
      },
    ],
  };
}

function createFixtureAssistantSession(
  options: CreateAssistantSessionOptions,
  persistedSeed?: string,
) {
  let connected = false;
  const seed = options.seed?.trim() || persistedSeed || "Continue the mobile session";
  const history = [
    fixtureMessage("seed", "user", seed),
    fixtureMessage("ready", "assistant", "Fixture session ready"),
  ];

  return {
    connect() {
      if (connected) return;
      connected = true;
      options.onAction({ type: "connection_changed", state: "connecting" });
      options.onAction({ type: "connection_changed", state: "live" });
      options.onAction({ type: "history_loaded", messages: history });
      if (options.seed?.trim()) options.onSeedAccepted?.();
    },
    disconnect() {
      connected = false;
    },
    retrySeed: async () => options.onSeedAccepted?.(),
    resumeTurn: async () => {
      options.onAction({
        type: "turn_status",
        status: { status: "running", canResume: false },
      });
    },
    stopTurn: async () => {
      options.onAction({
        type: "turn_status",
        status: { status: "interrupted", canResume: true },
      });
    },
    submitApproval: async (requestId: string | number) => {
      options.onAction({ type: "approval_resolved", requestId });
    },
    submitUserInput: async (requestId: string | number) => {
      options.onAction({ type: "user_input_resolved", requestId });
    },
    async sendMessage(message: string) {
      options.onAction({
        type: "message_created",
        message: fixtureMessage(`user-${Date.now()}`, "user", message),
      });
      options.onAction({
        type: "message_created",
        message: fixtureMessage(
          `assistant-${Date.now()}`,
          "assistant",
          "Fixture response received",
        ),
      });
    },
  };
}

function fixtureMessage(
  id: string,
  role: AssistantMessage["role"],
  content: string,
): AssistantMessage {
  return {
    id,
    role,
    content,
    toolCalls: [],
    insertedAt: "2026-07-24T02:00:00Z",
  };
}
