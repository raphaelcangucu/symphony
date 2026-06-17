import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBlocker, listBlockers } from "@/services/blockers";
import type { Blocker } from "@/types/blocker";
import type { Issue } from "@/types/issue";

interface BlockersTabProps {
  projectSlug: string;
  issue: Issue;
}

export function BlockersTab({ projectSlug, issue }: BlockersTabProps) {
  const { t } = useTranslation();
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [blockingIssueIdentifier, setBlockingIssueIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listBlockers(projectSlug, issue.identifier).then((items) => {
      if (active) setBlockers(items);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [issue.identifier, projectSlug]);

  async function addBlocker() {
    setError(null);

    try {
      const blocker = await createBlocker(projectSlug, issue.identifier, { blockingIssueIdentifier });
      setBlockers((current) => [blocker, ...current.filter((item) => item.id !== blocker.id)]);
      setBlockingIssueIdentifier("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("issue.blockers.addFailed"));
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-3">
        <div className="mb-2 text-sm font-medium">{t("issue.blockers.addTitle")}</div>
        <div className="flex gap-2">
          <Input
            aria-label={t("issue.blockers.blockingAria")}
            onChange={(event) => setBlockingIssueIdentifier(event.target.value)}
            placeholder={t("issue.blockers.identifierPlaceholder")}
            value={blockingIssueIdentifier}
          />
          <Button onClick={addBlocker} type="button">
            {t("issue.blockers.add")}
          </Button>
        </div>
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      </div>

      {issue.blockedBy.length > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
            {t("issue.blockers.blockedBy")}
          </div>
          <div className="flex flex-wrap gap-2">
            {issue.blockedBy.map((blocker) => <Badge key={blocker.id} variant="secondary">{blocker.identifier}</Badge>)}
          </div>
        </div>
      ) : null}
      {blockers.length === 0 ? <p className="text-sm text-muted-foreground">{t("issue.blockers.empty")}</p> : null}
      {blockers.map((blocker) => (
        <article key={blocker.id} className="rounded-lg border p-3 text-sm">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-medium">{blocker.blockingIssueIdentifier || t("issue.blockers.externalBlocker")}</span>
            <Badge variant={blocker.state === "open" ? "secondary" : "muted"}>{blocker.state}</Badge>
          </div>
          <p className="text-muted-foreground">{blocker.reason}</p>
        </article>
      ))}
    </div>
  );
}
