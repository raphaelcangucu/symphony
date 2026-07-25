import type {
  AssistantCatalogBundle,
  AssistantCodexCatalog,
} from "@/lib/assistantSettings";

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

export function createMockAssistantCatalogBundle(): AssistantCatalogBundle {
  return {
    defaultAgent: "codex",
    agents: [
      { ...mockAssistantCodexCatalog, models: [...mockAssistantCodexCatalog.models] },
      {
        agent: "claude",
        agentLabel: "Claude Code",
        command: "claude",
        defaultModel: "claude-sonnet-5",
        models: [
          {
            id: "claude-sonnet-5",
            model: "claude-sonnet-5",
            label: "Claude Sonnet 5",
            isDefault: true,
            defaultEffort: "medium",
            efforts: [
              { id: "medium", label: "Medium" },
              { id: "high", label: "High" },
            ],
          },
        ],
      },
      {
        agent: "cursor",
        agentLabel: "Cursor",
        command: "cursor-agent",
        defaultModel: "composer-2.5",
        models: [
          {
            id: "composer-2.5",
            model: "composer-2.5",
            label: "Composer 2.5",
            isDefault: true,
            defaultEffort: "",
            efforts: [],
          },
        ],
      },
    ],
  };
}
