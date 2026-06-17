import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DevEnvReadyProbe, DevEnvStep, DevEnvStepRole } from "@/types/devEnv";

interface DevEnvStepRowProps {
  step: DevEnvStep;
  index: number;
  onChange: (index: number, step: DevEnvStep) => void;
  onRemove: (index: number) => void;
  onRun?: (step: DevEnvStep) => void;
}

const selectClass =
  "h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function DevEnvStepRow({ step, index, onChange, onRemove, onRun }: DevEnvStepRowProps) {
  const { t } = useTranslation();
  const isServe = step.role === "serve";
  const stepLabel = step.description.trim() || t("project.config.devenv.stepLabel", { index: index + 1 });

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
        <Input
          aria-label={t("project.config.devenv.descriptionAria")}
          value={step.description}
          onChange={(e) => onChange(index, { ...step, description: e.target.value })}
          placeholder={t("project.config.devenv.descriptionPlaceholder")}
        />
        <Input
          aria-label={t("project.config.devenv.commandAria")}
          value={step.command}
          onChange={(e) => onChange(index, { ...step, command: e.target.value })}
          placeholder={t("project.config.devenv.commandPlaceholder")}
        />
        <div className="flex items-center gap-2">
          {onRun ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => onRun(step)} disabled={!step.id}>
              {t("project.config.devenv.run")}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => onRemove(index)}>
            {t("project.config.devenv.remove")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <label className="flex items-center gap-1.5">
          <span className="font-medium">{t("project.config.devenv.role")}</span>
          <select
            aria-label={t("project.config.devenv.roleAria", { label: stepLabel })}
            className={selectClass}
            value={step.role}
            onChange={(e) => onChange(index, { ...step, role: e.target.value as DevEnvStepRole })}
          >
            <option value="setup">{t("project.config.devenv.roleSetup")}</option>
            <option value="serve">{t("project.config.devenv.roleServe")}</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            aria-label={t("project.config.devenv.optionalAria", { label: stepLabel })}
            checked={step.optional}
            onChange={(e) => onChange(index, { ...step, optional: e.target.checked })}
          />
          {t("project.config.devenv.optional")}
        </label>

        {isServe ? (
          <>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                aria-label={t("project.config.devenv.primaryPreviewAria", { label: stepLabel })}
                checked={step.primary}
                onChange={(e) => onChange(index, { ...step, primary: e.target.checked })}
              />
              {t("project.config.devenv.primaryPreview")}
            </label>
            <label className="flex items-center gap-1.5">
              <span className="font-medium">{t("project.config.devenv.portEnv")}</span>
              <Input
                aria-label={t("project.config.devenv.portEnvAria", { label: stepLabel })}
                className="h-8 w-28"
                value={step.portEnv ?? ""}
                onChange={(e) => onChange(index, { ...step, portEnv: e.target.value.trim() || null })}
                placeholder={t("project.config.devenv.portEnvPlaceholder")}
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="font-medium">{t("project.config.devenv.ready")}</span>
              <select
                aria-label={t("project.config.devenv.readyAria", { label: stepLabel })}
                className={selectClass}
                value={step.readyProbe}
                onChange={(e) => onChange(index, { ...step, readyProbe: e.target.value as DevEnvReadyProbe })}
              >
                <option value="tcp">{t("project.config.devenv.readyTcp")}</option>
                <option value="http">{t("project.config.devenv.readyHttp")}</option>
              </select>
            </label>
            {step.readyProbe === "http" ? (
              <label className="flex items-center gap-1.5">
                <span className="font-medium">{t("project.config.devenv.path")}</span>
                <Input
                  aria-label={t("project.config.devenv.readyPathAria", { label: stepLabel })}
                  className="h-8 w-28"
                  value={step.readyPath}
                  onChange={(e) => onChange(index, { ...step, readyPath: e.target.value || "/" })}
                  placeholder={t("project.config.devenv.readyPathPlaceholder")}
                />
              </label>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
