import {
  GitBranch,
  Globe,
  Keyboard,
  Plug,
  Puzzle,
  Rabbit,
  Sparkles,
  Terminal,
  Wand2,
} from "lucide-react";

import type { SettingsIcon } from "@/lib/settingsAgents";

export interface SettingsPlaceholderDescriptor {
  titleKey: string;
  descriptionKey: string;
  bodyKey: string;
  icon: SettingsIcon;
  statusKey?: string;
}

const SHARED_BODY_KEY = "settings.placeholder.body";

export const SETTINGS_PLACEHOLDERS: Record<string, SettingsPlaceholderDescriptor> = {
  keybindings: {
    titleKey: "settings.sections.keybindings.label",
    descriptionKey: "settings.placeholder.keybindings.description",
    bodyKey: SHARED_BODY_KEY,
    icon: Keyboard,
  },
  "web-access": {
    titleKey: "settings.sections.webAccess.label",
    descriptionKey: "settings.placeholder.webAccess.description",
    bodyKey: SHARED_BODY_KEY,
    icon: Globe,
  },
  mcp: {
    titleKey: "settings.sections.mcp.label",
    descriptionKey: "settings.placeholder.mcp.description",
    bodyKey: SHARED_BODY_KEY,
    icon: Plug,
  },
  integrations: {
    titleKey: "settings.sections.integrations.label",
    descriptionKey: "settings.placeholder.integrations.description",
    bodyKey: SHARED_BODY_KEY,
    icon: Puzzle,
  },
  "github-cli": {
    titleKey: "settings.sections.githubCli.label",
    descriptionKey: "settings.placeholder.githubCli.description",
    bodyKey: SHARED_BODY_KEY,
    icon: GitBranch,
  },
  "coderabbit-cli": {
    titleKey: "settings.sections.coderabbitCli.label",
    descriptionKey: "settings.placeholder.coderabbitCli.description",
    bodyKey: SHARED_BODY_KEY,
    icon: Rabbit,
  },
  terminal: {
    titleKey: "settings.sections.terminal.label",
    descriptionKey: "settings.placeholder.terminal.description",
    bodyKey: SHARED_BODY_KEY,
    icon: Terminal,
  },
  "magic-prompts": {
    titleKey: "settings.sections.magicPrompts.label",
    descriptionKey: "settings.placeholder.magicPrompts.description",
    bodyKey: SHARED_BODY_KEY,
    icon: Wand2,
  },
  opinionated: {
    titleKey: "settings.sections.opinionated.label",
    descriptionKey: "settings.placeholder.opinionated.description",
    bodyKey: SHARED_BODY_KEY,
    icon: Sparkles,
  },
};

export function findPlaceholder(key: string): SettingsPlaceholderDescriptor | undefined {
  return SETTINGS_PLACEHOLDERS[key];
}
