import type { TFunction } from "i18next";
import { Feather, Flame, Gauge, Loader2, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { SlashCommandDef } from "@/components/assistant/slashCommands";
import { MagicPaletteShell } from "@/components/commands/MagicPaletteShell";
import {
  groupPromptTemplates,
  groupSlashCommands,
  slashCommandSearchValue,
} from "@/components/commands/magicPaletteCategories";
import { useMagicCommands } from "@/components/commands/useMagicCommands";
import { agentKindLabel } from "@/components/shared/AgentChip";
import { Badge } from "@/components/ui/badge";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { executionModeMeta } from "@/lib/executionMode";
import type { RunPromptTemplateResult } from "@/services/magicCommands";
import type { PromptTemplate } from "@/types/prompt-template";
import type { AgentKind, ExecutionMode } from "@/types/issue";

interface MagicCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slashCommands?: SlashCommandDef[];
  onSlashSelect?: (command: SlashCommandDef) => void;
  projectSlug?: string;
  identifier?: string;
  onRan?: (result: RunPromptTemplateResult) => void;
}

interface CommandMetadata {
  agent: string | null;
  model: string | null;
  effort: string | null;
  mode: { label: string; icon: ReactNode } | null;
}

export function MagicCommandPalette({
  open,
  onOpenChange,
  slashCommands = [],
  onSlashSelect,
  projectSlug = "",
  identifier = "",
  onRan,
}: MagicCommandPaletteProps) {
  const { t } = useTranslation();
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  const promptTemplatesEnabled = Boolean(projectSlug.trim() && identifier.trim());
  const { commands: templateCommands, isLoading, run, isRunning } = useMagicCommands({
    projectSlug: promptTemplatesEnabled ? projectSlug : "",
    identifier: promptTemplatesEnabled ? identifier : "",
    onRan,
  });

  const slashGroups = useMemo(() => groupSlashCommands(slashCommands, t), [slashCommands, t]);
  const templateGroups = useMemo(
    () => (promptTemplatesEnabled ? groupPromptTemplates(templateCommands, t) : []),
    [promptTemplatesEnabled, templateCommands, t],
  );

  const dispatchPending = isRunning || pendingSlug !== null;
  const inputPlaceholder = dispatchPending
    ? t("commands.magic.searchRunning")
    : t("commands.magic.searchPlaceholder");
  const emptyLabel =
    promptTemplatesEnabled && isLoading && templateGroups.length === 0 && slashGroups.length === 0
      ? t("commands.magic.loading")
      : t("commands.magic.empty");

  async function handleTemplateSelect(command: PromptTemplate) {
    if (dispatchPending) return;

    try {
      setPendingSlug(command.slug);
      await run(command.slug);
      onOpenChange(false);
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : t("commands.magic.runFailed");
      toast.error(message);
    } finally {
      setPendingSlug(null);
    }
  }

  function handleSlashSelect(command: SlashCommandDef) {
    if (dispatchPending) return;
    onSlashSelect?.(command);
    onOpenChange(false);
  }

  return (
    <MagicPaletteShell
      open={open}
      onOpenChange={onOpenChange}
      searchPlaceholder={inputPlaceholder}
      searchDisabled={dispatchPending}
      emptyLabel={emptyLabel}
    >
      {slashGroups.map((group) => (
        <CommandGroup key={`slash-${group.id}`} heading={group.heading}>
          {group.items.map((command) => (
            <CommandItem
              key={command.name}
              value={slashCommandSearchValue(command)}
              disabled={dispatchPending}
              onSelect={() => handleSlashSelect(command)}
            >
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="truncate">{command.name}</span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
      {templateGroups.map((group) => (
        <CommandGroup key={`template-${group.id}`} heading={group.heading}>
          {group.items.map((command) => {
            const metadata = commandMetadata(command, t);
            const isPending = command.slug === pendingSlug;

            return (
              <CommandItem
                key={command.id}
                value={commandSearchValue(command, metadata)}
                disabled={dispatchPending}
                onSelect={() => void handleTemplateSelect(command)}
              >
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span className="truncate">{command.name}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {metadata.agent ? (
                      <MetaBadge
                        prefix={t("commands.magic.badges.agent")}
                        label={metadata.agent}
                        dataTestId={`magic-command-agent-${command.slug}`}
                      />
                    ) : null}
                    {metadata.effort ? (
                      <MetaBadge
                        prefix={t("commands.magic.badges.effort")}
                        label={metadata.effort}
                        icon={effortIcon(command.effort)}
                        dataTestId={`magic-command-effort-${command.slug}`}
                      />
                    ) : null}
                    {metadata.mode ? (
                      <MetaBadge
                        prefix={t("commands.magic.badges.mode")}
                        label={metadata.mode.label}
                        icon={metadata.mode.icon}
                        dataTestId={`magic-command-mode-${command.slug}`}
                      />
                    ) : null}
                    {isPending ? (
                      <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px] font-medium">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t("commands.magic.running")}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>
      ))}
    </MagicPaletteShell>
  );
}

function commandMetadata(command: PromptTemplate, t: TFunction): CommandMetadata {
  const agent = agentLabel(command.agentKind, t);
  const model = normalizeNonBlank(command.model);
  const effort = effortLabel(command.effort, t);
  const mode = modeLabel(command.mode, t);

  return { agent, model, effort, mode };
}

function commandSearchValue(command: PromptTemplate, metadata: CommandMetadata): string {
  return [
    command.name,
    command.slug,
    normalizeNonBlank(command.category),
    normalizeNonBlank(command.description),
    metadata.agent,
    metadata.model,
    metadata.effort,
    metadata.mode?.label,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

function effortIcon(value: string | null): ReactNode {
  const normalized = normalizeNonBlank(value)?.toLocaleLowerCase();
  if (normalized === "low" || normalized === "minimal") return <Feather className="h-3 w-3 shrink-0" />;
  if (normalized === "high") return <Flame className="h-3 w-3 shrink-0" />;
  if (normalized === "xhigh" || normalized === "max" || normalized === "ultra" || normalized === "ultracode") {
    return <Sparkles className="h-3 w-3 shrink-0" />;
  }
  return <Gauge className="h-3 w-3 shrink-0" />;
}

function agentLabel(value: string | null, t: TFunction): string | null {
  const kind = toAgentKind(value);
  if (!kind) return normalizeNonBlank(value);
  return agentKindLabel(kind, t);
}

function effortLabel(value: string | null, t: TFunction): string | null {
  const normalized = normalizeNonBlank(value);
  if (!normalized) return null;
  const translationKey = `assistant.effort.${normalized}`;
  const translated = t(translationKey);
  return translated === translationKey ? normalized : translated;
}

function modeLabel(value: string | null, t: TFunction): { label: string; icon: ReactNode } | null {
  const mode = toExecutionMode(value);
  if (!mode) {
    const fallback = normalizeNonBlank(value);
    return fallback ? { label: fallback, icon: <Gauge className="h-3 w-3 shrink-0" /> } : null;
  }
  const meta = executionModeMeta(mode);
  const Icon = meta.Icon;
  return { label: t(meta.labelKey), icon: <Icon className="h-3 w-3 shrink-0" /> };
}

function normalizeNonBlank(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toAgentKind(value: string | null): AgentKind | null {
  if (value === "codex" || value === "claude" || value === "cursor") return value;
  return null;
}

function toExecutionMode(value: string | null): ExecutionMode | null {
  if (value === "plan" || value === "build" || value === "yolo") return value;
  return null;
}

function MetaBadge({
  prefix,
  label,
  icon,
  dataTestId,
}: {
  prefix: string;
  label: string;
  icon?: ReactNode;
  dataTestId?: string;
}) {
  return (
    <Badge
      variant="muted"
      className="gap-1 px-1.5 py-0 text-[10px] font-medium"
      title={`${prefix}: ${label}`}
      data-testid={dataTestId}
    >
      {icon}
      {label}
    </Badge>
  );
}
