import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Fragment } from "react";

import { sortablePageIds } from "@/lib/kbTreeUtils";
import type { KbTreeNode as KbTreeNodeType } from "@/types/knowledgeBase";
import { draftMatchesList, type KbInlineEdit } from "@/types/kbPageDraft";

import { KbInlineNameInput } from "./KbInlineNameInput";
import { KbTreeNode } from "./KbTreeNode";

export type KbDeleteKind = "page" | "asset" | "folder";

export interface KbTreeHandlers {
  onReorder: (repoSlug: string, parentPath: string, activePath: string, overPath: string) => void;
  onRename: (repoSlug: string, path: string, title: string) => void;
  onToggleFavorite: (repoSlug: string, path: string, favorite: boolean) => void;
  onDelete: (repoSlug: string, path: string, title: string, kind: KbDeleteKind) => void;
  onCreateFolder: (repoSlug: string, parentPath: string) => void;
  onStartAddPage: (repoSlug: string, parentPath: string, insertAfterPath?: string | null) => void;
}

interface Props {
  projectSlug: string;
  repoSlug: string;
  nodes: KbTreeNodeType[];
  parentPath?: string;
  depth?: number;
  activePath: string | null;
  handlers: KbTreeHandlers;
  inlineEdit: KbInlineEdit;
  /** Builds the route for a page/asset so the tree works in both KB scopes. */
  pageHref: (repoSlug: string, pagePath: string) => string;
  /** Optional in-place selection for embedded KB surfaces that should not route away. */
  onSelectPath?: (repoSlug: string, pagePath: string) => void;
}

export function KbTreeList({
  projectSlug,
  repoSlug,
  nodes,
  parentPath = "",
  depth = 0,
  activePath,
  handlers,
  inlineEdit,
  pageHref,
  onSelectPath,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const sortableIds = sortablePageIds(nodes);
  const listDraft = draftMatchesList(inlineEdit.draft, repoSlug, parentPath) ? inlineEdit.draft : null;
  const draftAtStart = listDraft?.insertAfterPath === null;

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    handlers.onReorder(repoSlug, parentPath, String(active.id), String(over.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        {draftAtStart ? (
          <KbInlineNameInput
            depth={depth}
            kind={listDraft.kind}
            onSubmit={inlineEdit.onDraftSubmit}
            onCancel={inlineEdit.onCancel}
          />
        ) : null}
        {nodes.map((node) => (
          <Fragment key={node.path}>
            <KbTreeNode
              projectSlug={projectSlug}
              repoSlug={repoSlug}
              node={node}
              depth={depth}
              activePath={activePath}
              handlers={handlers}
              inlineEdit={inlineEdit}
              pageHref={pageHref}
              onSelectPath={onSelectPath}
            />
            {listDraft?.insertAfterPath === node.path ? (
              <KbInlineNameInput
                depth={depth}
                kind={listDraft.kind}
                onSubmit={inlineEdit.onDraftSubmit}
                onCancel={inlineEdit.onCancel}
              />
            ) : null}
          </Fragment>
        ))}
      </SortableContext>
    </DndContext>
  );
}
