import { ChevronRight, FileText } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { kbPagePath } from "@/lib/kbRoutes";
import { cn } from "@/lib/utils";
import type { KbTreeNode as KbTreeNodeType } from "@/types/knowledgeBase";

interface Props {
  projectSlug: string;
  repoSlug: string;
  node: KbTreeNodeType;
  depth: number;
}

export function KbTreeNode({ projectSlug, repoSlug, node, depth }: Props) {
  const [open, setOpen] = useState(true);
  const indent = depth * 12 + 8;

  if (node.type === "folder") {
    return (
      <div>
        <button
          type="button"
          className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
          style={{ paddingLeft: indent }}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
          {node.title || node.name}
        </button>
        {open &&
          node.children.map((child) => (
            <KbTreeNode
              key={child.path}
              projectSlug={projectSlug}
              repoSlug={repoSlug}
              node={child}
              depth={depth + 1}
            />
          ))}
      </div>
    );
  }

  return (
    <NavLink
      to={kbPagePath(projectSlug, repoSlug, node.path)}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent",
          isActive && "bg-accent font-medium text-foreground",
        )
      }
      style={{ paddingLeft: indent }}
    >
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{node.title || node.name}</span>
    </NavLink>
  );
}
