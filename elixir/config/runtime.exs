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

  editor_settings = SymphonyElixir.BootInstanceConfig.editor_settings()

  # Integer.parse (not parse_int) so invalid values yield nil and fall back to
  # poll_interval_ms at runtime instead of crashing boot.
  pr_monitor_interval_ms =
    case System.get_env("SYMPHONY_PR_MONITOR_INTERVAL_MS") do
      value when is_binary(value) and value != "" ->
        case Integer.parse(value) do
          {ms, ""} when ms > 0 -> ms
          _ -> nil
        end

      _ ->
        nil
    end

  config :symphony_elixir,
    poll_interval_ms: parse_int.("SYMPHONY_POLL_INTERVAL_MS", 60_000),
    pr_monitor_interval_ms: pr_monitor_interval_ms,
    tracker_sync_min_pull_ms: parse_int.("SYMPHONY_TRACKER_SYNC_MIN_PULL_MS", 60_000),
    tracker_pr_sync_ttl_ms: parse_int.("SYMPHONY_TRACKER_PR_SYNC_TTL_MS", 300_000),
    max_concurrent_agents: parse_int.("SYMPHONY_MAX_CONCURRENT_AGENTS", 10),
    default_max_turns: parse_int.("SYMPHONY_MAX_TURNS", 20),
    turn_timeout_ms: parse_int.("SYMPHONY_TURN_TIMEOUT_MS", 3_600_000),
    read_timeout_ms: parse_int.("SYMPHONY_READ_TIMEOUT_MS", 5_000),
    stall_timeout_ms: parse_int.("SYMPHONY_STALL_TIMEOUT_MS", 300_000),
    server_host: System.get_env("SYMPHONY_TRACKER_HOST") || "127.0.0.1",
    server_port: parse_int.("SYMPHONY_TRACKER_PORT", 4_000),
    editor_enabled: Keyword.fetch!(editor_settings, :editor_enabled),
    editor_binary: Keyword.fetch!(editor_settings, :editor_binary),
    editor_host: Keyword.fetch!(editor_settings, :editor_host),
    editor_port: Keyword.fetch!(editor_settings, :editor_port),
    editor_auth: Keyword.fetch!(editor_settings, :editor_auth),
    editor_password: Keyword.get(editor_settings, :editor_password),
    editor_base_url: Keyword.get(editor_settings, :editor_base_url),
    observability_enabled: System.get_env("SYMPHONY_OBSERVABILITY_ENABLED") != "false",
    observability_hub_url: maybe.("SYMPHONY_OBSERVABILITY_HUB_URL"),
    observability_label: maybe.("SYMPHONY_OBSERVABILITY_LABEL"),
    codex_command:
      System.get_env("SYMPHONY_CODEX_COMMAND") ||
        "codex --config shell_environment_policy.inherit=all app-server",
    codex_approval_policy: System.get_env("SYMPHONY_CODEX_APPROVAL_POLICY") || "never",
    codex_thread_sandbox: System.get_env("SYMPHONY_CODEX_THREAD_SANDBOX") || "workspace-write",
    claude_command: System.get_env("SYMPHONY_CLAUDE_COMMAND") || "claude",
    cursor_command: System.get_env("SYMPHONY_CURSOR_COMMAND") || "cursor-agent",
    default_agent_kind: System.get_env("SYMPHONY_DEFAULT_AGENT_KIND") || "codex",
    vapid_public_key: maybe.("SYMPHONY_VAPID_PUBLIC_KEY"),
    vapid_private_key: maybe.("SYMPHONY_VAPID_PRIVATE_KEY"),
    vapid_subject: System.get_env("SYMPHONY_VAPID_SUBJECT") || "mailto:symphony@localhost"

  vapid_public_key = maybe.("SYMPHONY_VAPID_PUBLIC_KEY")
  vapid_private_key = maybe.("SYMPHONY_VAPID_PRIVATE_KEY")
  vapid_subject = System.get_env("SYMPHONY_VAPID_SUBJECT") || "mailto:symphony@localhost"

  if vapid_public_key && vapid_private_key do
    config :web_push_elixir,
      vapid_public_key: vapid_public_key,
      vapid_private_key: vapid_private_key,
      vapid_subject: vapid_subject

    config :ex_nudge,
      vapid_public_key: vapid_public_key,
      vapid_private_key: vapid_private_key,
      vapid_subject: vapid_subject
  end
end
