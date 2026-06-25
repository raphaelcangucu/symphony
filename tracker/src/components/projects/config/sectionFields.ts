import type { TFunction } from "i18next";

import { i18n } from "@/i18n";
import type { ScalarDescriptor } from "./ScalarField";

type Translate = TFunction;

function label(key: string, t: Translate): string {
  return t(`project.config.scalar.${key}`);
}

export function agentScalarFields(t: Translate = i18n.t.bind(i18n) as Translate): ScalarDescriptor[] {
  return [
    { key: "max_turns", label: label("maxTurns", t), kind: "number" },
    { key: "max_concurrent_agents", label: label("maxConcurrentAgents", t), kind: "number" },
    { key: "max_retry_backoff_ms", label: label("maxRetryBackoffMs", t), kind: "number" },
    { key: "turn_timeout_ms", label: label("turnTimeoutMs", t), kind: "number" },
    { key: "read_timeout_ms", label: label("readTimeoutMs", t), kind: "number" },
    { key: "stall_timeout_ms", label: label("stallTimeoutMs", t), kind: "number" },
  ];
}

export function editorScalarFields(t: Translate = i18n.t.bind(i18n) as Translate): ScalarDescriptor[] {
  return [
    { key: "enabled", label: label("enabled", t), kind: "boolean" },
    { key: "binary", label: label("binary", t), kind: "string", placeholder: "code-server" },
    { key: "host", label: label("host", t), kind: "string" },
    { key: "port", label: label("port", t), kind: "number" },
    { key: "auth", label: label("auth", t), kind: "enum", options: ["none", "password"] },
    { key: "password", label: label("password", t), kind: "string" },
    { key: "base_url", label: label("baseUrl", t), kind: "string" },
  ];
}

export function devServerScalarFields(t: Translate = i18n.t.bind(i18n) as Translate): ScalarDescriptor[] {
  return [
    { key: "enabled", label: label("enabled", t), kind: "boolean" },
    { key: "max_concurrent", label: label("maxConcurrent", t), kind: "number" },
    { key: "idle_timeout_ms", label: label("idleTimeoutMs", t), kind: "number" },
    { key: "base_url", label: label("baseUrl", t), kind: "string" },
  ];
}

export function publicTunnelScalarFields(t: Translate = i18n.t.bind(i18n) as Translate): ScalarDescriptor[] {
  return [
    { key: "enabled", label: label("enabled", t), kind: "boolean" },
    { key: "base_domain", label: label("baseDomain", t), kind: "string" },
    { key: "namespace", label: label("namespace", t), kind: "string" },
  ];
}

export function githubScalarFields(t: Translate = i18n.t.bind(i18n) as Translate): ScalarDescriptor[] {
  return [
    { key: "read_interval_ms", label: label("readIntervalMs", t), kind: "number" },
    { key: "mutation_interval_ms", label: label("mutationIntervalMs", t), kind: "number" },
    { key: "max_retries", label: label("maxRetries", t), kind: "number" },
    { key: "max_backoff_ms", label: label("maxBackoffMs", t), kind: "number" },
  ];
}

/** @deprecated Use agentScalarFields(t) */
export const AGENT_SCALAR_FIELDS = agentScalarFields();

/** @deprecated Use editorScalarFields(t) */
export const EDITOR_SCALAR_FIELDS = editorScalarFields();

/** @deprecated Use devServerScalarFields(t) */
export const DEV_SERVER_SCALAR_FIELDS = devServerScalarFields();

/** @deprecated Use publicTunnelScalarFields(t) */
export const PUBLIC_TUNNEL_SCALAR_FIELDS = publicTunnelScalarFields();

/** @deprecated Use githubScalarFields(t) */
export const GITHUB_SCALAR_FIELDS = githubScalarFields();

export const HOOK_FIELDS = ["after_create", "before_run", "after_run", "before_remove"] as const;

export const DEV_SERVER_AUTO_START_OPTIONS = ["pull_request", "human_review"] as const;
