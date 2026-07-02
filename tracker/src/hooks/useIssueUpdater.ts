import { useCallback, useState } from "react";
import { toast } from "sonner";

import { i18n } from "@/i18n";
import { moveIssue, updateIssue } from "@/services/issues";
import type { Issue, UpdateIssueInput } from "@/types/issue";
import type { WorkflowStatusName } from "@/types/workflow-status";

interface UseIssueUpdaterArgs {
  projectSlug: string;
  issue: Issue | null;
  onUpdated?: (issue: Issue) => void;
}

export function useIssueUpdater({ projectSlug, issue, onUpdated }: UseIssueUpdaterArgs) {
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (input: UpdateIssueInput) => {
      if (!issue || !projectSlug.trim() || !issue.identifier.trim()) return null;
      setSaving(true);
      try {
        const updated = await updateIssue(projectSlug, issue.identifier, input);
        onUpdated?.(updated);
        return updated;
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : i18n.t("issue.updater.saveFailed"));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [issue, onUpdated, projectSlug],
  );

  const moveStatus = useCallback(
    async (status: WorkflowStatusName) => {
      if (!issue || !projectSlug.trim() || !issue.identifier.trim()) return null;
      if (status === issue.status) return issue;
      setSaving(true);
      try {
        const updated = await moveIssue(projectSlug, issue.identifier, {
          status,
          position: issue.position,
        });
        onUpdated?.(updated);
        return updated;
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : i18n.t("issue.updater.statusFailed"));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [issue, onUpdated, projectSlug],
  );

  return { save, moveStatus, saving };
}
