import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, FileText, Folder, GripVertical, Image, Star } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router-dom";

import { assetBaseName } from "@/lib/kbAssets";
import { parentPathOf } from "@/lib/kbTreeUtils";
import { cn } from "@/lib/utils";
import type { KbTreeNode as KbTreeNodeType } from "@/types/knowledgeBase";
import { draftMatchesList, type KbInlineEdit, renameMatches } from "@/types/kbPageDraft";

import { KbAddNodeButton } from "./KbAddNodeButton";
import { KbInlineNameInput } from "./KbInlineNameInput";
import { KbNodeActionsMenu } from "./KbNodeActionsMenu";
import type { KbTreeHandlers } from "./KbTreeList";
import { KbTreeList } from "./KbTreeList";

interface Props {
  projectSlug: string;
  repoSlug: string;
  node: KbTreeNodeType;
  depth: number;
  activePath: string | null;
  handlers: KbTreeHandlers;
  inlineEdit: KbInlineEdit;
  /** Builds the route for a page/asset so the tree works in both KB scopes. */
  pageHref: (repoSlug: string, pagePath: string) => string;
  /** Optional in-place selection for embedded KB surfaces that should not route away. */
  onSelectPath?: (repoSlug: string, pagePath: string) => void;
}

export function KbTreeNode({
  projectSlug,
  repoSlug,
  node,
  depth,
  activePath,
  handlers,
  inlineEdit,
  pageHref,
  onSelectPath,
}: Props) {
  const [open, setOpen] = useState(true);
  const indent = depth * 12 + 4;
  const folderHasDraft = draftMatchesList(inlineEdit.draft, repoSlug, node.path);

  if (node.type === "folder") {
    return (
      <div>
        <div
          className="group/kb-row flex min-w-0 items-center rounded-md hover:bg-accent/50"
          style={{ paddingLeft: indent }}
        >
          <button
            type="button"
            className="flex h-6 w-5 shrink-0 items-center justify-center text-muted-foreground"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
          </button>
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <button
            type="button"
            className="min-w-0 flex-1 truncate px-1 py-1 text-left text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setOpen((value) => !value)}
          >
            {node.title || node.name}
          </button>
          <KbAddNodeButton
            onAddPage={() => handlers.onStartAddPage(repoSlug, node.path, null)}
            onCreateFolder={() => handlers.onCreateFolder(repoSlug, node.path)}
          />
          <KbNodeActionsMenu
            title={node.title || node.name}
            variant="folder"
            onCreateFolder={() => handlers.onCreateFolder(repoSlug, node.path)}
            onAddPage={() => handlers.onStartAddPage(repoSlug, node.path, null)}
            onDelete={() => handlers.onDelete(repoSlug, node.path, node.title || node.name, "folder")}
          />
        </div>
        {open ? (
          node.children.length > 0 || folderHasDraft ? (
            <KbTreeList
              projectSlug={projectSlug}
              repoSlug={repoSlug}
              nodes={node.children}
              parentPath={node.path}
              depth={depth + 1}
              activePath={activePath}
              handlers={handlers}
              inlineEdit={inlineEdit}
              pageHref={pageHref}
              onSelectPath={onSelectPath}
            />
          ) : (
            <p
              className="py-0.5 text-[11px] text-muted-foreground/70"
              style={{ paddingLeft: indent + 28 }}
            >
              —
            </p>
          )
        ) : null}
      </div>
    );
  }

  if (node.type === "asset") {
    return (
      <KbTreeAssetRow
        repoSlug={repoSlug}
        node={node}
        depth={depth}
        activePath={activePath}
        handlers={handlers}
        inlineEdit={inlineEdit}
        pageHref={pageHref}
        onSelectPath={onSelectPath}
      />
    );
  }

  return (
    <KbTreePageRow
      repoSlug={repoSlug}
      node={node}
      depth={depth}
      activePath={activePath}
      handlers={handlers}
      inlineEdit={inlineEdit}
      pageHref={pageHref}
      onSelectPath={onSelectPath}
    />
  );
}

function KbTreeAssetRow({
  repoSlug,
  node,
  depth,
  activePath,
  handlers,
  inlineEdit,
  pageHref,
  onSelectPath,
}: Pick<Props, "repoSlug" | "node" | "depth" | "activePath" | "handlers" | "inlineEdit" | "pageHref" | "onSelectPath">) {
  const indent = depth * 12 + 4;
  const startRename = () => handlers.onRename(repoSlug, node.path, assetBaseName(node.path));

  if (renameMatches(inlineEdit.rename, repoSlug, node.path)) {
    return (
      <KbInlineNameInput
        depth={depth}
        kind="asset"
        initialValue={assetBaseName(node.path)}
        onSubmit={inlineEdit.onRenameSubmit}
        onCancel={inlineEdit.onCancel}
      />
    );
  }

  return (
    <div
      className={cn(
        "group/kb-row flex min-w-0 items-center rounded-md hover:bg-accent/50",
        activePath === node.path && "bg-accent/30",
      )}
      style={{ paddingLeft: indent + 20 }}
    >
      <NavLink
        to={pageHref(repoSlug, node.path)}
        className={({ isActive }) =>
          cn(
            "flex min-w-0 flex-1 items-center gap-1.5 py-1 text-sm",
            isActive || activePath === node.path
              ? "font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )
        }
        title={node.path}
        onClick={(event) => {
          if (!onSelectPath) return;
          event.preventDefault();
          onSelectPath(repoSlug, node.path);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          startRename();
        }}
      >
        <Image className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{node.title || node.name}</span>
      </NavLink>
      <KbNodeActionsMenu
        title={node.title || node.name}
        variant="asset"
        onRename={startRename}
        onDelete={() => handlers.onDelete(repoSlug, node.path, assetBaseName(node.path), "asset")}
      />
    </div>
  );
}

function KbTreePageRow({
  repoSlug,
  node,
  depth,
  activePath,
  handlers,
  inlineEdit,
  pageHref,
  onSelectPath,
}: Pick<Props, "repoSlug" | "node" | "depth" | "activePath" | "handlers" | "inlineEdit" | "pageHref" | "onSelectPath">) {
  const indent = depth * 12 + 4;
  const parentPath = parentPathOf(node.path);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.path,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    paddingLeft: indent,
  } satisfies React.CSSProperties;

  if (renameMatches(inlineEdit.rename, repoSlug, node.path)) {
    return (
      <KbInlineNameInput
        depth={depth}
        initialValue={node.title || node.name}
        onSubmit={inlineEdit.onRenameSubmit}
        onCancel={inlineEdit.onCancel}
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("group/kb-row flex min-w-0 items-center rounded-md hover:bg-accent/50", isDragging && "opacity-50")}
    >
      <button
        type="button"
        className="flex h-6 w-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground/40 opacity-0 active:cursor-grabbing group-hover/kb-row:opacity-100"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
        onClick={(event) => event.preventDefault()}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <NavLink
        to={pageHref(repoSlug, node.path)}
        className={({ isActive }) =>
          cn(
            "flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-sm",
            isActive || activePath === node.path
              ? "font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )
        }
        onDoubleClick={(event) => {
          event.preventDefault();
          handlers.onRename(repoSlug, node.path, node.title || node.name);
        }}
        onClick={(event) => {
          if (!onSelectPath) return;
          event.preventDefault();
          onSelectPath(repoSlug, node.path);
        }}
      >
        {node.favorite ? (
          <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">{node.title || node.name}</span>
      </NavLink>
      <KbAddNodeButton
        onAddPage={() => handlers.onStartAddPage(repoSlug, parentPath, node.path)}
        onCreateFolder={() => handlers.onCreateFolder(repoSlug, parentPath)}
      />
      <KbNodeActionsMenu
        title={node.title || node.name}
        favorite={node.favorite}
        variant="page"
        onRename={() => handlers.onRename(repoSlug, node.path, node.title || node.name)}
        onToggleFavorite={() => handlers.onToggleFavorite(repoSlug, node.path, node.favorite)}
        onDelete={() => handlers.onDelete(repoSlug, node.path, node.title || node.name, "page")}
        onCreateFolder={() => handlers.onCreateFolder(repoSlug, parentPath)}
        onAddPage={() => handlers.onStartAddPage(repoSlug, parentPath, node.path)}
      />
    </div>
  );
}
