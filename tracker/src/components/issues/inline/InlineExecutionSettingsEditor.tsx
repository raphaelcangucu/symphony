import { Bot, Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ExecutionSettingsPicker } from "@/components/assistant/ExecutionSettingsPicker";
import { agentKindLabel } from "@/components/shared/AgentChip";
import { useInlinePickerDismiss } from "@/hooks/useInlinePickerDismiss";
import { fallbackCatalogBundle, type AssistantCatalogBundle } from "@/lib/assistantSettings";
import { cn } from "@/lib/utils";
import { fetchAssistantCatalogBundle } from "@/services/assistant";
import type { AgentKind } from "@/types/issue";

export interface ExecutionSettingsValue {
  agent: AgentKind | null;
  model: string | null;
  effort: string | null;
}

interface InlineExecutionSettingsEditorProps {
  projectSlug: string;
  value: ExecutionSettingsValue;
  effectiveAgent: AgentKind;
  disabled?: boolean;
  saving?: boolean;
  onSave: (value: ExecutionSettingsValue) => Promise<boolean>;
}

export function InlineExecutionSettingsEditor({
  projectSlug,
  value,
  effectiveAgent,
  disabled = false,
  saving = false,
  onSave,
}: InlineExecutionSettingsEditorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ExecutionSettingsValue>(value);
  const [bundle, setBundle] = useState<AssistantCatalogBundle>(() => fallbackCatalogBundle());
  const [catalogLoading, setCatalogLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const inheritLabel = t("issue.create.inherit", { agent: agentKindLabel(effectiveAgent, t) });
  const currentLabel = [
    value.agent ? agentKindLabel(value.agent, t) : inheritLabel,
    value.model,
    value.effort,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  useEffect(() => {
    if (!open) setDraft(value);
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCatalogLoading(true);
    void fetchAssistantCatalogBundle(projectSlug)
      .then((next) => {
        if (!cancelled) setBundle(next);
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectSlug]);

  useInlinePickerDismiss({ open, containerRef, onDismiss: () => setOpen(false) });

  async function commit() {
    const unchanged =
      draft.agent === value.agent && draft.model === value.model && draft.effort === value.effort;
    if (unchanged) {
      setOpen(false);
      return;
    }
    const saved = await onSave(draft);
    if (saved) setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled || saving}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "group inline-flex w-full items-center gap-1.5 rounded-lg border border-transparent px-1 py-1 text-left transition-colors",
          "hover:border-border/60 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25",
          open && "border-border/60 bg-muted/20",
          disabled ? "cursor-default opacity-70" : "cursor-pointer",
        )}
      >
        <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm">{currentLabel}</span>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-border/70 bg-popover p-3 shadow-lg">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {t("issue.summary.execution")}
          </div>
          {catalogLoading ? (
            <p className="text-xs text-muted-foreground">{t("issue.inline.agent.loading")}</p>
          ) : (
            <ExecutionSettingsPicker
              bundle={bundle}
              agent={draft.agent}
              model={draft.model}
              effort={draft.effort}
              allowInherit
              inheritAgentLabel={inheritLabel}
              disabled={saving}
              onAgentChange={(agent) => setDraft((current) => ({ ...current, agent }))}
              onModelChange={(model) => setDraft((current) => ({ ...current, model }))}
              onEffortChange={(effort) => setDraft((current) => ({ ...current, effort }))}
            />
          )}
          <div className="mt-3 flex justify-end gap-1.5">
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted/40"
              onClick={() => setOpen(false)}
              aria-label={t("issue.inline.agent.close")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={saving || catalogLoading}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              onClick={() => void commit()}
              aria-label={t("issue.inline.agent.save")}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
