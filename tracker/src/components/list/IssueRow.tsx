import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { issueDisplayIdentifier } from "@/lib/issueIdentifiers";
import { formatDateTime } from "@/lib/utils";
import type { Issue } from "@/types/issue";

interface IssueRowProps {
  issue: Issue;
  onSelect: (issue: Issue) => void;
}

export function IssueRow({ issue, onSelect }: IssueRowProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className="grid w-full grid-cols-[7rem_1fr_8rem_8rem] items-center gap-4 border-b px-4 py-3 text-left text-sm hover:bg-muted/40"
      onClick={() => onSelect(issue)}
    >
      <span className="font-mono text-xs text-muted-foreground">{issueDisplayIdentifier(issue)}</span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{issue.title}</span>
        <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          {issue.blockedBy.length > 0 ? <AlertTriangle className="h-3 w-3 text-amber-600" /> : null}
          {issue.labels.slice(0, 3).map((label) => (
            <Badge key={label} variant="muted" className="max-w-[9rem] truncate px-1.5 py-0 text-[10px]" title={label}>
              {label}
            </Badge>
          ))}
        </span>
      </span>
      <Badge variant="outline" className="w-fit justify-self-start">
        {issue.status}
      </Badge>
      <span className="text-xs text-muted-foreground">{formatDateTime(issue.updatedAt)}</span>
      <Button tabIndex={-1} variant="ghost" size="sm" className="sr-only">
        {t("board.list.open")}
      </Button>
    </button>
  );
}
