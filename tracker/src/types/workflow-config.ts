export interface WorkflowConfigTracker {
  active_states?: string[];
  dispatch_states?: string[];
  wait_states?: string[];
  terminal_states?: string[];
  field_states?: string[];
}

export interface WorkflowConfigAgent {
  max_turns?: number;
  max_concurrent_agents?: number;
  max_retry_backoff_ms?: number;
  max_concurrent_agents_by_state?: Record<string, number>;
  completion_transitions?: Record<string, string>;
  turn_timeout_ms?: number;
  read_timeout_ms?: number;
  stall_timeout_ms?: number;
}

export interface WorkflowConfigHooks {
  after_create?: string | null;
  before_run?: string | null;
  after_run?: string | null;
  before_remove?: string | null;
  timeout_ms?: number;
}

export interface WorkflowConfigWorkspace {
  root?: string | null;
}

export interface WorkflowConfigEditor {
  enabled?: boolean;
  binary?: string;
  host?: string;
  port?: number;
  auth?: "none" | "password";
  password?: string | null;
  base_url?: string | null;
}

export interface WorkflowConfigDevServer {
  enabled?: boolean;
  port_range?: number[];
  max_concurrent?: number;
  idle_timeout_ms?: number;
  auto_start_on?: Array<"pull_request" | "human_review">;
  base_url?: string | null;
}

export interface WorkflowConfigPublicTunnel {
  enabled?: boolean;
  base_domain?: string;
  namespace?: string | null;
}

export interface WorkflowConfigGithub {
  read_interval_ms?: number;
  mutation_interval_ms?: number;
  max_retries?: number;
  max_backoff_ms?: number;
}

export interface WorkflowConfig {
  tracker?: WorkflowConfigTracker;
  agent?: WorkflowConfigAgent;
  hooks?: WorkflowConfigHooks;
  workspace?: WorkflowConfigWorkspace;
  editor?: WorkflowConfigEditor;
  dev_server?: WorkflowConfigDevServer;
  public_tunnel?: WorkflowConfigPublicTunnel;
  github?: WorkflowConfigGithub;
  // process-level sections (server/observability/polling) are intentionally not modeled here
}
