import {
  Archive,
  Bookmark,
  BookmarkCheck,
  ClipboardCopy,
  Copy,
  ExternalLink,
  FileText,
  FolderKanban,
  FolderPlus,
  FolderTree,
  MessageSquarePlus,
  Pencil,
  Sparkles,
  Pin,
  PinOff,
  Settings,
  Tags,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  cloneElement,
  Fragment,
  type ComponentType,
  type KeyboardEvent,
  type MouseEvent,
  type SVGProps,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { SidebarConfirmDialog } from "@/components/layout/sidebar/SidebarConfirmDialog";
import { SidebarRenameDialog } from "@/components/layout/sidebar/SidebarRenameDialog";
import type { SidebarMenuTriggerElement } from "@/components/layout/sidebar/SidebarTreeRow";
import {
  SidebarSessionMetadataDialog,
  type SidebarSessionMetadataTarget,
} from "@/components/layout/sidebar/SidebarSessionMetadataDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  SidebarActionRequest,
  SidebarActionResult,
} from "@/hooks/useSidebarActions";
import {
  normalizeSidebarCapabilityContext,
  resolveSidebarCapabilities,
} from "@/lib/sidebarCapabilities";
import {
  sidebarArchiveRequest,
  sidebarRemoveIssueRequest,
  sidebarRenameRequest,
  SIDEBAR_ACTION_LABELS,
} from "@/lib/sidebarMenuPolicy";
import { cn } from "@/lib/utils";
import { getIssueFormOptions } from "@/services/issues";
import type { IssueFormOptions } from "@/types/issue";
import type {
  SidebarCapabilityContext,
  SidebarMenuAction,
  SidebarMenuActionId,
  SidebarNode,
} from "@/types/sidebar";

type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

const SIDEBAR_ACTION_ICONS: Readonly<Record<SidebarMenuActionId, LucideIcon>> = {
  "new-workspace": FolderPlus,
  "new-session": MessageSquarePlus,
  "open-board": FolderKanban,
  "open-docs": FileText,
  "open-settings": Settings,
  "open-editor": ExternalLink,
  "open-terminal": Terminal,
  pin: Pin,
  unpin: PinOff,
  rename: Pencil,
  "generate-title": Sparkles,
  "copy-branch": Copy,
  "copy-path": ClipboardCopy,
  "manage-labels": Tags,
  "toggle-review": Bookmark,
  "copy-resume-link": ClipboardCopy,
  archive: Archive,
  restore: FolderTree,
  remove: Trash2,
  "remove-workspace": Trash2,
  delete: Trash2,
};
type DialogState =
  | { type: "rename"; targetType: "project" | "workspace" | "thread" | "issue" }
  | { type: "metadata"; target: SidebarSessionMetadataTarget }
  | {
      type: "confirm";
      actionLabel: string;
      effectDescription: string;
      requireExactName: boolean;
      request: SidebarActionRequest;
    };

export interface SidebarContextMenuProps {
  node: SidebarNode;
  capabilityContext: SidebarCapabilityContext;
  children: SidebarMenuTriggerElement;
  onRunAction(request: SidebarActionRequest): Promise<SidebarActionResult>;
  onUtilityAction(action: "new-workspace" | "new-session", node: SidebarNode): void | Promise<void>;
  loadIssueFormOptions?(projectSlug: string): Promise<IssueFormOptions>;
  onCommittedWarning(warning: string): void;
}

export function SidebarContextMenu({
  node,
  capabilityContext,
  children,
  onRunAction,
  onUtilityAction,
  loadIssueFormOptions = getIssueFormOptions,
  onCommittedWarning,
}: SidebarContextMenuProps) {
  const { t } = useTranslation();
  const directErrorId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [directError, setDirectError] = useState<string | null>(null);
  const [pendingDirectAction, setPendingDirectAction] =
    useState<SidebarMenuActionId | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const ownerRef = useRef<HTMLElement | null>(null);
  const openingDialogRef = useRef(false);
  const normalizedContext = normalizeSidebarCapabilityContext(capabilityContext);
  const actions = resolveSidebarCapabilities(node, normalizedContext);
  const firstDestructiveIndex = actions.findIndex((action) => action.destructive);

  function restoreTriggerFocus() {
    const trigger = triggerRef.current;
    if (trigger?.isConnected) {
      trigger.focus();
      return;
    }
    if (ownerRef.current?.isConnected) ownerRef.current.focus();
  }

  function closeDialog() {
    setDialog(null);
    queueMicrotask(restoreTriggerFocus);
  }

  function openDialog(next: DialogState) {
    openingDialogRef.current = true;
    setDialog(next);
    setMenuOpen(false);
    queueMicrotask(() => {
      openingDialogRef.current = false;
    });
  }

  function handleMenuOpenChange(open: boolean) {
    setMenuOpen(open);
    if (open) {
      setDirectError(null);
      const trigger = triggerRef.current;
      const ownerId = trigger?.dataset.sidebarTreeOwnerId;
      const owner = trigger?.closest<HTMLElement>(
        '[role="treeitem"][data-sidebar-tree-row-id]',
      );
      ownerRef.current =
        ownerId === node.id && owner?.dataset.sidebarTreeRowId === ownerId ? owner : null;
    }
    if (!open && !openingDialogRef.current && dialog === null) {
      setDirectError(null);
      queueMicrotask(restoreTriggerFocus);
    }
  }

  async function runDirect(actionId: SidebarMenuActionId, request: SidebarActionRequest) {
    if (pendingDirectAction) return;
    setPendingDirectAction(actionId);
    setDirectError(null);
    try {
      const result = await onRunAction(request);
      if (!result.ok && result.committed === true) {
        onCommittedWarning?.(result.warning);
        setMenuOpen(false);
        queueMicrotask(restoreTriggerFocus);
        return;
      }
      if (!result.ok) {
        setDirectError(result.error);
        return;
      }
      setMenuOpen(false);
      queueMicrotask(restoreTriggerFocus);
    } catch (cause) {
      setDirectError(
        cause instanceof Error
          ? cause.message
          : t("layout.sidebar.errors.directActionFailed"),
      );
    } finally {
      setPendingDirectAction(null);
    }
  }

  async function runUtility(action: "new-workspace" | "new-session") {
    if (pendingDirectAction) return;
    setPendingDirectAction(action);
    setDirectError(null);
    try {
      await onUtilityAction(action, node);
      setMenuOpen(false);
      queueMicrotask(restoreTriggerFocus);
    } catch (cause) {
      setDirectError(
        cause instanceof Error
          ? cause.message
          : t("layout.sidebar.errors.directActionFailed"),
      );
    } finally {
      setPendingDirectAction(null);
    }
  }

  function selectAction(action: SidebarMenuAction) {
    if (!action.enabled) return;
    switch (action.id) {
      case "new-workspace":
      case "new-session":
        void runUtility(action.id);
        return;
      case "rename": {
        const targetType =
          node.kind === "project"
            ? "project"
            : node.kind === "workspace"
              ? "workspace"
              : node.kind === "session" && node.threadId !== null
                ? "thread"
                : node.issueIdentifier
                  ? "issue"
                  : "thread";
        openDialog({ type: "rename", targetType });
        return;
      }
      case "generate-title":
        if (node.kind === "session" && node.threadId !== null) {
          void runDirect(action.id, {
            action: "generate-thread-title",
            projectSlug: node.projectSlug,
            threadId: node.threadId,
          });
        }
        return;
      case "manage-labels":
        if (node.kind !== "session") return;
        openDialog({
          type: "metadata",
          target: node.issueIdentifier
            ? {
                kind: "issue",
                currentLabelNames: node.issueLabelNames,
                needsReview: node.needsReview,
                canReviewThread: node.threadId !== null,
                canReview: normalizedContext.threadCapabilities?.canReview === true,
                loadOptions: () => loadIssueFormOptions(node.projectSlug),
              }
            : {
                kind: "thread",
                labels: node.labels,
                needsReview: node.needsReview,
                canReview: normalizedContext.threadCapabilities?.canReview === true,
              },
        });
        return;
      case "archive": {
        const request = sidebarArchiveRequest(node, normalizedContext);
        if (!request) return;
        openDialog({
          type: "confirm",
          actionLabel: t("layout.sidebar.actions.archive"),
          effectDescription: t("layout.sidebar.actions.archiveEffect", {
            defaultValue:
              "Archive hides this item from active views. It can be restored later.",
          }),
          requireExactName: false,
          request,
        });
        return;
      }
      case "remove": {
        if (node.kind === "project") {
          openDialog({
            type: "confirm",
            actionLabel: t("layout.sidebar.actions.remove"),
            effectDescription: t("layout.sidebar.actions.removeProjectEffect", {
              defaultValue:
                "Permanently remove this project and its tracker data from the sidebar.",
            }),
            requireExactName: true,
            request: {
              action: "remove-project",
              projectSlug: node.projectSlug,
              archived: node.archived,
              canArchive: !node.archived,
            },
          });
          return;
        }
        const removeIssueRequest = sidebarRemoveIssueRequest(node);
        if (!removeIssueRequest) return;
        openDialog({
          type: "confirm",
          actionLabel: t("layout.sidebar.actions.remove"),
          effectDescription: t("layout.sidebar.actions.removeIssueEffect", {
            defaultValue:
              "Permanently remove this issue from the tracker. This cannot be undone.",
          }),
          requireExactName: true,
          request: removeIssueRequest,
        });
        return;
      }
      case "remove-workspace": {
        if (node.kind !== "workspace" || !normalizedContext.workspacePath) return;
        openDialog({
          type: "confirm",
          actionLabel: t("layout.sidebar.actions.remove-workspace"),
          effectDescription: t("layout.sidebar.actions.removeWorkspaceEffect", {
            defaultValue:
              "Remove this workspace and its files. The project and issue remain.",
          }),
          requireExactName: true,
          request: {
            action: "remove-workspace",
            projectSlug: node.projectSlug,
            path: normalizedContext.workspacePath,
            workspaceKind: node.workspaceKind,
            removable: normalizedContext.workspaceRemovable,
          },
        });
        return;
      }
      case "delete": {
        if (node.kind !== "session" || node.threadId === null) return;
        const thread = normalizedContext.threadCapabilities;
        if (!thread) return;
        openDialog({
          type: "confirm",
          actionLabel: t("layout.sidebar.actions.delete"),
          effectDescription: t("layout.sidebar.actions.deleteThreadEffect", {
            defaultValue: "Permanently delete this local thread and its history.",
          }),
          requireExactName: true,
          request: {
            action: "delete-thread",
            projectSlug: node.projectSlug,
            threadId: node.threadId,
            sessionKind: node.sessionKind,
            local: thread.local,
            archived: node.archived,
            closed: thread.closed,
          },
        });
        return;
      }
      case "restore":
        if (node.kind === "project") {
          void runDirect(action.id, {
            action: "restore-project",
            projectSlug: node.projectSlug,
          });
        }
        return;
      case "pin":
      case "unpin":
        void runDirect(action.id, {
          action: "set-pinned",
          nodeKind: node.kind,
          nodeId: node.id,
          pinned: action.id === "pin",
        });
        return;
      case "toggle-review":
        if (node.kind === "session" && node.threadId !== null) {
          void runDirect(action.id, {
            action: "update-thread-review",
            projectSlug: node.projectSlug,
            threadId: node.threadId,
            needsReview: !node.needsReview,
            canReview: normalizedContext.threadCapabilities?.canReview === true,
          });
        }
        return;
      case "copy-branch":
        if (normalizedContext.branchName) {
          void runDirect(action.id, { action: "copy", value: normalizedContext.branchName });
        }
        return;
      case "copy-path":
        if (normalizedContext.workspacePath) {
          void runDirect(action.id, { action: "copy", value: normalizedContext.workspacePath });
        }
        return;
      case "copy-resume-link":
        if (node.kind === "session" && node.issueIdentifier) {
          void runDirect(action.id, {
            action: "copy",
            value: `${node.href}${node.href.includes("?") ? "&" : "?"}resume=1`,
          });
        }
        return;
      case "open-editor":
        if (normalizedContext.editorTarget) {
          void runDirect(action.id, {
            action: "callback",
            callback: "open-editor",
            value: normalizedContext.editorTarget,
          });
        }
        return;
      case "open-terminal":
        if (normalizedContext.terminalTarget) {
          void runDirect(action.id, {
            action: "callback",
            callback: "open-terminal",
            value: normalizedContext.terminalTarget,
          });
        }
        return;
      case "open-board":
        void runDirect(action.id, {
          action: "callback",
          callback: "navigate",
          value: node.href,
        });
        return;
      case "open-docs":
        void runDirect(action.id, {
          action: "callback",
          callback: "navigate",
          value: `/projects/${encodeURIComponent(node.projectSlug)}/docs`,
        });
        return;
      case "open-settings":
        void runDirect(action.id, {
          action: "callback",
          callback: "navigate",
          value: `/projects/${encodeURIComponent(node.projectSlug)}/settings`,
        });
        return;
    }
  }

  const trigger = cloneElement(children, {
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      children.props.onKeyDown?.(event);
      if (!event.defaultPrevented && event.key === "F10" && event.shiftKey) {
        event.preventDefault();
        setMenuOpen(true);
      }
    },
    onContextMenu: (event: MouseEvent<HTMLButtonElement>) => {
      children.props.onContextMenu?.(event);
      if (!event.defaultPrevented) {
        event.preventDefault();
        setMenuOpen(true);
      }
    },
  });

  return (
    <>
      <DropdownMenu modal={false} open={menuOpen} onOpenChange={handleMenuOpenChange}>
        <DropdownMenuTrigger ref={triggerRef} asChild>
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          aria-describedby={directError ? directErrorId : undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!openingDialogRef.current && dialog === null) restoreTriggerFocus();
          }}
        >
          {actions.map((action, index) => (
            <Fragment key={action.id}>
              {index === firstDestructiveIndex ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                disabled={!action.enabled || pendingDirectAction !== null}
                aria-disabled={!action.enabled}
                title={
                  !action.enabled && action.disabledReason
                    ? t(action.disabledReason)
                    : undefined
                }
                aria-description={
                  !action.enabled && action.disabledReason
                    ? t(action.disabledReason)
                    : undefined
                }
                className={cn(
                  "gap-2",
                  action.destructive && "text-destructive focus:text-destructive",
                )}
                onSelect={(event) => {
                  event.preventDefault();
                  selectAction(action);
                }}
              >
                {renderActionIcon(action, node)}
                {action.id === "toggle-review" && node.kind === "session"
                  ? t(
                      node.needsReview
                        ? "layout.sidebar.actions.removeReviewMarker"
                        : "layout.sidebar.actions.markForReview",
                      {
                        defaultValue: node.needsReview
                          ? "Remove review marker"
                          : "Mark for review",
                      },
                    )
                  : t(`layout.sidebar.actions.${action.id}`, {
                      defaultValue: SIDEBAR_ACTION_LABELS[action.id],
                    })}
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {directError && menuOpen ? (
        <p
          id={directErrorId}
          role="alert"
          className="fixed bottom-4 right-4 z-[60] max-w-sm rounded border bg-background p-3 text-sm text-destructive shadow"
        >
          {directError}
        </p>
      ) : null}

      {dialog?.type === "rename" ? (
        <SidebarRenameDialog
          open
          targetType={dialog.targetType}
          targetName={node.title}
          maximumGraphemes={
            dialog.targetType === "project" || dialog.targetType === "workspace" ? 120 : 160
          }
          onOpenChange={(open) => !open && closeDialog()}
          onCommittedWarning={onCommittedWarning}
          onSubmit={(name) => {
            const request = sidebarRenameRequest(node, normalizedContext, name);
            return request
              ? onRunAction(request)
              : Promise.resolve({
                  ok: false,
                  committed: false,
                  error: t("layout.sidebar.errors.renameUnavailable"),
                });
          }}
        />
      ) : null}
      {dialog?.type === "metadata" ? (
        <SidebarSessionMetadataDialog
          open
          target={dialog.target}
          onOpenChange={(open) => !open && closeDialog()}
          onCommittedWarning={onCommittedWarning}
          onSubmit={async (value) => {
            if (node.kind !== "session") {
              return {
                ok: false,
                committed: false,
                error: t("layout.sidebar.errors.metadataUnavailable"),
              };
            }
            if (value.kind === "issue") {
              if (!node.issueIdentifier) {
                return {
                  ok: false,
                  committed: false,
                  error: t("layout.sidebar.errors.issueLabelsUnavailable"),
                };
              }
              return node.threadId === null
                || normalizedContext.threadCapabilities?.canReview !== true
                ? onRunAction({
                    action: "update-issue-labels",
                    projectSlug: node.projectSlug,
                    identifier: node.issueIdentifier,
                    labelIds: value.labelIds,
                  })
                : onRunAction({
                    action: "update-issue-thread-metadata",
                    projectSlug: node.projectSlug,
                    identifier: node.issueIdentifier,
                    labelIds: value.labelIds,
                    threadId: node.threadId,
                    needsReview: value.needsReview,
                    canReview: true,
                  });
            }
            if (node.threadId === null) {
              return {
                ok: false,
                committed: false,
                error: t("layout.sidebar.errors.metadataUnavailable"),
              };
            }
            return onRunAction({
              action: "update-thread-metadata",
              projectSlug: node.projectSlug,
              threadId: node.threadId,
              labels: value.labels,
              needsReview:
                normalizedContext.threadCapabilities?.canReview === true
                  ? value.needsReview
                  : null,
              canReview: normalizedContext.threadCapabilities?.canReview === true,
            });
          }}
        />
      ) : null}
      {dialog?.type === "confirm" ? (
        <SidebarConfirmDialog
          open
          actionLabel={dialog.actionLabel}
          targetName={node.title}
          effectDescription={dialog.effectDescription}
          requireExactName={dialog.requireExactName}
          onOpenChange={(open) => !open && closeDialog()}
          onConfirm={() => onRunAction(dialog.request)}
          onCommittedWarning={onCommittedWarning}
        />
      ) : null}
    </>
  );
}

function renderActionIcon(action: SidebarMenuAction, node: SidebarNode) {
  const Icon =
    action.id === "toggle-review" && node.kind === "session" && node.needsReview
      ? BookmarkCheck
      : SIDEBAR_ACTION_ICONS[action.id];
  return (
    <Icon
      className={cn(
        "h-4 w-4 shrink-0",
        action.destructive ? "text-destructive" : "text-muted-foreground",
      )}
      aria-hidden="true"
    />
  );
}
