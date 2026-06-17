import type { ReactNode } from "react";
import { ClipboardCheck, ExternalLink, NotebookPen } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { AssigneeAvatar } from "@/components/issues/AssigneeAvatar";
import { EvidenceCommentBody } from "@/components/issues/issue-detail/EvidenceCommentBody";
import { Markdown } from "@/components/ui/markdown";
import { i18n } from "@/i18n";
import { isEvidenceComment } from "@/lib/evidenceComment";
import { cn, formatDateTime } from "@/lib/utils";

interface CommentCardProps {
  author: string | null;
  body: string;
  createdAt?: string | null;
  url?: string | null;
  kind?: string | null;
  badge?: ReactNode;
  highlight?: boolean;
  actions?: ReactNode;
}

export function CommentCard({ author, body, createdAt, url, kind, badge, highlight, actions }: CommentCardProps) {
  const { t } = useTranslation();

  return (
    <article className="overflow-hidden rounded-lg border">
      <header
        className={cn(
          "flex items-center gap-2 border-b px-3 py-2 text-xs",
          highlight ? "bg-primary/5" : "bg-muted/40",
        )}
      >
        <AssigneeAvatar login={author} />
        <span className="font-medium text-foreground">{author || t("issue.comments.card.unknownAuthor")}</span>
        {badge}
        <span className="text-muted-foreground">
          {t("issue.comments.card.commented")}
          {createdAt ? ` · ${formatDateTime(createdAt)}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {actions}
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-muted-foreground transition-colors hover:text-foreground"
              title={t("issue.comments.card.openOnGitHub")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      </header>
      <div className="px-3 py-3">
        {body.trim() ? (
          isEvidenceComment(body, kind) ? (
            <EvidenceCommentBody body={body} />
          ) : (
            <Markdown>{body}</Markdown>
          )
        ) : (
          <p className="text-sm text-muted-foreground">{t("issue.comments.card.empty")}</p>
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

const SYNC_BADGE_KEYS: Record<string, string> = {
  pending: "issue.comments.card.sync.pending",
  conflict: "issue.comments.card.sync.conflict",
  error: "issue.comments.card.sync.error",
};

export function SyncBadge({
  syncStatus,
  t = i18n.t.bind(i18n) as TFunction,
}: {
  syncStatus: string | null;
  t?: TFunction;
}) {
  if (!syncStatus || syncStatus === "synced" || syncStatus === "archived") return null;

  const labelKey = SYNC_BADGE_KEYS[syncStatus] ?? SYNC_BADGE_KEYS.error;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
        SYNC_BADGE_STYLES[syncStatus] ?? SYNC_BADGE_STYLES.error,
      )}
    >
      {t(labelKey)}
    </span>
  );
}

export function WorkpadBadge() {
  const { t } = useTranslation();

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">
      <NotebookPen className="h-3 w-3" />
      {t("issue.comments.card.workpad")}
    </span>
  );
}

export function EvidenceBadge() {
  const { t } = useTranslation();

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/12 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
      <ClipboardCheck className="h-3 w-3" />
      {t("issue.comments.card.evidence")}
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
