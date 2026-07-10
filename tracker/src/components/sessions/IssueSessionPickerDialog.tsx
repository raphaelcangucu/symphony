import { CircleDot } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getStatusMeta } from "@/components/board/status-meta";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  StartIssueSessionDialog,
  type StartIssueSessionDialogIssue,
} from "@/components/sessions/StartIssueSessionDialog";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { filterLauncherItems } from "@/components/launcher/launcherSources";
import { cn } from "@/lib/utils";
import { listIssues } from "@/services/issues";
import type { Issue } from "@/types/issue";

interface IssueSessionPickerDialogProps {
  projectSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function issueSearchTokens(issue: Issue): string[] {
  const tokens = [issue.identifier, issue.title];
  const numeric = issue.identifier.match(/(\d+)$/)?.[1];
  if (numeric) tokens.push(numeric);
  return tokens;
}

function toStartIssue(issue: Issue): StartIssueSessionDialogIssue {
  return {
    identifier: issue.identifier,
    title: issue.title,
    agentKind: issue.agentKind ?? null,
    parentIdentifier: issue.parentIdentifier ?? null,
  };
}

export function IssueSessionPickerDialog({
  projectSlug,
  open,
  onOpenChange,
}: IssueSessionPickerDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<StartIssueSessionDialogIssue | null>(null);
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 200);

  useEffect(() => {
    if (!open || !projectSlug.trim()) {
      setQuery("");
      return;
    }

    let active = true;
    setLoading(true);

    void listIssues(projectSlug, { search: debouncedQuery.trim() || undefined })
      .then((loaded) => {
        if (active) setIssues(loaded);
      })
      .catch(() => {
        if (active) setIssues([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [debouncedQuery, open, projectSlug]);

  const visible = useMemo(() => {
    const items = issues.map((issue) => ({
      kind: "issues" as const,
      id: issue.identifier,
      title: issue.title,
      issueIdentifier: issue.identifier,
      searchTokens: issueSearchTokens(issue),
    }));
    return filterLauncherItems(items, query).slice(0, 50);
  }, [issues, query]);

  const close = useCallback(() => {
    onOpenChange(false);
    setQuery("");
  }, [onOpenChange]);

  const handleSelect = useCallback(
    (issue: Issue) => {
      close();
      setSelectedIssue(toStartIssue(issue));
      setStartDialogOpen(true);
    },
    [close],
  );

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={(next) => (next ? onOpenChange(true) : close())}
        label={t("issueSessionPicker.title")}
        description={t("issueSessionPicker.description")}
        shouldFilter={false}
        size="default"
      >
        <div className="border-b px-4 pb-3 pt-4">
          <h2 className="text-base font-semibold leading-none">{t("issueSessionPicker.title")}</h2>
          <p className="mt-1.5 text-xs text-muted-foreground">{t("issueSessionPicker.description")}</p>
        </div>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("issueSessionPicker.placeholder")}
        />
        <CommandList>
          <CommandEmpty>{loading ? t("issueSessionPicker.loading") : t("issueSessionPicker.empty")}</CommandEmpty>
          {visible.map((item) => {
            const issue = issues.find((entry) => entry.identifier === item.issueIdentifier);
            if (!issue) return null;
            const meta = getStatusMeta(issue.status);
            const StatusIcon = meta.Icon;
            return (
              <CommandItem
                key={item.id}
                value={item.id}
                onSelect={() => handleSelect(issue)}
              >
                <CircleDot className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
                <StatusIcon className={cn("h-4 w-4 shrink-0", meta.iconClass)} aria-hidden />
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{issue.identifier}</span>
                <span className="min-w-0 flex-1 truncate">{issue.title}</span>
              </CommandItem>
            );
          })}
        </CommandList>
      </CommandDialog>

      <StartIssueSessionDialog
        projectSlug={projectSlug}
        issue={selectedIssue}
        open={startDialogOpen}
        onOpenChange={setStartDialogOpen}
        navigateToProjectSession
      />
    </>
  );
}
