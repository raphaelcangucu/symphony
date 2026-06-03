import type {
  WorkflowConfig,
  WorkflowConfigDevServer,
  WorkflowConfigEditor,
  WorkflowConfigGithub,
  WorkflowConfigHooks,
  WorkflowConfigPublicTunnel,
} from "@/types/workflow-config";

export interface WorkflowConfigForm {
  tracker: {
    active_states: string[];
    dispatch_states: string[];
    wait_states: string[];
    terminal_states: string[];
    field_states: string[];
  };
  agent: {
    max_turns?: number;
    max_concurrent_agents?: number;
    max_retry_backoff_ms?: number;
    turn_timeout_ms?: number;
    read_timeout_ms?: number;
    stall_timeout_ms?: number;
    max_concurrent_agents_by_state: Record<string, number>;
    completion_transitions: Record<string, string>;
  };
  hooks: Required<Pick<WorkflowConfigHooks, "after_create" | "before_run" | "after_run" | "before_remove">> & {
    timeout_ms?: number;
  };
  workspace: { root: string };
  editor: {
    enabled: boolean;
    binary: string;
    host: string;
    port?: number;
    auth: "none" | "password";
    password: string;
    base_url: string;
  };
  dev_server: {
    enabled: boolean;
    port_range: string; // comma-separated; parsed on build
    max_concurrent?: number;
    idle_timeout_ms?: number;
    auto_start_on: Array<"pull_request" | "human_review">;
    base_url: string;
  };
  public_tunnel: { enabled: boolean; base_domain: string; namespace: string };
  github: {
    read_interval_ms?: number;
    mutation_interval_ms?: number;
    max_retries?: number;
    max_backoff_ms?: number;
  };
}

export function workflowConfigToForm(config: WorkflowConfig | undefined): WorkflowConfigForm {
  const c = config ?? {};
  return {
    tracker: {
      active_states: c.tracker?.active_states ?? [],
      dispatch_states: c.tracker?.dispatch_states ?? [],
      wait_states: c.tracker?.wait_states ?? [],
      terminal_states: c.tracker?.terminal_states ?? [],
      field_states: c.tracker?.field_states ?? [],
    },
    agent: {
      max_turns: c.agent?.max_turns,
      max_concurrent_agents: c.agent?.max_concurrent_agents,
      max_retry_backoff_ms: c.agent?.max_retry_backoff_ms,
      turn_timeout_ms: c.agent?.turn_timeout_ms,
      read_timeout_ms: c.agent?.read_timeout_ms,
      stall_timeout_ms: c.agent?.stall_timeout_ms,
      max_concurrent_agents_by_state: c.agent?.max_concurrent_agents_by_state ?? {},
      completion_transitions: c.agent?.completion_transitions ?? {},
    },
    hooks: {
      after_create: c.hooks?.after_create ?? "",
      before_run: c.hooks?.before_run ?? "",
      after_run: c.hooks?.after_run ?? "",
      before_remove: c.hooks?.before_remove ?? "",
      timeout_ms: c.hooks?.timeout_ms,
    },
    workspace: { root: c.workspace?.root ?? "" },
    editor: {
      enabled: c.editor?.enabled ?? false,
      binary: c.editor?.binary ?? "",
      host: c.editor?.host ?? "",
      port: c.editor?.port,
      auth: c.editor?.auth ?? "none",
      password: c.editor?.password ?? "",
      base_url: c.editor?.base_url ?? "",
    },
    dev_server: {
      enabled: c.dev_server?.enabled ?? false,
      port_range: (c.dev_server?.port_range ?? []).join(", "),
      max_concurrent: c.dev_server?.max_concurrent,
      idle_timeout_ms: c.dev_server?.idle_timeout_ms,
      auto_start_on: c.dev_server?.auto_start_on ?? [],
      base_url: c.dev_server?.base_url ?? "",
    },
    public_tunnel: {
      enabled: c.public_tunnel?.enabled ?? false,
      base_domain: c.public_tunnel?.base_domain ?? "",
      namespace: c.public_tunnel?.namespace ?? "",
    },
    github: {
      read_interval_ms: c.github?.read_interval_ms,
      mutation_interval_ms: c.github?.mutation_interval_ms,
      max_retries: c.github?.max_retries,
      max_backoff_ms: c.github?.max_backoff_ms,
    },
  };
}

function pruneEmpty<T extends Record<string, unknown>>(section: T): Partial<T> | undefined {
  const entries = Object.entries(section).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value as object).length > 0;
    return true;
  });
  return entries.length > 0 ? (Object.fromEntries(entries) as Partial<T>) : undefined;
}

function parsePortRange(value: string): number[] {
  return value
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export function buildWorkflowConfig(form: WorkflowConfigForm): WorkflowConfig {
  // Prune falsy booleans/"none" auth: absent === false/"none" in the schema, so dropping them keeps configs minimal and round-trips losslessly.
  const editor: WorkflowConfigEditor = {
    enabled: form.editor.enabled || undefined,
    binary: form.editor.binary || undefined,
    host: form.editor.host || undefined,
    port: form.editor.port,
    auth: form.editor.auth !== "none" ? form.editor.auth : undefined,
    password: form.editor.password || undefined,
    base_url: form.editor.base_url || undefined,
  };
  const devPorts = parsePortRange(form.dev_server.port_range);
  const devServer: WorkflowConfigDevServer = {
    enabled: form.dev_server.enabled || undefined,
    port_range: devPorts.length ? devPorts : undefined,
    max_concurrent: form.dev_server.max_concurrent,
    idle_timeout_ms: form.dev_server.idle_timeout_ms,
    auto_start_on: form.dev_server.auto_start_on.length ? form.dev_server.auto_start_on : undefined,
    base_url: form.dev_server.base_url || undefined,
  };
  const tunnel: WorkflowConfigPublicTunnel = {
    enabled: form.public_tunnel.enabled || undefined,
    base_domain: form.public_tunnel.base_domain || undefined,
    namespace: form.public_tunnel.namespace || undefined,
  };
  const github: WorkflowConfigGithub = {
    read_interval_ms: form.github.read_interval_ms,
    mutation_interval_ms: form.github.mutation_interval_ms,
    max_retries: form.github.max_retries,
    max_backoff_ms: form.github.max_backoff_ms,
  };
  const hooks: WorkflowConfigHooks = {
    after_create: form.hooks.after_create || undefined,
    before_run: form.hooks.before_run || undefined,
    after_run: form.hooks.after_run || undefined,
    before_remove: form.hooks.before_remove || undefined,
    timeout_ms: form.hooks.timeout_ms,
  };

  const config: WorkflowConfig = {
    tracker: pruneEmpty(form.tracker),
    agent: pruneEmpty(form.agent),
    hooks: pruneEmpty(hooks as Record<string, unknown>) as WorkflowConfigHooks | undefined,
    workspace: pruneEmpty(form.workspace) as WorkflowConfig["workspace"],
    editor: pruneEmpty(editor as Record<string, unknown>) as WorkflowConfigEditor | undefined,
    dev_server: pruneEmpty(devServer as Record<string, unknown>) as WorkflowConfigDevServer | undefined,
    public_tunnel: pruneEmpty(tunnel as Record<string, unknown>) as WorkflowConfigPublicTunnel | undefined,
    github: pruneEmpty(github as Record<string, unknown>) as WorkflowConfigGithub | undefined,
  };

  return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)) as WorkflowConfig;
}
