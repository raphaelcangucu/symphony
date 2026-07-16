import type {
  SidebarCapabilityContext,
  SidebarMenuAction,
  SidebarMenuActionId,
  SidebarNode,
  SidebarIssueCapabilities,
  SidebarProjectNode,
  SidebarSessionNode,
  SidebarThreadCapabilities,
  SidebarWorkspaceNode,
} from "@/types/sidebar";

const REASON_UNAVAILABLE = "layout.sidebar.disabled.unavailable";
const REASON_EDITOR_TARGET = "layout.sidebar.disabled.editorTarget";
const REASON_TERMINAL_TARGET = "layout.sidebar.disabled.terminalTarget";
const REASON_ACTIVE_EXECUTION = "layout.sidebar.disabled.activeExecution";
const ACTIVE_EXECUTION_STATUSES = new Set(["active", "running", "waiting", "retrying"]);
const AGGREGATE_STATUSES = new Set(["idle", "active", "attention", "error", "stale"]);
const LOAD_STATES = new Set(["idle", "loading", "ready", "error", "stale"]);
const WORKSPACE_KINDS = new Set(["project", "issue", "standalone", "parallel", "orphan"]);
const SESSION_KINDS = new Set(["chat", "authoring", "execution"]);
const SESSION_STATUSES = new Set([
  "running",
  "waiting",
  "retrying",
  "idle",
  "active",
  "closed",
  "error",
  "aborted",
  "done",
  "in_progress",
  "todo",
]);
const AGENT_KINDS = new Set(["codex", "claude", "cursor", "opencode"]);
const EMPTY_ACTIONS: readonly SidebarMenuAction[] = Object.freeze([]);

export function resolveSidebarCapabilities(
  node: SidebarNode,
  context: SidebarCapabilityContext,
): readonly SidebarMenuAction[] {
  if (!isSidebarNode(node)) return EMPTY_ACTIONS;
  const safeContext = normalizeSidebarCapabilityContext(context);
  let actions: SidebarMenuAction[];
  switch (node.kind) {
    case "project":
      actions = projectActions(node);
      break;
    case "workspace":
      actions = workspaceActions(node, safeContext);
      break;
    case "session":
      actions = sessionActions(node, safeContext);
      break;
  }
  return Object.freeze(actions.map((action) => Object.freeze(action)));
}

function projectActions(node: SidebarProjectNode): SidebarMenuAction[] {
  const navigation = [
    enabled("open-board"),
    enabled("open-docs"),
    enabled("open-settings"),
  ];
  if (node.archived) {
    return [...navigation, enabled("restore"), enabled("remove", true)];
  }
  return [
    enabled("new-workspace"),
    enabled("new-session"),
    ...navigation,
    enabled("rename"),
    enabled("archive", true),
    enabled("remove", true),
  ];
}

function workspaceActions(
  node: SidebarWorkspaceNode,
  context: SidebarCapabilityContext,
): SidebarMenuAction[] {
  const actions: SidebarMenuAction[] = [enabled("new-session")];
  const isMainWorkspace = node.workspaceKind === "project";
  actions.push(
    context.editorTarget ? enabled("open-editor") : disabled("open-editor", REASON_EDITOR_TARGET),
    context.terminalTarget
      ? enabled("open-terminal")
      : disabled("open-terminal", REASON_TERMINAL_TARGET),
  );

  actions.push(enabled(node.pinned ? "unpin" : "pin"));
  if (!isMainWorkspace) actions.push(enabled("rename"));
  if (context.branchName) actions.push(enabled("copy-branch"));
  if (context.workspacePath) actions.push(enabled("copy-path"));
  if (!isMainWorkspace && context.workspaceRemovable) {
    actions.push(enabled("remove-workspace", true));
  }
  return actions;
}

function sessionActions(
  node: SidebarSessionNode,
  context: SidebarCapabilityContext,
): SidebarMenuAction[] {
  const actions: SidebarMenuAction[] = [];
  if (node.sessionKind === "execution") {
    if (nonBlank(node.issueIdentifier)) {
      actions.push(enabled("copy-resume-link"));
    }
    actions.push(enabled(node.pinned ? "unpin" : "pin"));
    if (nonBlank(node.issueIdentifier)) {
      actions.push(
        ACTIVE_EXECUTION_STATUSES.has(node.statusKind)
          ? disabled("archive", REASON_ACTIVE_EXECUTION, true)
          : enabled("archive", true),
      );
    }
    return actions;
  }

  const issueBacked = nonBlank(node.issueIdentifier) !== null;
  const threadBacked = node.threadId !== null;
  if (issueBacked) {
    actions.push(
      capabilityAction("rename", context.issueCapabilities?.canRename === true),
      capabilityAction(
        "manage-labels",
        context.issueCapabilities?.canManageLabels === true,
      ),
    );
  } else if (threadBacked && context.threadCapabilities) {
    actions.push(
      capabilityAction("rename", context.threadCapabilities.canRename),
      capabilityAction("manage-labels", context.threadCapabilities.canManageLabels),
    );
  }

  if (threadBacked) {
    actions.push(enabled("generate-title"));
  }

  if (threadBacked && context.threadCapabilities) {
    actions.push(capabilityAction("toggle-review", context.threadCapabilities.canReview));
  }

  actions.push(enabled(node.pinned ? "unpin" : "pin"));
  if (threadBacked && context.threadCapabilities) {
    actions.push(
      capabilityAction(
        "archive",
        canArchiveSidebarThread(context.threadCapabilities),
        true,
      ),
    );
  }
  if (canDeleteThread(node, context)) actions.push(enabled("delete", true));
  return actions;
}

export function canArchiveSidebarThread(
  capabilities: SidebarThreadCapabilities | null,
): boolean {
  return capabilities?.canArchive === true;
}

function canDeleteThread(
  node: SidebarSessionNode,
  context: SidebarCapabilityContext,
): boolean {
  const capabilities = context.threadCapabilities;
  return (
    node.sessionKind !== "execution" &&
    node.threadId !== null &&
    capabilities !== null &&
    capabilities.canDelete === true &&
    capabilities.local === true
  );
}

function capabilityAction(
  id: SidebarMenuActionId,
  available: boolean,
  destructive = false,
): SidebarMenuAction {
  return available ? enabled(id, destructive) : disabled(id, REASON_UNAVAILABLE, destructive);
}

function enabled(id: SidebarMenuActionId, destructive = false): SidebarMenuAction {
  return destructive ? { id, enabled: true, destructive: true } : { id, enabled: true };
}

function disabled(
  id: SidebarMenuActionId,
  disabledReason: string,
  destructive = false,
): SidebarMenuAction {
  return destructive
    ? { id, enabled: false, disabledReason, destructive: true }
    : { id, enabled: false, disabledReason };
}

export function normalizeSidebarCapabilityContext(
  value: unknown,
): SidebarCapabilityContext {
  const context = isPlainRecord(value) ? value : {};
  return {
    editorTarget: nonBlank(context.editorTarget),
    terminalTarget: nonBlank(context.terminalTarget),
    workspacePath: nonBlank(context.workspacePath),
    branchName: nonBlank(context.branchName),
    workspaceRemovable: context.workspaceRemovable === true,
    issueCapabilities: normalizeIssueCapabilities(context.issueCapabilities),
    threadCapabilities: normalizeThreadCapabilities(context.threadCapabilities),
  };
}

function normalizeIssueCapabilities(value: unknown): SidebarIssueCapabilities | null {
  if (
    !isPlainRecord(value) ||
    typeof value.canRename !== "boolean" ||
    typeof value.canManageLabels !== "boolean"
  ) {
    return null;
  }
  return {
    canRename: value.canRename === true,
    canManageLabels: value.canManageLabels === true,
  };
}

function normalizeThreadCapabilities(value: unknown): SidebarThreadCapabilities | null {
  if (
    !isPlainRecord(value) ||
    typeof value.canRename !== "boolean" ||
    typeof value.canManageLabels !== "boolean" ||
    typeof value.canReview !== "boolean" ||
    typeof value.canArchive !== "boolean" ||
    typeof value.canDelete !== "boolean" ||
    typeof value.local !== "boolean" ||
    typeof value.active !== "boolean" ||
    typeof value.closed !== "boolean"
  ) {
    return null;
  }
  return {
    canRename: value.canRename === true,
    canManageLabels: value.canManageLabels === true,
    canReview: value.canReview === true,
    canArchive: value.canArchive === true,
    canDelete: value.canDelete === true,
    local: value.local === true,
    active: value.active === true,
    closed: value.closed === true,
  };
}

function nonBlank(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSidebarNode(value: unknown): value is SidebarNode {
  if (!isPlainRecord(value) || !hasValidCommonFields(value)) return false;
  if (value.kind === "project") {
    return (
      typeof value.archived === "boolean" &&
      typeof value.loadState === "string" &&
      LOAD_STATES.has(value.loadState) &&
      (value.error === null || typeof value.error === "string") &&
      Array.isArray(value.sessions) &&
      Array.isArray(value.overflowSessions) &&
      (value.nextCursor === null || typeof value.nextCursor === "string") &&
      Array.isArray(value.workspaces) &&
      Array.isArray(value.overflowWorkspaces) &&
      Array.isArray(value.unassignedSessions)
    );
  }
  if (value.kind === "workspace") {
    return (
      typeof value.workspaceKind === "string" &&
      WORKSPACE_KINDS.has(value.workspaceKind) &&
      nullableString(value.branchSummary) &&
      (value.inventory === null || isPlainRecord(value.inventory)) &&
      nullableString(value.issueIdentifier) &&
      Array.isArray(value.sessions) &&
      Array.isArray(value.overflowSessions)
    );
  }
  if (value.kind === "session") {
    return (
      nullableNonBlankString(value.workspaceId) &&
      typeof value.sessionKind === "string" &&
      SESSION_KINDS.has(value.sessionKind) &&
      typeof value.statusKind === "string" &&
      SESSION_STATUSES.has(value.statusKind) &&
      (value.agentKind === null ||
        (typeof value.agentKind === "string" && AGENT_KINDS.has(value.agentKind))) &&
      (value.threadId === null ||
        (Number.isInteger(value.threadId) && (value.threadId as number) > 0)) &&
      nullableNonBlankString(value.issueIdentifier) &&
      typeof value.archived === "boolean" &&
      typeof value.unread === "boolean" &&
      typeof value.needsReview === "boolean" &&
      nullableStringArray(value.labels) &&
      nullableStringArray(value.issueLabelNames)
    );
  }
  return false;
}

function hasValidCommonFields(value: Record<string, unknown>): boolean {
  return (
    nonBlank(value.id) !== null &&
    nonBlank(value.projectSlug) !== null &&
    nonBlank(value.title) !== null &&
    typeof value.subtitle === "string" &&
    typeof value.href === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.aggregateStatus === "string" &&
    AGGREGATE_STATUSES.has(value.aggregateStatus) &&
    typeof value.pinned === "boolean"
  );
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function nullableNonBlankString(value: unknown): boolean {
  return value === null || nonBlank(value) !== null;
}

function nullableStringArray(value: unknown): boolean {
  return (
    value === null ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
