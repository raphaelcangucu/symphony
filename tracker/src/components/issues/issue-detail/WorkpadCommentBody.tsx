import { ExternalLink, GitPullRequest, NotebookPen } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/ui/markdown";
import {
  parseWorkpadSections,
  stripSymphonyPrsBlock,
  workpadPullRequestLabel,
  type WorkpadPullRequest,
} from "@/lib/workpadComment";
import { cn } from "@/lib/utils";

interface WorkpadCommentBodyProps {
  body: string;
}

export function WorkpadCommentBody({ body }: WorkpadCommentBodyProps) {
  const { t } = useTranslation();
  const sections = parseWorkpadSections(body);
  const { displayBody, pullRequests } = stripSymphonyPrsBlock(body);

  return (
    <div className="space-y-4">
      {sections.length > 0 ? (
        <div className="space-y-3">
          {sections.map((section) => (
            <section className="rounded-lg border bg-muted/20" key={section.title}>
              <h4 className="border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </h4>
              <div className="px-3 py-3">
                {section.body.trim() ? (
                  <Markdown>{section.body}</Markdown>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("issue.comments.card.workpadSectionEmpty")}</p>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : displayBody.trim() ? (
        <Markdown>{displayBody}</Markdown>
      ) : (
        <p className="text-sm text-muted-foreground">{t("issue.comments.card.empty")}</p>
      )}

      {pullRequests.length > 0 ? <WorkpadPullRequestRegistry pullRequests={pullRequests} /> : null}
    </div>
  );
}

function WorkpadPullRequestRegistry({ pullRequests }: { pullRequests: WorkpadPullRequest[] }) {
  const { t } = useTranslation();

  return (
    <section className="rounded-lg border border-dashed bg-background/60">
      <header className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        <GitPullRequest className="h-3.5 w-3.5" />
        <span className="font-medium uppercase tracking-wide">{t("issue.comments.card.workpadPullRequests")}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          <NotebookPen className="h-3 w-3" />
          {t("issue.comments.card.workpadRegistryHint")}
        </span>
      </header>
      <ul className="divide-y">
        {pullRequests.map((pr, index) => (
          <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" key={`${pr.url ?? pr.number ?? index}`}>
            {pr.url ? (
              <a
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                href={pr.url}
                rel="noreferrer noopener"
                target="_blank"
              >
                {workpadPullRequestLabel(pr)}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <span className="font-medium">{workpadPullRequestLabel(pr)}</span>
            )}
            {pr.branch ? (
              <span className="font-mono text-[11px] text-muted-foreground">
                {pr.base ? `${pr.base} ← ${pr.branch}` : pr.branch}
              </span>
            ) : null}
            {pr.status ? <WorkpadPullRequestStatus status={pr.status} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

const STATUS_STYLES: Record<string, string> = {
  active: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  closed_superseded_unlinked:
    "border-muted-foreground/30 bg-muted text-muted-foreground dark:border-muted-foreground/40",
};

function WorkpadPullRequestStatus({ status }: { status: string }) {
  const { t } = useTranslation();
  const labelKey = `issue.comments.card.workpadPrStatus.${status}`;
  const label = t(labelKey, { defaultValue: status.replaceAll("_", " ") });

  return (
    <Badge className={cn("text-[10px] font-medium capitalize", STATUS_STYLES[status])} variant="outline">
      {label}
    </Badge>
  );
}
