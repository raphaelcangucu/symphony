import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { DiffStats } from "@/lib/diffStats";
import { cn } from "@/lib/utils";
import type { ModelProvenance } from "@/types/assistant-thread";
import type { AgentKind } from "@/types/issue";

interface AssistantPanelHeaderProps {
  title: string;
  isPageMode: boolean;
  projectSlug?: string;
  diffStats: DiffStats | null;
  agentKind: AgentKind | null;
  modelProvenance: ModelProvenance;
}

export function AssistantPanelHeader({
  title,
  isPageMode,
  projectSlug,
  diffStats,
  agentKind,
  modelProvenance,
}: AssistantPanelHeaderProps) {
  const { t } = useTranslation("tracker");
  const copy: ModelProvenanceCopy = {
    requested: t("assistant.panel.modelProvenance.requested"),
    resolved: t("assistant.panel.modelProvenance.resolved"),
    notSpecified: t("assistant.panel.modelProvenance.notSpecified"),
    awaitingConfirmation: t(
      "assistant.panel.modelProvenance.awaitingConfirmation",
    ),
    reroutedFrom: (value) =>
      t("assistant.panel.modelProvenance.reroutedFrom", { value }),
    requestedAwaiting: (model) =>
      t("assistant.panel.modelProvenance.requestedAwaiting", { model }),
  };
  const provenanceLabel = modelProvenanceLabel(
    agentKind,
    modelProvenance,
    copy,
  );

  return (
    <div
      data-testid="project-assistant-compact-header"
      className={cn(
        "border-b bg-background/95",
        isPageMode ? "px-4 py-2 lg:px-6" : "px-4 py-2",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Bot className="h-4 w-4" />
          </span>
          <h2 className="truncate text-sm font-semibold leading-tight">
            {title}
          </h2>
          {projectSlug ? (
            <span className="hidden max-w-[18rem] truncate rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline-flex">
              {projectSlug}
            </span>
          ) : null}
          {diffStats ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-0.5 font-mono text-[11px]"
              title={`+${diffStats.additions}/-${diffStats.deletions} lines`}
            >
              <span className="text-emerald-600">+{diffStats.additions}</span>
              <span className="text-rose-600">-{diffStats.deletions}</span>
            </span>
          ) : null}
        </div>
        {provenanceLabel ? (
          <details
            data-testid="assistant-model-provenance-details"
            className="group min-w-0 max-w-full text-[11px] text-muted-foreground sm:max-w-[28rem]"
          >
            <summary
              data-testid="assistant-model-provenance"
              className="cursor-pointer truncate"
              title={provenanceLabel}
            >
              {provenanceLabel}
            </summary>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 rounded-md border bg-background p-2 shadow-sm">
              <dt className="font-medium text-foreground">{copy.requested}</dt>
              <dd className="truncate">
                {modelWithEffort(
                  modelProvenance.requestedModel,
                  modelProvenance.requestedEffort,
                ) ?? copy.notSpecified}
              </dd>
              <dt className="font-medium text-foreground">{copy.resolved}</dt>
              <dd className="truncate">
                {modelWithEffort(
                  modelProvenance.resolvedModel,
                  modelProvenance.resolvedEffort,
                ) ?? copy.awaitingConfirmation}
              </dd>
            </dl>
          </details>
        ) : null}
      </div>
    </div>
  );
}

export function modelProvenanceLabel(
  agentKind: AgentKind | null,
  provenance: ModelProvenance,
  copy: ModelProvenanceCopy = defaultModelProvenanceCopy,
): string | null {
  const agent = agentLabel(agentKind);
  const requested = modelWithEffort(
    provenance.requestedModel,
    provenance.requestedEffort,
  );
  const resolved = modelWithEffort(
    provenance.resolvedModel,
    provenance.resolvedEffort,
  );

  if (resolved) {
    const rerouted =
      requested !== null &&
      (provenance.requestedModel !== provenance.resolvedModel ||
        provenance.requestedEffort !== provenance.resolvedEffort);

    return rerouted
      ? `${agent} · ${resolved} · ${copy.reroutedFrom(requested)}`
      : `${agent} · ${resolved}`;
  }

  if (requested) {
    return `${agent} · ${copy.requestedAwaiting(provenance.requestedModel!)}`;
  }

  return null;
}

interface ModelProvenanceCopy {
  requested: string;
  resolved: string;
  notSpecified: string;
  awaitingConfirmation: string;
  reroutedFrom: (value: string) => string;
  requestedAwaiting: (model: string) => string;
}

const defaultModelProvenanceCopy: ModelProvenanceCopy = {
  requested: "Requested",
  resolved: "Resolved",
  notSpecified: "Not specified",
  awaitingConfirmation: "Awaiting provider confirmation",
  reroutedFrom: (value) => `rerouted from ${value}`,
  requestedAwaiting: (model) =>
    `requested ${model} · awaiting confirmation`,
};

function modelWithEffort(
  model: string | null,
  effort: string | null,
): string | null {
  if (!model) return null;
  return effort ? `${model} · ${effort}` : model;
}

function agentLabel(agentKind: AgentKind | null): string {
  switch (agentKind) {
    case "claude":
      return "Claude";
    case "cursor":
      return "Cursor";
    case "opencode":
      return "OpenCode";
    default:
      return "Codex";
  }
}
