defmodule SymphonyElixir.InstanceConfig do
  @moduledoc """
  Process-level (instance-wide) settings, sourced from `config/runtime.exs` and
  `SYMPHONY_*` environment variables.

  This replaces the process-global `WORKFLOW.md` for concerns that are inherently
  per-OS-process and cannot be per-project: the orchestrator poll loop, the global
  agent concurrency cap, the HTTP server bind, observability, the managed editor,
  and the default agent backend command/kind. Per-project behavior lives in each
  project's `workflow_markdown` (see `SymphonyElixir.ProjectConfig`).
  """

  @default_poll_interval_ms 5_000
  @default_max_concurrent_agents 10
  @default_max_turns 20
  @default_max_retry_backoff_ms 300_000
  @default_turn_timeout_ms 3_600_000
  @default_read_timeout_ms 5_000
  @default_stall_timeout_ms 300_000
  @default_hook_timeout_ms 60_000
  @default_server_host "127.0.0.1"
  @default_server_port 4000
  @default_editor_enabled false
  @default_editor_binary "code-server"
  @default_editor_host "127.0.0.1"
  @default_editor_port 4002
  @default_editor_auth "none"
  @default_observability_enabled true
  @default_observability_refresh_ms 1_000
  @default_observability_render_interval_ms 16
  @default_observability_heartbeat_interval_ms 5_000
  @default_observability_min_report_interval_ms 250
  @default_codex_command "codex --config shell_environment_policy.inherit=all app-server"
  @default_claude_command "symphony-claude"
  @default_agent_kind "codex"

  @spec poll_interval_ms() :: pos_integer()
  def poll_interval_ms, do: get(:poll_interval_ms, @default_poll_interval_ms)

  @spec max_concurrent_agents() :: pos_integer()
  def max_concurrent_agents, do: get(:max_concurrent_agents, @default_max_concurrent_agents)

  @spec max_concurrent_agents_for_state(term()) :: pos_integer()
  def max_concurrent_agents_for_state(_state), do: max_concurrent_agents()

  @spec default_max_turns() :: pos_integer()
  def default_max_turns, do: get(:default_max_turns, @default_max_turns)

  @spec max_retry_backoff_ms() :: pos_integer()
  def max_retry_backoff_ms, do: get(:max_retry_backoff_ms, @default_max_retry_backoff_ms)

  @spec turn_timeout_ms() :: pos_integer()
  def turn_timeout_ms, do: get(:turn_timeout_ms, @default_turn_timeout_ms)

  @spec read_timeout_ms() :: pos_integer()
  def read_timeout_ms, do: get(:read_timeout_ms, @default_read_timeout_ms)

  @spec stall_timeout_ms() :: non_neg_integer()
  def stall_timeout_ms, do: max(0, get(:stall_timeout_ms, @default_stall_timeout_ms))

  @spec hook_timeout_ms() :: pos_integer()
  def hook_timeout_ms, do: get(:hook_timeout_ms, @default_hook_timeout_ms)

  @spec completion_transitions() :: map()
  def completion_transitions, do: get(:completion_transitions, %{})

  @spec server_host() :: String.t()
  def server_host, do: get(:server_host, @default_server_host)

  @spec server_port() :: non_neg_integer()
  def server_port do
    case Application.get_env(:symphony_elixir, :server_port_override) do
      port when is_integer(port) and port >= 0 -> port
      _ -> get(:server_port, @default_server_port)
    end
  end

  @spec editor_enabled?() :: boolean()
  def editor_enabled?, do: get(:editor_enabled, @default_editor_enabled)

  @spec editor_binary() :: String.t()
  def editor_binary, do: get(:editor_binary, @default_editor_binary)

  @spec editor_host() :: String.t()
  def editor_host, do: get(:editor_host, @default_editor_host)

  @spec editor_port() :: pos_integer()
  def editor_port, do: get(:editor_port, @default_editor_port)

  @spec editor_auth() :: String.t()
  def editor_auth, do: get(:editor_auth, @default_editor_auth)

  @spec editor_password() :: String.t() | nil
  def editor_password, do: get(:editor_password, nil)

  @spec editor_base_url() :: String.t()
  def editor_base_url do
    case get(:editor_base_url, nil) do
      url when is_binary(url) and url != "" -> String.trim_trailing(url, "/")
      _ -> "http://#{browser_host(editor_host())}:#{editor_port()}"
    end
  end

  @spec observability_enabled?() :: boolean()
  def observability_enabled?, do: get(:observability_enabled, @default_observability_enabled)

  @spec observability_refresh_ms() :: pos_integer()
  def observability_refresh_ms,
    do: get(:observability_refresh_ms, @default_observability_refresh_ms)

  @spec observability_render_interval_ms() :: pos_integer()
  def observability_render_interval_ms,
    do: get(:observability_render_interval_ms, @default_observability_render_interval_ms)

  @spec observability_hub_url() :: String.t() | nil
  def observability_hub_url, do: get(:observability_hub_url, nil)

  @spec observability_heartbeat_interval_ms() :: pos_integer()
  def observability_heartbeat_interval_ms,
    do: get(:observability_heartbeat_interval_ms, @default_observability_heartbeat_interval_ms)

  @spec observability_min_report_interval_ms() :: pos_integer()
  def observability_min_report_interval_ms,
    do: get(:observability_min_report_interval_ms, @default_observability_min_report_interval_ms)

  @spec observability_label() :: String.t() | nil
  def observability_label, do: get(:observability_label, nil)

  @spec observability_runtime_id() :: String.t() | nil
  def observability_runtime_id, do: get(:observability_runtime_id, nil)

  @spec codex_command() :: String.t()
  def codex_command, do: get(:codex_command, @default_codex_command)

  @spec claude_command() :: String.t()
  def claude_command, do: get(:claude_command, @default_claude_command)

  @spec default_agent_kind() :: String.t()
  def default_agent_kind, do: get(:default_agent_kind, @default_agent_kind)

  defp get(key, default) do
    case Application.get_env(:symphony_elixir, key, default) do
      nil -> default
      value -> value
    end
  end

  defp browser_host("0.0.0.0"), do: "127.0.0.1"
  defp browser_host(host) when is_binary(host) and host != "", do: host
  defp browser_host(_host), do: "127.0.0.1"
end
