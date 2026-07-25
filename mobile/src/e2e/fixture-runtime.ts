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
import type { CreateAssistantSessionOptions } from "@/realtime/assistant-session";
import type { AppRuntime } from "@/runtime/AppRuntime";

const profile: ConnectionProfile = {
  id: "e2e-remote",
  name: "Remote",
  origin: "https://fixture.symphony.test",
  createdAt: "2026-07-24T00:00:00Z",
  lastConnectedAt: "2026-07-24T02:00:00Z",
};
const snapshot: ConnectionStorageSnapshot = {
  profiles: [profile],
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

  return {
    connectionStorage: createFixtureConnectionStorage(),
    createTrackerClient: () => createFixtureTrackerClient(),
    createAssistantSession: (options) => {
      const suppliedSeed = options.seed?.trim();
      if (suppliedSeed) persistedSeeds.set(options.threadId, suppliedSeed);

      return createFixtureAssistantSession(options, persistedSeeds.get(options.threadId));
    },
  };
}

export function createFixtureConnectionStorage(): ConnectionStorage {
  return {
    loadSnapshot: async () => snapshot,
    loadToken: async (profileId) => (profileId === profile.id ? "fixture-token" : null),
    saveProfile: async () => snapshot,
    selectProfile: async () => snapshot,
    removeProfile: async () => snapshot,
    replaceToken: async () => undefined,
  };
}

export function createFixtureTrackerClient(): TrackerClient {
  let issue = fixtureIssue;
  const comments = [fixtureComment];
  return {
    health: async () => ({ status: "ok" }),
    viewer: async () => ({ id: "fixture-user", name: "raphael" }),
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
