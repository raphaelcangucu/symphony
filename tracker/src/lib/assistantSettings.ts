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

// v2 storage keys — old keys are ignored; composer falls to defaults on upgrade.
// Composer choice is session-scoped so each browser/session can keep its own
// last agent/model without leaking into other work.
const COMPOSER_STATE_KEY = "symphony.assistant.composer.v2";

type Translate = TFunction;

export function catalogAgentLabel(
  agent: AgentKind,
  t: Translate = i18n.t.bind(i18n) as Translate,
): string {
  return t(`assistant.catalog.agents.${agent}`);
}

function effortLabelForId(id: string, t: Translate = i18n.t.bind(i18n) as Translate): string {
  if (!id) return "";
  const key = `assistant.effort.${id}`;
  const translated = t(key);
  return translated === key ? id : translated;
}

export function catalogFor(bundle: AssistantCatalogBundle, agent: AgentKind): AssistantAgentCatalog {
  const catalog = bundle.agents.find((candidate) => candidate.agent === agent);
  if (!catalog) throw new Error(`assistant catalog is unavailable for ${agent}`);
  return catalog;
}

export function loadComposerState(bundle: AssistantCatalogBundle): AssistantComposerState {
  const defaultState: AssistantComposerState = { agent: bundle.defaultAgent, byAgent: {} };

  if (typeof window === "undefined") return defaultState;

  try {
    const raw = window.sessionStorage.getItem(COMPOSER_STATE_KEY) ?? window.localStorage.getItem(COMPOSER_STATE_KEY);
    if (!raw) return defaultState;

    const parsed = JSON.parse(raw) as Partial<AssistantComposerState>;
    const agent: AgentKind = (
      parsed.agent === "codex"
      || parsed.agent === "claude"
      || parsed.agent === "cursor"
      || parsed.agent === "opencode"
    )
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
  window.sessionStorage.setItem(COMPOSER_STATE_KEY, JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// Per-catalog helpers — unchanged signatures; callers pass a single catalog
// ---------------------------------------------------------------------------

export function defaultComposerSettings(catalog: AssistantAgentCatalog): AssistantComposerSettings {
  const modelOption = pickDefaultModel(catalog);
  return {
    model: modelOption.model,
    effort: normalizeEffort(modelOption, modelOption.defaultEffort),
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
  if (
    model.defaultEffort &&
    model.efforts.some((option) => option.id === model.defaultEffort)
  ) {
    return model.defaultEffort;
  }
  return "";
}

function pickDefaultModel(catalog: AssistantAgentCatalog): AssistantModelOption {
  if (!catalog.defaultModel) {
    throw new Error(`assistant catalog has no default model for ${catalog.agent}`);
  }
  const model = findModelOption(catalog, catalog.defaultModel);
  if (!model) {
    throw new Error(
      `assistant catalog default model ${catalog.defaultModel} is unavailable for ${catalog.agent}`,
    );
  }
  return model;
}

function findModelOption(catalog: AssistantAgentCatalog, modelId?: string | null): AssistantModelOption | undefined {
  if (!modelId) return undefined;
  return catalog.models.find((model) => model.model === modelId || model.id === modelId);
}
