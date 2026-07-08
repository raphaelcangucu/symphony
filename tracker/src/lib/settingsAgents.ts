import { Bot, Boxes, Cpu, Terminal, type LucideIcon } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { AGENT_ICONS } from "@/components/shared/AgentChip";
import type { AgentKind } from "@/types/issue";

export type SettingsIcon = ComponentType<SVGProps<SVGSVGElement>> | LucideIcon;

export interface AgentToolDescriptor {
  slug: string;
  kind: AgentKind | null;
  labelKey: string;
  beta: boolean;
  supported: boolean;
  icon: SettingsIcon;
}

export const AGENT_TOOL_DESCRIPTORS: AgentToolDescriptor[] = [
  {
    slug: "claude",
    kind: "claude",
    labelKey: "settings.agentTool.agents.claude",
    beta: false,
    supported: true,
    icon: AGENT_ICONS.claude,
  },
  {
    slug: "codex",
    kind: "codex",
    labelKey: "settings.agentTool.agents.codex",
    beta: false,
    supported: true,
    icon: AGENT_ICONS.codex,
  },
  {
    slug: "cursor",
    kind: "cursor",
    labelKey: "settings.agentTool.agents.cursor",
    beta: false,
    supported: true,
    icon: AGENT_ICONS.cursor,
  },
  {
    slug: "opencode",
    kind: "opencode",
    labelKey: "settings.agentTool.agents.opencode",
    beta: false,
    supported: true,
    icon: Boxes,
  },
  {
    slug: "pi",
    kind: null,
    labelKey: "settings.agentTool.agents.pi",
    beta: false,
    supported: false,
    icon: Cpu,
  },
  {
    slug: "command-code",
    kind: null,
    labelKey: "settings.agentTool.agents.commandCode",
    beta: true,
    supported: false,
    icon: Terminal,
  },
  {
    slug: "grok",
    kind: null,
    labelKey: "settings.agentTool.agents.grok",
    beta: true,
    supported: false,
    icon: Bot,
  },
];

export function findAgentDescriptor(slug: string): AgentToolDescriptor | undefined {
  return AGENT_TOOL_DESCRIPTORS.find((descriptor) => descriptor.slug === slug);
}
