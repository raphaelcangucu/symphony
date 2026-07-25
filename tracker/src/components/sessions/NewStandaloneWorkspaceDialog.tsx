import { FolderPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  ExecutionModeField,
  ExecutionSettingsFields,
} from "@/components/assistant/ExecutionSettingsFields";
import { WorkspaceCloneBranchesFields } from "@/components/sessions/WorkspaceCloneBranchesFields";
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
import {
  catalogFor,
  defaultComposerSettings,
  type AssistantCatalogBundle,
} from "@/lib/assistantSettings";
import { resolveCloneBranchApiPayload, type WorkspaceCloneRepoOption } from "@/lib/workspaceCloneRepos";
import { fetchAssistantCatalogBundle } from "@/services/assistant";
import { createStandaloneWorkspace } from "@/services/worktrees";
import type { AgentKind, ExecutionMode } from "@/types/issue";

const DEFAULT_MODE: ExecutionMode = "build";
const DEFAULT_AGENT: AgentKind = "codex";

interface NewStandaloneWorkspaceDialogProps {
  projectSlug: string;
  /** Repos for optional per-directory branch overrides at workspace creation. */
  cloneRepos?: WorkspaceCloneRepoOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (workspacePath: string, threadId: number) => void;
}

export function NewStandaloneWorkspaceDialog({
  projectSlug,
  cloneRepos = [],
  open,
  onOpenChange,
  onCreated,
}: NewStandaloneWorkspaceDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [agent, setAgent] = useState<AgentKind>(DEFAULT_AGENT);
  const [mode, setMode] = useState<ExecutionMode>(DEFAULT_MODE);
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [bundle, setBundle] = useState<AssistantCatalogBundle | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setBranches({});
    setAgent(DEFAULT_AGENT);
    setMode(DEFAULT_MODE);
    setModel(null);
    setEffort(null);
    setCreating(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBundle(null);
    void fetchAssistantCatalogBundle(projectSlug)
      .then((next) => {
        if (!cancelled) setBundle(next);
      })
      .catch(() => {
        if (!cancelled) setBundle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectSlug]);

  useEffect(() => {
    if (!open || !bundle) return;
    const defaults = defaultComposerSettings(catalogFor(bundle, agent));
    setModel((current) => current ?? defaults.model);
    setEffort((current) => current ?? defaults.effort);
  }, [open, bundle, agent]);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const payload = resolveCloneBranchApiPayload(branches);
      const result = await createStandaloneWorkspace(projectSlug, {
        name: trimmed,
        agentKind: agent,
        executionMode: mode,
        model: model?.trim() || undefined,
        effort: effort?.trim() || undefined,
        branches:
          payload.cloneBranches ??
          (payload.cloneBranch ? { __default__: payload.cloneBranch } : undefined),
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

          <div className="flex flex-wrap items-center gap-1.5">
            {bundle ? (
              <ExecutionSettingsFields
                bundle={bundle}
                agent={agent}
                model={model}
                effort={effort}
                disabled={creating}
                onAgentChange={(next) => setAgent(next ?? DEFAULT_AGENT)}
                onModelChange={setModel}
                onEffortChange={setEffort}
              />
            ) : (
              <span className="text-xs text-muted-foreground">{t("common.loading")}</span>
            )}
            <ExecutionModeField agent={agent} mode={mode} disabled={creating} onChange={setMode} />
          </div>

          <WorkspaceCloneBranchesFields
            projectSlug={projectSlug}
            active={open}
            repos={cloneRepos}
            value={branches}
            onChange={setBranches}
            disabled={creating}
            allowGlobalFallback
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={creating}>
              {t("workspacesPage.cleanup.cancel")}
            </Button>
          </DialogClose>
          <Button type="button" disabled={creating || name.trim() === "" || !bundle} onClick={() => void handleCreate()}>
            <FolderPlus className="h-4 w-4" />
            {creating ? t("workspacesPage.newWorkspace.creating") : t("workspacesPage.newWorkspace.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
