import type { ReactElement, ReactNode, SVGProps } from "react";
import type { TFunction } from "i18next";

import { i18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { AgentKind } from "@/types/issue";

function CodexIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A5.98 5.98 0 0 0 10.74 0a6.05 6.05 0 0 0-5.77 4.19 5.98 5.98 0 0 0-3.99 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.05 6.05 0 0 0 5.77-4.2 5.98 5.98 0 0 0 3.99-2.9 6.05 6.05 0 0 0-.74-7.08Zm-9.02 12.6a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.78.78 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.06v5.58a4.5 4.5 0 0 1-4.49 4.49ZM3.6 18.3a4.47 4.47 0 0 1-.54-3.01l.14.09 4.78 2.76a.78.78 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.07l-4.83 2.79a4.5 4.5 0 0 1-6.14-1.65ZM2.34 7.9a4.48 4.48 0 0 1 2.34-1.97V11.6a.78.78 0 0 0 .39.68l5.84 3.37-2.02 1.17a.07.07 0 0 1-.07 0L4 14.03a4.5 4.5 0 0 1-1.66-6.14Zm16.6 3.85L13.1 8.37l2.02-1.16a.07.07 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.68a.78.78 0 0 0-.39-.67Zm2.01-3.02-.14-.09-4.78-2.78a.78.78 0 0 0-.79 0L9.42 9.23V6.9a.07.07 0 0 1 .03-.07l4.83-2.79a4.49 4.49 0 0 1 6.67 4.65ZM8.32 12.87 6.3 11.7a.08.08 0 0 1-.04-.06V6.07a4.49 4.49 0 0 1 7.36-3.44l-.14.08L8.7 5.47a.78.78 0 0 0-.39.68ZM9.42 10.5 12.03 9l2.6 1.5v3l-2.6 1.5-2.61-1.5Z" />
    </svg>
  );
}

function ClaudeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M4.71 15.16 9.4 12.5l.08-.23-.08-.13H9.2l-.8-.05-2.74-.07-2.37-.1-2.3-.12-.58-.13L0 10.96l.06-.36.49-.33.69.06 1.53.1 2.3.16 1.66.1 2.47.26h.39l.06-.16-.14-.1-.1-.1-2.5-1.7-2.7-1.79-1.42-1.03-.77-.52-.38-.49-.17-1.06.69-.76.92.06.24.07.94.72 2 1.55 2.61 1.93.39.32.15-.11.02-.08-.17-.29-1.45-2.61-1.54-2.66-.69-1.1-.18-.66a3.2 3.2 0 0 1-.11-.78l.78-1.06L6 0l1.06.15.45.39 1.45 4.6L9.5 6.27l.08.34h.08L9.84 6.45l.07-.4 1.06-4.41 1.18-1.4 1.36-1.46 1.07.06.7.97-.41 1.44L13.69 5l-.7 2.62-.45 1.42.07.11.16.04 2.69-1.16 1.86-.81L19.43 6.83l1.06.15.13.93-.62.96-2.01 1.4-2.36 1.6-1.45.93-.04.1.06.07 2.5-.24.97.04 1.5.13.4.27.23.4-.27.95-3.39.85-2.42-.55h-.31l-.07.13.42 1.05 1.34 2.49 1.43 2.59-.4 1.23-.7.45-.78-.07-.46-.62-1.27-2.32-1.51-2.81-.7-1.18-.16.08-.8 8.1-.36.41-.85.33-.7-.54-.37-.86.37-1.71 1.06-3.13.31-1.45.31-1.86-.16-.43-.05-.06-.94.13-3.62.5-1.27.1-.36-.3-.31-1.06.13-.94.45-.6Z" />
    </svg>
  );
}

function CursorIcon(props: SVGProps<SVGSVGElement>) {
  // Simplified isometric-cube mark: outer hexagon with the top face cut out.
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden="true" {...props}>
      <path d="M12 1.5 21.09 6.75v10.5L12 22.5l-9.09-5.25V6.75L12 1.5Zm0 2.31L4.91 7.9 12 12l7.09-4.1L12 3.81Zm-7.18 5.32v6.96L11 19.86v-6.13L4.82 9.13Zm14.36 0L13 13.73v6.13l6.18-3.77V9.13Z" />
    </svg>
  );
}

function OpenCodeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export const AGENT_ICONS: Record<AgentKind, (props: SVGProps<SVGSVGElement>) => ReactElement> = {
  codex: CodexIcon,
  claude: ClaudeIcon,
  cursor: CursorIcon,
  opencode: OpenCodeIcon,
};

export const AGENT_KINDS: AgentKind[] = ["codex", "claude", "cursor", "opencode"];

const AGENT_LABEL_KEYS: Record<AgentKind, string> = {
  codex: "issue.sessionLog.agentLabels.codex",
  claude: "issue.sessionLog.agentLabels.claude",
  cursor: "issue.sessionLog.agentLabels.cursor",
  opencode: "issue.sessionLog.agentLabels.opencode",
};

type Translate = TFunction;

export function agentKindLabel(
  kind: AgentKind,
  t: Translate = i18n.t.bind(i18n) as Translate,
): string {
  return t(AGENT_LABEL_KEYS[kind]);
}

export function AgentIconBadge({ kind, label, className }: { kind: AgentKind; label?: string; className?: string }) {
  const Icon = AGENT_ICONS[kind];
  const accessibleLabel = label ?? agentKindLabel(kind);

  return (
    <span
      role="img"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background text-muted-foreground",
        className,
      )}
    >
      <Icon className="h-3 w-3" />
    </span>
  );
}

export interface AgentChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  disabled?: boolean;
}

export function AgentChip({ label, active, onClick, icon, disabled }: AgentChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "bg-background text-foreground hover:bg-muted",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
