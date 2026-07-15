import { useCallback, useRef, useState } from "react";

import { i18n } from "@/i18n";
import { copyTextToClipboard } from "@/lib/clipboard";
import { graphemeCount } from "@/lib/serviceNormalization";
import {
  addPendingSidebarAction,
  assertSidebarReviewAuthorization,
  assertSidebarThreadArchiveAuthorization,
  removePendingSidebarAction,
  sidebarCopyPendingFingerprint,
  validateSidebarActionEnvelope,
} from "@/lib/sidebarActionPolicy";
import {
  archiveAssistantThread,
  deleteAssistantThread,
  updateAssistantThread,
} from "@/services/assistantThreads";
import { archiveIssue, updateIssue } from "@/services/issues";
import {
  archiveProject,
  deleteProject,
  restoreProject,
  updateProject,
} from "@/services/projects";
import {
  removeWorkspaces,
  updateWorkspaceDisplayName,
} from "@/services/worktrees";
import type { SidebarSessionKind, SidebarWorkspaceKind } from "@/types/sidebar";

const MAX_DISPLAY_NAME_GRAPHEMES = 120;
const MAX_TITLE_GRAPHEMES = 160;
const MAX_THREAD_LABELS = 12;
const MAX_THREAD_LABEL_GRAPHEMES = 40;

export type SidebarPreferenceAction =
  | {
      action: "set-pinned";
      nodeKind: "project" | "workspace" | "session";
      nodeId: string;
      pinned: boolean;
    }
  | { action: "mark-read"; sessionId: string; readAt: string };

export type SidebarCallbackAction = {
  callback: "navigate" | "open-editor" | "open-terminal";
  value: string;
};

export type SidebarActionRequest =
  | { action: "rename-project"; projectSlug: string; name: string }
  | { action: "archive-project"; projectSlug: string }
  | { action: "restore-project"; projectSlug: string }
  | {
      action: "remove-project";
      projectSlug: string;
      archived: boolean;
      canArchive: boolean;
    }
  | {
      action: "rename-workspace";
      projectSlug: string;
      path: string;
      name: string;
      workspaceKind: SidebarWorkspaceKind;
    }
  | {
      action: "remove-workspace";
      projectSlug: string;
      path: string;
      workspaceKind: SidebarWorkspaceKind;
      removable: boolean;
    }
  | { action: "rename-thread"; projectSlug: string; threadId: number; title: string }
  | {
      action: "update-thread-metadata";
      projectSlug: string;
      threadId: number;
      labels: string[];
      needsReview: boolean | null;
      canReview: boolean;
    }
  | {
      action: "update-thread-review";
      projectSlug: string;
      threadId: number;
      needsReview: boolean;
      canReview: boolean;
    }
  | {
      action: "update-issue-thread-metadata";
      projectSlug: string;
      identifier: string;
      labelIds: string[];
      threadId: number;
      needsReview: boolean;
      canReview: boolean;
    }
  | {
      action: "archive-thread";
      projectSlug: string;
      threadId: number;
      canArchive: boolean;
    }
  | {
      action: "delete-thread";
      projectSlug: string;
      threadId: number;
      sessionKind: SidebarSessionKind;
      local: boolean;
      archived: boolean;
      closed: boolean;
    }
  | {
      action: "rename-issue";
      projectSlug: string;
      identifier: string;
      title: string;
    }
  | {
      action: "update-issue-labels";
      projectSlug: string;
      identifier: string;
      labelIds: string[];
    }
  | {
      action: "archive-issue";
      projectSlug: string;
      identifier: string;
      active: boolean;
    }
  | { action: "copy"; value: string }
  | SidebarPreferenceAction
  | ({ action: "callback" } & SidebarCallbackAction);

export type SidebarActionResult =
  | { ok: true }
  | { ok: false; committed: false; error: string; pending?: boolean }
  | { ok: false; committed: true; warning: string };

export interface UseSidebarActionsOptions {
  onProjectChanged(projectSlug: string): void | Promise<void>;
  onPreferenceAction(action: SidebarPreferenceAction): void | Promise<void>;
  onCallbackAction(action: SidebarCallbackAction): void | Promise<void>;
}

export interface UseSidebarActionsResult {
  pendingKey: string | null;
  runAction(request: SidebarActionRequest): Promise<SidebarActionResult>;
}

interface ValidatedAction {
  request: SidebarActionRequest;
  key: string;
  projectSlug: string | null;
}

interface DispatchOutcome {
  changed: boolean;
  committedWarning?: string;
}

export function useSidebarActions({
  onProjectChanged,
  onPreferenceAction,
  onCallbackAction,
}: UseSidebarActionsOptions): UseSidebarActionsResult {
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const pendingKeysRef = useRef<ReadonlySet<string>>(new Set<string>());

  const runAction = useCallback(
    async (rawRequest: SidebarActionRequest): Promise<SidebarActionResult> => {
      let validated: ValidatedAction;
      try {
        validated = validateRequest(rawRequest);
      } catch (error) {
        return failure(error);
      }

      if (pendingKeysRef.current.has(validated.key)) {
        return {
          ok: false,
          committed: false,
          pending: true,
          error: i18n.t("layout.sidebar.errors.actionPending"),
        };
      }

      const nextPendingKeys = addPendingSidebarAction(
        pendingKeysRef.current,
        validated.key,
      );
      pendingKeysRef.current = nextPendingKeys;
      setPendingKeys(nextPendingKeys);
      try {
        const outcome = await dispatchAction(
          validated.request,
          onPreferenceAction,
          onCallbackAction,
        );
        let refreshWarning: string | null = null;
        if (outcome.changed && validated.projectSlug) {
          try {
            await onProjectChanged(validated.projectSlug);
          } catch (error) {
            refreshWarning = i18n.t(
              "layout.sidebar.errors.committedRefreshWarning",
              { detail: failure(error).error },
            );
          }
        }
        const warnings = [
          outcome.committedWarning,
          refreshWarning,
        ].filter((warning): warning is string => Boolean(warning));
        if (warnings.length > 0) {
          return committedWarning(warnings.join(" "));
        }
        return { ok: true };
      } catch (error) {
        return failure(error);
      } finally {
        const remainingPendingKeys = removePendingSidebarAction(
          pendingKeysRef.current,
          validated.key,
        );
        pendingKeysRef.current = remainingPendingKeys;
        setPendingKeys(remainingPendingKeys);
      }
    },
    [onCallbackAction, onPreferenceAction, onProjectChanged],
  );

  return {
    pendingKey: pendingKeys.values().next().value ?? null,
    runAction,
  };
}

async function dispatchAction(
  request: SidebarActionRequest,
  onPreferenceAction: UseSidebarActionsOptions["onPreferenceAction"],
  onCallbackAction: UseSidebarActionsOptions["onCallbackAction"],
): Promise<DispatchOutcome> {
  switch (request.action) {
    case "rename-project":
      await updateProject(request.projectSlug, { name: request.name });
      return { changed: true };
    case "archive-project":
      await archiveProject(request.projectSlug);
      return { changed: true };
    case "restore-project":
      await restoreProject(request.projectSlug);
      return { changed: true };
    case "remove-project":
      if (!request.archived) {
        await archiveProject(request.projectSlug);
        try {
          await deleteProject(request.projectSlug);
        } catch (error) {
          return {
            changed: true,
            committedWarning: i18n.t(
              "layout.sidebar.errors.projectArchivedRemovalFailed",
              { detail: failure(error).error },
            ),
          };
        }
      } else {
        await deleteProject(request.projectSlug);
      }
      return { changed: true };
    case "rename-workspace":
      await updateWorkspaceDisplayName(request.projectSlug, request.path, request.name);
      return { changed: true };
    case "remove-workspace": {
      const results = await removeWorkspaces(request.projectSlug, [request.path]);
      const removed = results.filter((result) => result.status === "removed");
      if (removed.length === results.length && removed.length === 1) return { changed: true };
      const reason = results.find((result) => result.status !== "removed")?.reason;
      if (removed.length > 0) {
        return {
          changed: true,
          committedWarning:
            reason?.trim() ||
            i18n.t("layout.sidebar.errors.workspacePartiallyRemoved"),
        };
      }
      throw new Error(
        reason?.trim() || i18n.t("layout.sidebar.errors.workspaceRemoveFailed"),
      );
    }
    case "rename-thread":
      await updateAssistantThread(request.threadId, { title: request.title });
      return { changed: true };
    case "update-thread-metadata":
      await updateAssistantThread(request.threadId, {
        labels: request.labels,
        ...(request.needsReview === null
          ? {}
          : { needsReview: request.needsReview }),
      });
      return { changed: true };
    case "update-thread-review":
      await updateAssistantThread(request.threadId, {
        needsReview: request.needsReview,
      });
      return { changed: true };
    case "update-issue-thread-metadata":
      await updateIssue(request.projectSlug, request.identifier, {
        labelIds: request.labelIds,
      });
      try {
        await updateAssistantThread(request.threadId, {
          needsReview: request.needsReview,
        });
      } catch (error) {
        return {
          changed: true,
          committedWarning: i18n.t(
            "layout.sidebar.errors.issueLabelsReviewFailed",
            { detail: failure(error).error },
          ),
        };
      }
      return { changed: true };
    case "archive-thread":
      await archiveAssistantThread(request.threadId);
      return { changed: true };
    case "delete-thread":
      await deleteAssistantThread(request.threadId);
      return { changed: true };
    case "rename-issue":
      await updateIssue(request.projectSlug, request.identifier, { title: request.title });
      return { changed: true };
    case "update-issue-labels":
      await updateIssue(request.projectSlug, request.identifier, {
        labelIds: request.labelIds,
      });
      return { changed: true };
    case "archive-issue":
      await archiveIssue(request.projectSlug, request.identifier);
      return { changed: true };
    case "copy":
      if (!(await copyTextToClipboard(request.value))) {
        throw new Error(i18n.t("layout.sidebar.errors.clipboardFailed"));
      }
      return { changed: false };
    case "set-pinned":
    case "mark-read":
      await onPreferenceAction(request);
      return { changed: false };
    case "callback":
      await onCallbackAction({ callback: request.callback, value: request.value });
      return { changed: false };
  }
}

function validateRequest(value: unknown): ValidatedAction {
  const envelope = validateSidebarActionEnvelope(value, REQUEST_KEYS);
  const normalized = normalizeByAction(envelope.action, envelope.request);
  return {
    request: normalized,
    key: actionKey(normalized),
    projectSlug: "projectSlug" in normalized ? normalized.projectSlug : null,
  };
}

const REQUEST_KEYS: Readonly<Record<string, readonly string[]>> = {
  "rename-project": ["action", "projectSlug", "name"],
  "archive-project": ["action", "projectSlug"],
  "restore-project": ["action", "projectSlug"],
  "remove-project": ["action", "projectSlug", "archived", "canArchive"],
  "rename-workspace": ["action", "projectSlug", "path", "name", "workspaceKind"],
  "remove-workspace": ["action", "projectSlug", "path", "workspaceKind", "removable"],
  "rename-thread": ["action", "projectSlug", "threadId", "title"],
  "update-thread-metadata": [
    "action",
    "projectSlug",
    "threadId",
    "labels",
    "needsReview",
    "canReview",
  ],
  "update-thread-review": [
    "action",
    "projectSlug",
    "threadId",
    "needsReview",
    "canReview",
  ],
  "update-issue-thread-metadata": [
    "action",
    "projectSlug",
    "identifier",
    "labelIds",
    "threadId",
    "needsReview",
    "canReview",
  ],
  "archive-thread": ["action", "projectSlug", "threadId", "canArchive"],
  "delete-thread": [
    "action",
    "projectSlug",
    "threadId",
    "sessionKind",
    "local",
    "archived",
    "closed",
  ],
  "rename-issue": ["action", "projectSlug", "identifier", "title"],
  "update-issue-labels": ["action", "projectSlug", "identifier", "labelIds"],
  "archive-issue": ["action", "projectSlug", "identifier", "active"],
  copy: ["action", "value"],
  "set-pinned": ["action", "nodeKind", "nodeId", "pinned"],
  "mark-read": ["action", "sessionId", "readAt"],
  callback: ["action", "callback", "value"],
};

function normalizeByAction(
  action: string,
  value: Record<string, unknown>,
): SidebarActionRequest {
  const projectSlug = () => nonBlank(value.projectSlug, "projectSlug");
  const threadId = () => positiveInteger(value.threadId, "threadId");
  switch (action) {
    case "rename-project":
      return {
        action,
        projectSlug: projectSlug(),
        name: limited(value.name, "name", MAX_DISPLAY_NAME_GRAPHEMES),
      };
    case "archive-project":
    case "restore-project":
      return { action, projectSlug: projectSlug() };
    case "remove-project": {
      const archived = boolean(value.archived, "archived");
      const canArchive = boolean(value.canArchive, "canArchive");
      if (!archived && !canArchive) {
        throw new Error(i18n.t("layout.sidebar.errors.projectArchiveRequired"));
      }
      return { action, projectSlug: projectSlug(), archived, canArchive };
    }
    case "rename-workspace": {
      const workspaceKind = workspaceKindValue(value.workspaceKind);
      if (workspaceKind === "project") {
        throw new Error(i18n.t("layout.sidebar.errors.mainWorkspaceRename"));
      }
      return {
        action,
        projectSlug: projectSlug(),
        path: absolutePath(value.path),
        name: limited(value.name, "name", MAX_DISPLAY_NAME_GRAPHEMES),
        workspaceKind,
      };
    }
    case "remove-workspace": {
      const workspaceKind = workspaceKindValue(value.workspaceKind);
      if (workspaceKind === "project") {
        throw new Error(i18n.t("layout.sidebar.errors.mainWorkspaceRemove"));
      }
      if (!boolean(value.removable, "removable")) {
        throw new Error(i18n.t("layout.sidebar.errors.workspaceNotRemovable"));
      }
      return {
        action,
        projectSlug: projectSlug(),
        path: absolutePath(value.path),
        workspaceKind,
        removable: true,
      };
    }
    case "rename-thread":
      return {
        action,
        projectSlug: projectSlug(),
        threadId: threadId(),
        title: limited(value.title, "title", MAX_TITLE_GRAPHEMES),
      };
    case "update-thread-metadata":
      {
        const needsReview = nullableBoolean(value.needsReview, "needsReview");
        const canReview = boolean(value.canReview, "canReview");
        assertSidebarReviewAuthorization(canReview, needsReview);
        return {
        action,
        projectSlug: projectSlug(),
        threadId: threadId(),
        labels: normalizedStrings(
          value.labels,
          "labels",
          MAX_THREAD_LABELS,
          MAX_THREAD_LABEL_GRAPHEMES,
        ),
          needsReview,
          canReview,
        };
      }
    case "update-thread-review": {
      const canReview = boolean(value.canReview, "canReview");
      assertSidebarReviewAuthorization(canReview, true);
      return {
        action,
        projectSlug: projectSlug(),
        threadId: threadId(),
        needsReview: boolean(value.needsReview, "needsReview"),
        canReview,
      };
    }
    case "update-issue-thread-metadata": {
      const canReview = boolean(value.canReview, "canReview");
      assertSidebarReviewAuthorization(canReview, true);
      return {
        action,
        projectSlug: projectSlug(),
        identifier: nonBlank(value.identifier, "identifier"),
        labelIds: normalizedStrings(value.labelIds, "labelIds"),
        threadId: threadId(),
        needsReview: boolean(value.needsReview, "needsReview"),
        canReview,
      };
    }
    case "archive-thread": {
      const canArchive = boolean(value.canArchive, "canArchive");
      assertSidebarThreadArchiveAuthorization(canArchive);
      return { action, projectSlug: projectSlug(), threadId: threadId(), canArchive };
    }
    case "delete-thread": {
      const sessionKind = sessionKindValue(value.sessionKind);
      const local = boolean(value.local, "local");
      const archived = boolean(value.archived, "archived");
      const closed = boolean(value.closed, "closed");
      if (sessionKind === "execution") {
        throw new Error(i18n.t("layout.sidebar.errors.executionThreadDelete"));
      }
      if (!local) throw new Error(i18n.t("layout.sidebar.errors.localThreadDelete"));
      return {
        action,
        projectSlug: projectSlug(),
        threadId: threadId(),
        sessionKind,
        local,
        archived,
        closed,
      };
    }
    case "rename-issue":
      return {
        action,
        projectSlug: projectSlug(),
        identifier: nonBlank(value.identifier, "identifier"),
        title: limited(value.title, "title", MAX_TITLE_GRAPHEMES),
      };
    case "update-issue-labels":
      return {
        action,
        projectSlug: projectSlug(),
        identifier: nonBlank(value.identifier, "identifier"),
        labelIds: normalizedStrings(value.labelIds, "labelIds"),
      };
    case "archive-issue":
      if (boolean(value.active, "active")) {
        throw new Error(i18n.t("layout.sidebar.errors.activeExecutionArchive"));
      }
      return {
        action,
        projectSlug: projectSlug(),
        identifier: nonBlank(value.identifier, "identifier"),
        active: false,
      };
    case "copy":
      return { action, value: nonBlank(value.value, "value") };
    case "set-pinned":
      return {
        action,
        nodeKind: enumValue(value.nodeKind, "nodeKind", ["project", "workspace", "session"]),
        nodeId: nonBlank(value.nodeId, "nodeId"),
        pinned: boolean(value.pinned, "pinned"),
      };
    case "mark-read": {
      const readAt = nonBlank(value.readAt, "readAt");
      if (!Number.isFinite(Date.parse(readAt))) throw new Error("readAt must be an ISO timestamp.");
      return { action, sessionId: nonBlank(value.sessionId, "sessionId"), readAt };
    }
    case "callback":
      return {
        action,
        callback: enumValue(value.callback, "callback", [
          "navigate",
          "open-editor",
          "open-terminal",
        ]),
        value: nonBlank(value.value, "value"),
      };
    default:
      throw new Error(`Unsupported sidebar action "${action}".`);
  }
}

function actionKey(request: SidebarActionRequest): string {
  switch (request.action) {
    case "rename-project":
    case "archive-project":
    case "restore-project":
    case "remove-project":
      return `${request.action}:${request.projectSlug}`;
    case "rename-workspace":
    case "remove-workspace":
      return `${request.action}:${request.projectSlug}:${request.path}`;
    case "rename-thread":
    case "update-thread-metadata":
    case "update-thread-review":
    case "archive-thread":
    case "delete-thread":
      return `${request.action}:${request.threadId}`;
    case "rename-issue":
    case "update-issue-labels":
    case "archive-issue":
      return `${request.action}:${request.projectSlug}:${request.identifier}`;
    case "update-issue-thread-metadata":
      return `${request.action}:${request.projectSlug}:${request.identifier}:${request.threadId}`;
    case "copy":
      return `copy:${sidebarCopyPendingFingerprint(request.value)}`;
    case "set-pinned":
      return `${request.action}:${request.nodeKind}:${request.nodeId}`;
    case "mark-read":
      return `${request.action}:${request.sessionId}`;
    case "callback":
      return `${request.action}:${request.callback}:${request.value}`;
  }
}

function normalizedStrings(
  value: unknown,
  field: string,
  maxCount = Number.MAX_SAFE_INTEGER,
  maxGraphemes = Number.MAX_SAFE_INTEGER,
): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${field} must be an array of strings.`);
  }
  const normalized = [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  if (normalized.length > maxCount) throw new Error(`${field} must contain at most ${maxCount} entries.`);
  if (normalized.some((item) => graphemeCount(item) > maxGraphemes)) {
    throw new Error(`${field} entries must not exceed ${maxGraphemes} graphemes.`);
  }
  return normalized;
}

function nonBlank(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be nonblank.`);
  return value.trim();
}

function limited(value: unknown, field: string, maximum: number): string {
  const normalized = nonBlank(value, field);
  if (graphemeCount(normalized) > maximum) {
    throw new Error(`${field} must not exceed ${maximum} graphemes.`);
  }
  return normalized;
}

function absolutePath(value: unknown): string {
  const path = nonBlank(value, "path");
  if (path.includes("\0")) throw new Error("path must not contain a NUL character.");
  if (!path.startsWith("/")) throw new Error("path must be an absolute path.");
  return path;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value as number;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean.`);
  return value;
}

function nullableBoolean(value: unknown, field: string): boolean | null {
  if (value === null) return null;
  return boolean(value, field);
}

function enumValue<const T extends string>(
  value: unknown,
  field: string,
  choices: readonly T[],
): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new Error(`${field} is unsupported.`);
  }
  return value as T;
}

function workspaceKindValue(value: unknown): SidebarWorkspaceKind {
  return enumValue(value, "workspaceKind", [
    "project",
    "issue",
    "standalone",
    "parallel",
    "orphan",
  ]);
}

function sessionKindValue(value: unknown): SidebarSessionKind {
  return enumValue(value, "sessionKind", ["chat", "authoring", "execution"]);
}

function failure(error: unknown): {
  ok: false;
  committed: false;
  error: string;
} {
  return {
    ok: false,
    committed: false,
    error:
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Sidebar action failed.",
  };
}

function committedWarning(warning: string): SidebarActionResult {
  return { ok: false, committed: true, warning };
}
