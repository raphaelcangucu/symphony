import type { ReactNode } from "react";
import { ExternalLink, NotebookPen } from "lucide-react";

import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { Markdown } from "@/components/ui/markdown";
import { cn, formatDateTime } from "@/lib/utils";

interface CommentCardProps {
  author: string | null;
  body: string;
  createdAt?: string | null;
  url?: string | null;
  badge?: ReactNode;
  highlight?: boolean;
  actions?: ReactNode;
}

export function CommentCard({ author, body, createdAt, url, badge, highlight, actions }: CommentCardProps) {
  return (
    <article className="overflow-hidden rounded-lg border">
      <header
        className={cn(
          "flex items-center gap-2 border-b px-3 py-2 text-xs",
          highlight ? "bg-primary/5" : "bg-muted/40",
        )}
      >
        <AssigneeAvatar login={author} />
        <span className="font-medium text-foreground">{author || "Unknown"}</span>
        {badge}
        <span className="text-muted-foreground">
          commented{createdAt ? ` · ${formatDateTime(createdAt)}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {actions}
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-muted-foreground transition-colors hover:text-foreground"
              title="Open on GitHub"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      </header>
      <div className="px-3 py-3">
        {body.trim() ? (
          <Markdown>{body}</Markdown>
        ) : (
          <p className="text-sm text-muted-foreground">Empty comment.</p>
        )}
      </div>
    </article>
  );
}

const SYNC_BADGE_STYLES: Record<string, string> = {
  pending:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  conflict:
    "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200",
  error: "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
};

const SYNC_BADGE_LABELS: Record<string, string> = {
  pending: "Syncing…",
  conflict: "Sync conflict",
  error: "Sync failed",
};

export function SyncBadge({ syncStatus }: { syncStatus: string | null }) {
  if (!syncStatus || syncStatus === "synced" || syncStatus === "archived") return null;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
        SYNC_BADGE_STYLES[syncStatus] ?? SYNC_BADGE_STYLES.error,
      )}
    >
      {SYNC_BADGE_LABELS[syncStatus] ?? "Sync failed"}
    </span>
  );
}

export function WorkpadBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">
      <NotebookPen className="h-3 w-3" />
      Workpad
    </span>
  );
}

export function ReviewBadge({ state }: { state: string }) {
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {state.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}
