import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DevEnvStepRow } from "@/components/devenv/DevEnvStepRow";
import { buildDevEnvGroups, emptyDevEnvStep, GENERAL_GROUP_KEY } from "@/lib/devEnvGroups";
import { proposeDevEnvSteps, runDevEnvStep } from "@/services/devEnv";
import type { DevEnvStep } from "@/types/devEnv";
import type { WorkspaceRepository } from "@/types/repository";

interface DevEnvPanelProps {
  projectSlug: string;
  steps: DevEnvStep[];
  onStepsChange: (next: DevEnvStep[]) => void;
  repositories?: WorkspaceRepository[];
}

export function DevEnvPanel({ projectSlug, steps, onStepsChange, repositories }: DevEnvPanelProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const repos = repositories ?? [];
  const groups = buildDevEnvGroups(steps, repos);

  function handleChange(index: number, step: DevEnvStep) {
    onStepsChange(steps.map((existing, i) => (i === index ? step : existing)));
  }

  function handleRemove(index: number) {
    onStepsChange(steps.filter((_, i) => i !== index));
  }

  function handleAddStep(workingDir: string | null) {
    onStepsChange([...steps, emptyDevEnvStep(workingDir)]);
  }

  async function handlePropose() {
    setBusy(true);
    try {
      const proposed = await proposeDevEnvSteps(projectSlug);
      if (proposed.length === 0) {
        toast.info(t("project.config.devenv.noStepsProposed"));
      }
      onStepsChange([...steps, ...proposed]);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.config.devenv.proposeFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRunStep(step: DevEnvStep) {
    if (!step.id) return;
    try {
      await runDevEnvStep(projectSlug, step.id);
      toast.success(t("project.config.devenv.running", { command: step.command }));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t("project.config.devenv.runFailed"));
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t("project.config.devenv.hint")}</p>
        <Button type="button" size="sm" variant="secondary" onClick={handlePropose} disabled={busy}>
          {t("project.config.devenv.proposeSteps")}
        </Button>
      </header>

      <div className="space-y-5">
        {groups.map((group) => {
          if (group.key === GENERAL_GROUP_KEY && group.items.length === 0 && repos.length > 0) {
            return null;
          }
          const serveCount = group.items.filter(({ step }) => step.role === "serve").length;
          return (
            <div key={group.key} className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">{group.label}</h3>
                {group.repoRole ? (
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                    {group.repoRole}
                  </Badge>
                ) : null}
                {serveCount > 0 ? (
                  <Badge variant="secondary" className="text-[10px]">
                    {t("project.config.devenv.serveCount", { count: serveCount })}
                  </Badge>
                ) : null}
                {group.items.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t("project.config.devenv.noStepsYet")}</span>
                ) : null}
              </div>

              <div className="space-y-2">
                {group.items.map(({ step, index }) => (
                  <DevEnvStepRow
                    key={step.id ?? `new-${index}`}
                    step={step}
                    index={index}
                    onChange={handleChange}
                    onRemove={handleRemove}
                    onRun={handleRunStep}
                  />
                ))}
              </div>

              <Button type="button" size="sm" variant="ghost" onClick={() => handleAddStep(group.workingDir)}>
                {group.workingDir
                  ? t("project.config.devenv.addStepTo", { label: group.label })
                  : t("project.config.devenv.addStep")}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
