import type { AssistantCodexCatalog } from "@/lib/assistantSettings";

export const mockAssistantCodexCatalog: AssistantCodexCatalog = {
  agent: "codex",
  agentLabel: "Codex CLI",
  command: "codex app-server",
  defaultModel: "gpt-5.3-codex",
  models: [
    {
      id: "gpt-5.3-codex",
      model: "gpt-5.3-codex",
      label: "GPT-5.3 Codex",
      isDefault: true,
      defaultEffort: "low",
      efforts: [
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ],
    },
  ],
};
