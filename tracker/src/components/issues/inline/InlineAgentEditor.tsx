import { Bot, Check, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AGENT_LABELS } from "@/components/shared/AgentChip";
import { cn } from "@/lib/utils";
import type { AgentKind, AgentOption } from "@/types/issue";

interface InlineAgentEditorProps {
  agent: AgentKind | null;
  effectiveAgent: AgentKind;
  options: AgentOption[];
  optionsLoading?: boolean;
  disabled?: boolean;
  saving?: boolean;
  onSave: (agent: AgentKind | null) => Promise<boolean>;
}

export function InlineAgentEditor({
  agent,
  effectiveAgent,
  options,
  optionsLoading = false,
  disabled = false,
  saving = false,
  onSave,
}: InlineAgentEditorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AgentKind | "inherit">(agent ?? "inherit");
  const containerRef = useRef<HTMLDivElement>(null);

  const optionItems = useMemo(() => {
    if (options.length > 0) return options;
    return (["codex", "claude", "cursor"] as AgentKind[]).map((value) => ({
      value,
      label: AGENT_LABELS[value],
      default: false,
    }));
  }, [options]);

  const inheritLabel = t("issue.create.inherit", { agent: AGENT_LABELS[effectiveAgent] });
  const currentLabel = agent ? AGENT_LABELS[agent] : inheritLabel;

  useEffect(() => {
    if (!open) setDraft(agent ?? "inherit");
  }, [agent, open]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  async function commit() {
    const nextAgent = draft === "inherit" ? null : draft;
    if (nextAgent === agent) {
      setOpen(false);
      return;
    }

    const saved = await onSave(nextAgent);
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
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">{currentLabel}</span>
      </button>

      {open ? (
        <div className="absolute left-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-border/70 bg-popover p-2 shadow-lg">
          <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("issue.inline.agent.title")}
          </div>
          {optionsLoading ? (
            <p className="px-1 text-xs text-muted-foreground">{t("issue.inline.agent.loading")}</p>
          ) : (
            <div className="max-h-40 space-y-0.5 overflow-y-auto">
              <AgentOptionButton active={draft === "inherit"} label={inheritLabel} onClick={() => setDraft("inherit")} />
              {optionItems.map((option) => (
                <AgentOptionButton
                  key={option.value}
                  active={draft === option.value}
                  label={option.label}
                  onClick={() => setDraft(option.value)}
                />
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5 border-t border-border/60 pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void commit()}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              {t("issue.inline.agent.save")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              {t("issue.inline.agent.close")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AgentOptionButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
      )}
    >
      <Bot className="h-4 w-4 opacity-70" />
      {label}
    </button>
  );
}
