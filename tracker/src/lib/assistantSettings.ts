import type { TFunction } from "i18next";

import { i18n } from "@/i18n";
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

type Translate = TFunction;

function catalogModelKey(modelId: string): string {
  return modelId.replace(/\./g, "_");
}

export function catalogAgentLabel(
  agent: AgentKind,
  t: Translate = i18n.t.bind(i18n) as Translate,
): string {
  return t(`assistant.catalog.agents.${agent}`);
}

function catalogModelLabel(
  modelId: string,
  t: Translate = i18n.t.bind(i18n) as Translate,
): string {
  const key = `assistant.catalog.models.${catalogModelKey(modelId)}`;
  const translated = t(key);
  return translated === key ? modelId : translated;
}

function effortLabelForId(id: string, t: Translate = i18n.t.bind(i18n) as Translate): string {
  if (!id) return "";
  const key = `assistant.effort.${id}`;
  const translated = t(key);
  return translated === key ? id : translated;
}

function efforts(t: Translate, ...ids: string[]): AssistantEffortOption[] {
  return ids.map((id) => ({ id, label: effortLabelForId(id, t) }));
}

function fallbackEfforts(t: Translate = i18n.t.bind(i18n) as Translate): AssistantEffortOption[] {
  return efforts(t, "low", "medium", "high", "xhigh");
}

export function fallbackCodexCatalog(
  command = "codex app-server",
  t: Translate = i18n.t.bind(i18n) as Translate,
): AssistantAgentCatalog {
  const defaultModel = "gpt-5.5";

  return {
    agent: "codex",
    agentLabel: catalogAgentLabel("codex", t),
    command,
    defaultModel,
    models: [
      fallbackModel("gpt-5.5", true, "medium", fallbackEfforts(t), t),
      fallbackModel("gpt-5.4", false, "medium", fallbackEfforts(t), t),
      fallbackModel("gpt-5.3-codex", false, "medium", fallbackEfforts(t), t),
    ],
  };
}

export function fallbackClaudeCatalog(
  command = "claude",
  t: Translate = i18n.t.bind(i18n) as Translate,
): AssistantAgentCatalog {
  // Mirrors SymphonyElixir.Claude.ModelCatalog: xhigh is Opus 4.7+, max is
  // Opus-tier only, Haiku has no effort control, and high is the CLI default.
  const opusEfforts = efforts(t, "low", "medium", "high", "xhigh", "max");
  const opusLegacyEfforts = efforts(t, "low", "medium", "high", "max");
  const sonnetEfforts = efforts(t, "low", "medium", "high");

  return {
    agent: "claude",
    agentLabel: catalogAgentLabel("claude", t),
    command,
    defaultModel: "claude-opus-4-8",
    models: [
      fallbackModel("claude-opus-4-8", true, "xhigh", opusEfforts, t),
      fallbackModel("claude-opus-4-7", false, "xhigh", opusEfforts, t),
      fallbackModel("claude-opus-4-6", false, "high", opusLegacyEfforts, t),
      fallbackModel("claude-sonnet-4-6", false, "high", sonnetEfforts, t),
      fallbackModel("claude-haiku-4-5", false, "", [], t),
    ],
  };
}

export function fallbackCursorCatalog(
  command = "cursor-agent",
  t: Translate = i18n.t.bind(i18n) as Translate,
): AssistantAgentCatalog {
  // Mirrors SymphonyElixir.Cursor.ModelCatalog: the cursor-agent CLI has no
  // reasoning-effort flag, so every model hides the effort menu; "auto" lets
  // the CLI pick its own default model.
  return {
    agent: "cursor",
    agentLabel: catalogAgentLabel("cursor", t),
    command,
    defaultModel: "auto",
    models: [
      fallbackModel("auto", true, "", [], t),
      fallbackModel("composer-1", false, "", [], t),
      fallbackModel("gpt-5", false, "", [], t),
      fallbackModel("sonnet-4", false, "", [], t),
      fallbackModel("sonnet-4-thinking", false, "", [], t),
    ],
  };
}

export function fallbackCatalogBundle(t: Translate = i18n.t.bind(i18n) as Translate): AssistantCatalogBundle {
  return {
    agents: [fallbackCodexCatalog(undefined, t), fallbackClaudeCatalog(undefined, t), fallbackCursorCatalog(undefined, t)],
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
    const agent: AgentKind = (parsed.agent === "codex" || parsed.agent === "claude" || parsed.agent === "cursor")
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

export function effortLabel(
  catalog: AssistantAgentCatalog,
  modelId: string,
  effort: AssistantEffort,
  t: Translate = i18n.t.bind(i18n) as Translate,
): string {
  const translated = effortLabelForId(effort, t);
  if (effort && translated !== effort) return translated;

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
  isDefault: boolean,
  defaultEffort: string,
  efforts: AssistantEffortOption[],
  t: Translate = i18n.t.bind(i18n) as Translate,
): AssistantModelOption {
  return {
    id: model,
    model,
    label: catalogModelLabel(model, t),
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
