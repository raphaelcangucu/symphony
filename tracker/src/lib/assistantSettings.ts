export type AssistantEffort = string;

export interface AssistantEffortOption {
  id: AssistantEffort;
  label: string;
  description?: string;
}

export interface AssistantModelOption {
  id: string;
  model: string;
  label: string;
  description?: string;
  isDefault: boolean;
  defaultEffort: AssistantEffort;
  efforts: AssistantEffortOption[];
  inputModalities?: string[];
}

export interface AssistantCodexCatalog {
  agent: "codex";
  agentLabel: string;
  command: string;
  defaultModel: string | null;
  models: AssistantModelOption[];
}

export interface AssistantComposerSettings {
  model: string;
  effort: AssistantEffort;
}

const STORAGE_KEY = "symphony.assistant.composer";
const CATALOG_STORAGE_KEY = "symphony.assistant.codexCatalog";

const FALLBACK_EFFORTS: AssistantEffortOption[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
];

export function fallbackCodexCatalog(command = "codex app-server"): AssistantCodexCatalog {
  const defaultModel = "gpt-5.5";

  return {
    agent: "codex",
    agentLabel: "Codex CLI",
    command,
    defaultModel,
    models: [
      fallbackModel("gpt-5.5", "GPT-5.5", true),
      fallbackModel("gpt-5.4", "GPT-5.4", false),
      fallbackModel("gpt-5.3-codex", "GPT-5.3 Codex", false),
    ],
  };
}

export function loadCachedCodexCatalog(): AssistantCodexCatalog | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(CATALOG_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as AssistantCodexCatalog;
    if (!parsed.models?.length) return null;

    return parsed;
  } catch {
    return null;
  }
}

export function saveCachedCodexCatalog(catalog: AssistantCodexCatalog): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(catalog));
}

function fallbackModel(model: string, label: string, isDefault: boolean): AssistantModelOption {
  return {
    id: model,
    model,
    label,
    isDefault,
    defaultEffort: "medium",
    efforts: FALLBACK_EFFORTS,
    inputModalities: ["text", "image"],
  };
}

export function defaultComposerSettings(catalog: AssistantCodexCatalog): AssistantComposerSettings {
  const modelOption = pickDefaultModel(catalog);
  return {
    model: modelOption.model,
    effort: modelOption.defaultEffort,
  };
}

export function loadAssistantComposerSettings(catalog: AssistantCodexCatalog): AssistantComposerSettings {
  const fallback = defaultComposerSettings(catalog);

  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<AssistantComposerSettings>;
    const modelOption = findModelOption(catalog, parsed.model) ?? pickDefaultModel(catalog);
    const effort = normalizeEffort(modelOption, parsed.effort);

    return { model: modelOption.model, effort };
  } catch {
    return fallback;
  }
}

export function saveAssistantComposerSettings(settings: AssistantComposerSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function modelLabel(catalog: AssistantCodexCatalog, modelId: string): string {
  return findModelOption(catalog, modelId)?.label ?? modelId;
}

export function effortLabel(catalog: AssistantCodexCatalog, modelId: string, effort: AssistantEffort): string {
  const model = findModelOption(catalog, modelId);
  return model?.efforts.find((option) => option.id === effort)?.label ?? effort;
}

export function effortsForModel(catalog: AssistantCodexCatalog, modelId: string): AssistantEffortOption[] {
  return findModelOption(catalog, modelId)?.efforts ?? [];
}

export function normalizeEffort(model: AssistantModelOption, effort?: string | null): AssistantEffort {
  if (effort && model.efforts.some((option) => option.id === effort)) return effort;
  return model.defaultEffort;
}

function pickDefaultModel(catalog: AssistantCodexCatalog): AssistantModelOption {
  if (catalog.defaultModel) {
    const match = findModelOption(catalog, catalog.defaultModel);
    if (match) return match;
  }

  return catalog.models.find((model) => model.isDefault) ?? catalog.models[0];
}

function findModelOption(catalog: AssistantCodexCatalog, modelId?: string | null): AssistantModelOption | undefined {
  if (!modelId) return undefined;
  return catalog.models.find((model) => model.model === modelId || model.id === modelId);
}
