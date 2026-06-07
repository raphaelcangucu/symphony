import type { AgentKind } from "@/types/issue";

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

/**
 * Catalog for a single agent (codex or claude). Previously only codex existed;
 * the `agent` field is now typed as AgentKind to support multiple agents.
 */
export interface AssistantAgentCatalog {
  agent: AgentKind;
  agentLabel: string;
  command: string;
  defaultModel: string | null;
  models: AssistantModelOption[];
}

/** @deprecated Use AssistantAgentCatalog */
export type AssistantCodexCatalog = AssistantAgentCatalog;

export interface AssistantCatalogBundle {
  agents: AssistantAgentCatalog[];
  defaultAgent: AgentKind;
}

export interface AssistantComposerSettings {
  model: string;
  effort: AssistantEffort;
}

export interface AssistantComposerState {
  agent: AgentKind;
  byAgent: Partial<Record<AgentKind, AssistantComposerSettings>>;
}

// v2 storage keys — old keys are ignored; composer falls to defaults on upgrade
const COMPOSER_STATE_KEY = "symphony.assistant.composer.v2";
const CATALOGS_STORAGE_KEY = "symphony.assistant.catalogs";

const FALLBACK_EFFORTS: AssistantEffortOption[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
];

const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

function efforts(...ids: string[]): AssistantEffortOption[] {
  return ids.map((id) => ({ id, label: EFFORT_LABELS[id] ?? id }));
}

export function fallbackCodexCatalog(command = "codex app-server"): AssistantAgentCatalog {
  const defaultModel = "gpt-5.5";

  return {
    agent: "codex",
    agentLabel: "Codex CLI",
    command,
    defaultModel,
    models: [
      fallbackModel("gpt-5.5", "GPT-5.5", true, "medium", FALLBACK_EFFORTS),
      fallbackModel("gpt-5.4", "GPT-5.4", false, "medium", FALLBACK_EFFORTS),
      fallbackModel("gpt-5.3-codex", "GPT-5.3 Codex", false, "medium", FALLBACK_EFFORTS),
    ],
  };
}

export function fallbackClaudeCatalog(command = "claude"): AssistantAgentCatalog {
  // Mirrors SymphonyElixir.Claude.ModelCatalog: xhigh is Opus 4.7+, max is
  // Opus-tier only, Haiku has no effort control, and high is the CLI default.
  const opusEfforts = efforts("low", "medium", "high", "xhigh", "max");
  const opusLegacyEfforts = efforts("low", "medium", "high", "max");
  const sonnetEfforts = efforts("low", "medium", "high");

  return {
    agent: "claude",
    agentLabel: "Claude Code",
    command,
    defaultModel: "claude-opus-4-8",
    models: [
      fallbackModel("claude-opus-4-8", "Claude Opus 4.8", true, "xhigh", opusEfforts),
      fallbackModel("claude-opus-4-7", "Claude Opus 4.7", false, "xhigh", opusEfforts),
      fallbackModel("claude-opus-4-6", "Claude Opus 4.6", false, "high", opusLegacyEfforts),
      fallbackModel("claude-sonnet-4-6", "Claude Sonnet 4.6", false, "high", sonnetEfforts),
      fallbackModel("claude-haiku-4-5", "Claude Haiku 4.5", false, "", []),
    ],
  };
}

export function fallbackCatalogBundle(): AssistantCatalogBundle {
  return {
    agents: [fallbackCodexCatalog(), fallbackClaudeCatalog()],
    defaultAgent: "codex",
  };
}

export function catalogFor(bundle: AssistantCatalogBundle, agent: AgentKind): AssistantAgentCatalog {
  return bundle.agents.find((c) => c.agent === agent) ?? bundle.agents[0];
}

export function loadCachedCatalogBundle(): AssistantCatalogBundle | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(CATALOGS_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as AssistantCatalogBundle;
    if (!Array.isArray(parsed.agents) || parsed.agents.length === 0) return null;

    return parsed;
  } catch {
    return null;
  }
}

export function saveCachedCatalogBundle(bundle: AssistantCatalogBundle): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CATALOGS_STORAGE_KEY, JSON.stringify(bundle));
}

/**
 * @deprecated Use loadCachedCatalogBundle
 */
export function loadCachedCodexCatalog(): AssistantAgentCatalog | null {
  const bundle = loadCachedCatalogBundle();
  if (!bundle) return null;
  return bundle.agents.find((c) => c.agent === "codex") ?? null;
}

/**
 * @deprecated Use saveCachedCatalogBundle
 */
export function saveCachedCodexCatalog(catalog: AssistantAgentCatalog): void {
  const bundle = loadCachedCatalogBundle() ?? fallbackCatalogBundle();
  const agents = bundle.agents.filter((c) => c.agent !== catalog.agent);
  saveCachedCatalogBundle({ ...bundle, agents: [...agents, catalog] });
}

export function loadComposerState(bundle: AssistantCatalogBundle): AssistantComposerState {
  const defaultState: AssistantComposerState = { agent: bundle.defaultAgent, byAgent: {} };

  if (typeof window === "undefined") return defaultState;

  try {
    const raw = window.localStorage.getItem(COMPOSER_STATE_KEY);
    if (!raw) return defaultState;

    const parsed = JSON.parse(raw) as Partial<AssistantComposerState>;
    const agent: AgentKind = (parsed.agent === "codex" || parsed.agent === "claude")
      ? parsed.agent
      : bundle.defaultAgent;

    return {
      agent,
      byAgent: (parsed.byAgent && typeof parsed.byAgent === "object") ? parsed.byAgent : {},
    };
  } catch {
    return defaultState;
  }
}

export function saveComposerState(state: AssistantComposerState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COMPOSER_STATE_KEY, JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// Per-catalog helpers — unchanged signatures; callers pass a single catalog
// ---------------------------------------------------------------------------

export function defaultComposerSettings(catalog: AssistantAgentCatalog): AssistantComposerSettings {
  const modelOption = pickDefaultModel(catalog);
  return {
    model: modelOption.model,
    effort: modelOption.defaultEffort,
  };
}

/**
 * @deprecated Use loadComposerState(bundle) + per-agent byAgent lookup.
 */
export function loadAssistantComposerSettings(catalog: AssistantAgentCatalog): AssistantComposerSettings {
  const fallback = defaultComposerSettings(catalog);

  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(COMPOSER_STATE_KEY);
    if (!raw) return fallback;

    // v2 format: try reading byAgent for this catalog's agent first
    const parsed = JSON.parse(raw) as Partial<AssistantComposerState>;
    if (parsed.byAgent && catalog.agent in parsed.byAgent) {
      const agentSettings = parsed.byAgent[catalog.agent as AgentKind];
      if (agentSettings) {
        const modelOption = findModelOption(catalog, agentSettings.model) ?? pickDefaultModel(catalog);
        const effort = normalizeEffort(modelOption, agentSettings.effort);
        return { model: modelOption.model, effort };
      }
    }

    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * @deprecated Use saveComposerState.
 */
export function saveAssistantComposerSettings(settings: AssistantComposerSettings): void {
  if (typeof window === "undefined") return;

  try {
    const raw = window.localStorage.getItem(COMPOSER_STATE_KEY);
    const parsed: Partial<AssistantComposerState> = raw ? (JSON.parse(raw) as Partial<AssistantComposerState>) : {};
    const agent = parsed.agent ?? "codex";
    const byAgent = parsed.byAgent ?? {};
    saveComposerState({ agent: agent as AgentKind, byAgent: { ...byAgent, [agent]: settings } });
  } catch {
    // ignore
  }
}

export function modelLabel(catalog: AssistantAgentCatalog, modelId: string): string {
  return findModelOption(catalog, modelId)?.label ?? modelId;
}

export function effortLabel(catalog: AssistantAgentCatalog, modelId: string, effort: AssistantEffort): string {
  const model = findModelOption(catalog, modelId);
  return model?.efforts.find((option) => option.id === effort)?.label ?? effort;
}

export function effortsForModel(catalog: AssistantAgentCatalog, modelId: string): AssistantEffortOption[] {
  return findModelOption(catalog, modelId)?.efforts ?? [];
}

export function normalizeEffort(model: AssistantModelOption, effort?: string | null): AssistantEffort {
  if (effort && model.efforts.some((option) => option.id === effort)) return effort;
  return model.defaultEffort;
}

function fallbackModel(
  model: string,
  label: string,
  isDefault: boolean,
  defaultEffort: string,
  efforts: AssistantEffortOption[],
): AssistantModelOption {
  return {
    id: model,
    model,
    label,
    isDefault,
    defaultEffort,
    efforts,
    inputModalities: ["text", "image"],
  };
}

function pickDefaultModel(catalog: AssistantAgentCatalog): AssistantModelOption {
  if (catalog.defaultModel) {
    const match = findModelOption(catalog, catalog.defaultModel);
    if (match) return match;
  }

  return catalog.models.find((model) => model.isDefault) ?? catalog.models[0];
}

function findModelOption(catalog: AssistantAgentCatalog, modelId?: string | null): AssistantModelOption | undefined {
  if (!modelId) return undefined;
  return catalog.models.find((model) => model.model === modelId || model.id === modelId);
}
