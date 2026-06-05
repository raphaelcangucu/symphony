import { useCallback, useState } from "react";
import { toast } from "sonner";

import { updateIssue } from "@/services/issues";
import type { Issue, UpdateIssueInput } from "@/types/issue";

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
        toast.error(cause instanceof Error ? cause.message : "Failed to save changes");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [issue, onUpdated, projectSlug],
  );

  return { save, saving };
}
