import type { ScalarDescriptor } from "./ScalarField";

export const AGENT_SCALAR_FIELDS: ScalarDescriptor[] = [
  { key: "max_turns", label: "Max turns", kind: "number" },
  { key: "max_concurrent_agents", label: "Max concurrent agents", kind: "number" },
  { key: "max_retry_backoff_ms", label: "Max retry backoff (ms)", kind: "number" },
  { key: "turn_timeout_ms", label: "Turn timeout (ms)", kind: "number" },
  { key: "read_timeout_ms", label: "Read timeout (ms)", kind: "number" },
  { key: "stall_timeout_ms", label: "Stall timeout (ms)", kind: "number" },
];

export const EDITOR_SCALAR_FIELDS: ScalarDescriptor[] = [
  { key: "enabled", label: "Enabled", kind: "boolean" },
  { key: "binary", label: "Binary", kind: "string", placeholder: "code-server" },
  { key: "host", label: "Host", kind: "string" },
  { key: "port", label: "Port", kind: "number" },
  { key: "auth", label: "Auth", kind: "enum", options: ["none", "password"] },
  { key: "password", label: "Password", kind: "string" },
  { key: "base_url", label: "Base URL", kind: "string" },
];

export const DEV_SERVER_SCALAR_FIELDS: ScalarDescriptor[] = [
  { key: "enabled", label: "Enabled", kind: "boolean" },
  { key: "max_concurrent", label: "Max concurrent", kind: "number" },
  { key: "idle_timeout_ms", label: "Idle timeout (ms)", kind: "number" },
  { key: "base_url", label: "Base URL", kind: "string" },
];

export const PUBLIC_TUNNEL_SCALAR_FIELDS: ScalarDescriptor[] = [
  { key: "enabled", label: "Enabled", kind: "boolean" },
  { key: "base_domain", label: "Base domain", kind: "string" },
  { key: "namespace", label: "Namespace", kind: "string" },
];

export const GITHUB_SCALAR_FIELDS: ScalarDescriptor[] = [
  { key: "read_interval_ms", label: "Read interval (ms)", kind: "number" },
  { key: "mutation_interval_ms", label: "Mutation interval (ms)", kind: "number" },
  { key: "max_retries", label: "Max retries", kind: "number" },
  { key: "max_backoff_ms", label: "Max backoff (ms)", kind: "number" },
];

export const HOOK_FIELDS = ["after_create", "before_run", "after_run", "before_remove"] as const;

export const DEV_SERVER_AUTO_START_OPTIONS = ["pull_request", "human_review"] as const;
