import { FolderPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createStandaloneWorkspace } from "@/services/worktrees";
import type { WorkspaceRepoState } from "@/types/worktrees";

interface NewStandaloneWorkspaceDialogProps {
  projectSlug: string;
  /** Repos of the shared project workspace, used to offer per-repo branch overrides. */
  projectRepos: WorkspaceRepoState[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (workspacePath: string, threadId: number) => void;
}

export function NewStandaloneWorkspaceDialog({
  projectSlug,
  projectRepos,
  open,
  onOpenChange,
  onCreated,
}: NewStandaloneWorkspaceDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setBranches({});
    setCreating(false);
  }, [open]);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const overrides = Object.fromEntries(
        Object.entries(branches).filter(([, branch]) => branch.trim() !== ""),
      );
      const result = await createStandaloneWorkspace(projectSlug, {
        name: trimmed,
        branches: Object.keys(overrides).length > 0 ? overrides : undefined,
      });
      toast.success(t("workspacesPage.newWorkspace.created", { name: trimmed }));
      onOpenChange(false);
      onCreated(result.workspacePath, result.thread.id);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("workspacesPage.newWorkspace.failed"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("workspacesPage.newWorkspace.title")}</DialogTitle>
          <DialogDescription>{t("workspacesPage.newWorkspace.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="standalone-workspace-name" className="text-sm font-medium text-foreground">
              {t("workspacesPage.newWorkspace.nameLabel")}
            </label>
            <Input
              id="standalone-workspace-name"
              value={name}
              placeholder={t("workspacesPage.newWorkspace.namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleCreate();
              }}
            />
          </div>

          {projectRepos.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">{t("workspacesPage.newWorkspace.branchesLabel")}</p>
              <div className="space-y-1.5">
                {projectRepos.map((repo) => (
                  <div key={repo.name} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">{repo.name}</span>
                    <Input
                      value={branches[repo.name] ?? ""}
                      placeholder={repo.defaultBranch ?? t("workspacesPage.newWorkspace.branchPlaceholder")}
                      className="h-8 text-xs"
                      onChange={(event) =>
                        setBranches((current) => ({ ...current, [repo.name]: event.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={creating}>
              {t("workspacesPage.cleanup.cancel")}
            </Button>
          </DialogClose>
          <Button type="button" disabled={creating || name.trim() === ""} onClick={() => void handleCreate()}>
            <FolderPlus className="h-4 w-4" />
            {creating ? t("workspacesPage.newWorkspace.creating") : t("workspacesPage.newWorkspace.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
