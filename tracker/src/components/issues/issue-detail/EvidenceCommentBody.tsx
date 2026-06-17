import { ClipboardCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AttachmentImage } from "@/components/shared/AttachmentImage";
import { EvidenceStatusPill } from "@/components/issues/issue-detail/EvidenceStatusPill";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/ui/markdown";
import { evidenceImageLabel, parseEvidenceComment } from "@/lib/evidenceComment";
import { normalizeEvidenceArtifactUrl } from "@/lib/normalizeEvidenceArtifactUrl";

interface EvidenceCommentBodyProps {
  body: string;
}

export function EvidenceCommentBody({ body }: EvidenceCommentBodyProps) {
  const { t } = useTranslation();
  const parsed = parseEvidenceComment(body);

  if (!parsed) {
    return <Markdown>{body}</Markdown>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          {t("issue.evidence.tab.title")}
        </span>
        <EvidenceStatusPill status={parsed.overallStatus} />
        <span className="font-mono text-xs text-muted-foreground">{parsed.runId}</span>
        {parsed.uiChange ? <Badge variant="outline">{t("issue.evidence.tab.uiChange")}</Badge> : null}
      </div>

      {parsed.runs.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("issue.evidence.tab.columns.kind")}</th>
                <th className="px-3 py-2 font-medium">{t("issue.evidence.tab.columns.repo")}</th>
                <th className="px-3 py-2 font-medium">{t("issue.evidence.tab.columns.command")}</th>
                <th className="px-3 py-2 font-medium">{t("issue.evidence.tab.columns.status")}</th>
                <th className="px-3 py-2 font-medium">{t("issue.evidence.tab.columns.summary")}</th>
              </tr>
            </thead>
            <tbody>
              {parsed.runs.map((run, index) => (
                <tr className="border-t" key={`${run.kind}-${run.repo}-${index}`}>
                  <td className="px-3 py-2 font-medium">{run.kind}</td>
                  <td className="px-3 py-2">{run.repo}</td>
                  <td className="px-3 py-2">
                    <code className="block max-w-xs truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                      {run.command}
                    </code>
                  </td>
                  <td className="px-3 py-2">
                    <EvidenceStatusPill status={run.status} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{run.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {parsed.imageUrls.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("issue.evidence.tab.screenshots")}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {parsed.imageUrls.map((url) => {
              const label = evidenceImageLabel(url);
              return (
                <AttachmentImage
                  key={url}
                  alt={label}
                  layout="thumbnail"
                  showCaption
                  src={normalizeEvidenceArtifactUrl(url)}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {t("issue.comments.card.evidenceArtifactsHint")}
      </p>
    </div>
  );
}
