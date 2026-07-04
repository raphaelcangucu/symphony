import {
  BarChart3,
  FlaskConical,
  GitBranch,
  Globe,
  HardDrive,
  Keyboard,
  KeyRound,
  LayoutTemplate,
  MessagesSquare,
  Palette,
  Plug,
  Puzzle,
  Rabbit,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Wand2,
} from "lucide-react";

import {
  settingsAppearancePath,
  settingsBackupsPath,
  settingsExperimentalPath,
  settingsGatewaysPath,
  settingsIntegrationsPath,
  settingsKeybindingsPath,
  settingsMcpPath,
  settingsProvidersPath,
  settingsAgentPath,
  settingsPath,
  settingsTemplatesPath,
  settingsToolPath,
  settingsUsagePath,
  settingsWebAccessPath,
} from "@/lib/settingsRoutes";
import { AGENT_TOOL_DESCRIPTORS, type SettingsIcon } from "@/lib/settingsAgents";

export interface SettingsNavItem {
  to: string;
  labelKey: string;
  icon: SettingsIcon;
  end?: boolean;
  badgeKey?: string;
}

export interface SettingsNavGroup {
  id: string;
  labelKey: string;
  items: SettingsNavItem[];
}

const BETA_BADGE_KEY = "settings.agentTool.betaBadge";

const agentItems: SettingsNavItem[] = AGENT_TOOL_DESCRIPTORS.map((descriptor) => ({
  to: settingsAgentPath(descriptor.slug),
  labelKey: descriptor.labelKey,
  icon: descriptor.icon,
  badgeKey: descriptor.beta ? BETA_BADGE_KEY : undefined,
}));

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    id: "general",
    labelKey: "settings.groups.general",
    items: [
      { to: settingsPath(), labelKey: "settings.sections.general.label", icon: SlidersHorizontal, end: true },
      { to: settingsAppearancePath(), labelKey: "settings.sections.appearance.label", icon: Palette },
      { to: settingsKeybindingsPath(), labelKey: "settings.sections.keybindings.label", icon: Keyboard },
    ],
  },
  {
    id: "agents",
    labelKey: "settings.groups.agents",
    items: agentItems,
  },
  {
    id: "tools",
    labelKey: "settings.groups.tools",
    items: [
      { to: settingsToolPath("github-cli"), labelKey: "settings.sections.githubCli.label", icon: GitBranch },
      { to: settingsToolPath("coderabbit-cli"), labelKey: "settings.sections.coderabbitCli.label", icon: Rabbit },
      { to: settingsToolPath("terminal"), labelKey: "settings.sections.terminal.label", icon: Terminal },
      { to: settingsToolPath("magic-prompts"), labelKey: "settings.sections.magicPrompts.label", icon: Wand2 },
      { to: settingsToolPath("opinionated"), labelKey: "settings.sections.opinionated.label", icon: Sparkles },
    ],
  },
  {
    id: "platform",
    labelKey: "settings.groups.platform",
    items: [
      { to: settingsProvidersPath(), labelKey: "settings.sections.providers.label", icon: KeyRound },
      { to: settingsWebAccessPath(), labelKey: "settings.sections.webAccess.label", icon: Globe },
      { to: settingsMcpPath(), labelKey: "settings.sections.mcp.label", icon: Plug },
      { to: settingsIntegrationsPath(), labelKey: "settings.sections.integrations.label", icon: Puzzle },
      { to: settingsGatewaysPath(), labelKey: "settings.sections.gateways.label", icon: MessagesSquare },
    ],
  },
  {
    id: "workspace",
    labelKey: "settings.groups.workspace",
    items: [
      { to: settingsTemplatesPath(), labelKey: "settings.sections.templates.label", icon: LayoutTemplate },
      { to: settingsBackupsPath(), labelKey: "settings.sections.backups.label", icon: HardDrive },
    ],
  },
  {
    id: "insights",
    labelKey: "settings.groups.insights",
    items: [
      { to: settingsUsagePath(), labelKey: "settings.sections.usage.label", icon: BarChart3 },
      { to: settingsExperimentalPath(), labelKey: "settings.sections.experimental.label", icon: FlaskConical },
    ],
  },
];
