import type { SidebarActionRequest } from "@/hooks/useSidebarActions";
import { canArchiveSidebarThread } from "@/lib/sidebarCapabilities";
import type {
  SidebarCapabilityContext,
  SidebarMenuActionId,
  SidebarNode,
} from "@/types/sidebar";

export const SIDEBAR_ACTION_LABELS: Readonly<Record<SidebarMenuActionId, string>> = {
  "new-workspace": "New workspace",
  "new-session": "New session",
  "open-board": "Open board",
  "open-docs": "Open docs",
  "open-settings": "Open settings",
  "open-editor": "Open in editor",
  "open-terminal": "Open terminal",
  pin: "Pin",
  unpin: "Unpin",
  rename: "Rename",
  "generate-title": "Generate name",
  "copy-branch": "Copy branch",
  "copy-path": "Copy path",
  "manage-labels": "Manage labels",
  "toggle-review": "Mark for review",
  "copy-resume-link": "Copy resume link",
  archive: "Archive",
  restore: "Restore",
  remove: "Remove",
  "remove-workspace": "Remove workspace",
  delete: "Delete",
};

export function sidebarRenameRequest(
  node: SidebarNode,
  context: SidebarCapabilityContext,
  name: string,
): SidebarActionRequest | null {
  if (node.kind === "project") {
    return { action: "rename-project", projectSlug: node.projectSlug, name };
  }
  if (node.kind === "workspace" && context.workspacePath) {
    return {
      action: "rename-workspace",
      projectSlug: node.projectSlug,
      path: context.workspacePath,
      name,
      workspaceKind: node.workspaceKind,
    };
  }
  if (node.kind !== "session") return null;
  if (node.threadId === null) return null;
  return {
    action: "rename-thread",
    projectSlug: node.projectSlug,
    threadId: node.threadId,
    title: name,
  };
}

export function sidebarArchiveRequest(
  node: SidebarNode,
  context: SidebarCapabilityContext,
): SidebarActionRequest | null {
  if (node.kind === "project") {
    return { action: "archive-project", projectSlug: node.projectSlug };
  }
  if (node.kind !== "session") return null;
  if (node.sessionKind === "execution") {
    if (node.threadId != null) {
      return {
        action: "archive-thread",
        projectSlug: node.projectSlug,
        threadId: node.threadId,
        canArchive: true,
      };
    }
    if (node.issueIdentifier) {
      return {
        action: "archive-issue",
        projectSlug: node.projectSlug,
        identifier: node.issueIdentifier,
        active: node.aggregateStatus === "active",
      };
    }
    return null;
  }
  if (
    node.threadId === null ||
    !canArchiveSidebarThread(context.threadCapabilities)
  ) {
    return null;
  }
  return {
    action: "archive-thread",
    projectSlug: node.projectSlug,
    threadId: node.threadId,
    canArchive: true,
  };
}

export function sidebarRemoveExecutionRequest(node: SidebarNode): SidebarActionRequest | null {
  if (node.kind !== "session") return null;
  if (node.sessionKind !== "execution") return null;
  if (node.threadId != null) {
    return {
      action: "delete-thread",
      projectSlug: node.projectSlug,
      threadId: node.threadId,
      sessionKind: "execution",
      local: true,
      archived: node.archived,
      closed: node.archived || node.statusKind === "closed" || node.statusKind === "done",
    };
  }
  if (!node.issueIdentifier?.trim()) return null;
  return {
    action: "delete-issue",
    projectSlug: node.projectSlug,
    identifier: node.issueIdentifier,
    active: node.aggregateStatus === "active",
  };
}
