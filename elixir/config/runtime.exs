import Config

# Process-level (instance-wide) settings, read from SYMPHONY_* environment
# variables at boot. These replace the process-global WORKFLOW.md for concerns
# that are inherently per-OS-process (poll loop, global concurrency cap, HTTP
# bind, observability, managed editor, default agent backend). Per-project
# behavior lives in each project's DB-owned workflow_markdown.
#
# Tests stay hermetic: they control these via Application.put_env, so runtime.exs
# does not read the environment under :test (SymphonyElixir.InstanceConfig falls
# back to its module defaults).
if config_env() != :test do
  parse_int = fn name, default ->
    case System.get_env(name) do
      value when is_binary(value) and value != "" -> String.to_integer(value)
      _ -> default
    end
  end

  maybe = fn name ->
    case System.get_env(name) do
      value when is_binary(value) and value != "" -> value
      _ -> nil
    end
  end

  config :symphony_elixir,
    poll_interval_ms: parse_int.("SYMPHONY_POLL_INTERVAL_MS", 5_000),
    max_concurrent_agents: parse_int.("SYMPHONY_MAX_CONCURRENT_AGENTS", 10),
    default_max_turns: parse_int.("SYMPHONY_MAX_TURNS", 20),
    turn_timeout_ms: parse_int.("SYMPHONY_TURN_TIMEOUT_MS", 3_600_000),
    read_timeout_ms: parse_int.("SYMPHONY_READ_TIMEOUT_MS", 5_000),
    stall_timeout_ms: parse_int.("SYMPHONY_STALL_TIMEOUT_MS", 300_000),
    server_host: System.get_env("SYMPHONY_TRACKER_HOST") || "127.0.0.1",
    server_port: parse_int.("SYMPHONY_TRACKER_PORT", 4_000),
    editor_enabled: System.get_env("SYMPHONY_EDITOR_ENABLED") == "true",
    editor_binary: System.get_env("SYMPHONY_EDITOR_BINARY") || "code-server",
    editor_host: System.get_env("SYMPHONY_EDITOR_HOST") || "127.0.0.1",
    editor_port: parse_int.("SYMPHONY_EDITOR_PORT", 4_002),
    editor_auth: System.get_env("SYMPHONY_EDITOR_AUTH") || "none",
    editor_password: maybe.("SYMPHONY_EDITOR_PASSWORD"),
    editor_base_url: maybe.("SYMPHONY_EDITOR_BASE_URL"),
    observability_enabled: System.get_env("SYMPHONY_OBSERVABILITY_ENABLED") != "false",
    observability_hub_url: maybe.("SYMPHONY_OBSERVABILITY_HUB_URL"),
    observability_label: maybe.("SYMPHONY_OBSERVABILITY_LABEL"),
    codex_command:
      System.get_env("SYMPHONY_CODEX_COMMAND") ||
        "codex --config shell_environment_policy.inherit=all app-server",
    claude_command: System.get_env("SYMPHONY_CLAUDE_COMMAND") || "symphony-claude",
    default_agent_kind: System.get_env("SYMPHONY_DEFAULT_AGENT_KIND") || "codex"
end
