defmodule SymphonyElixir.InstanceConfig do
  @moduledoc """
  Process-level (instance-wide) settings, sourced from `config/runtime.exs` and
  `SYMPHONY_*` environment variables.

  This replaces the process-global `WORKFLOW.md` for concerns that are inherently
  per-OS-process and cannot be per-project: the orchestrator poll loop, the global
  agent concurrency cap, the HTTP server bind, observability, the managed editor,
  and the default agent backend command/kind. Per-project behavior lives in each
  project's DB-owned `workflow_markdown` (see `SymphonyElixir.ProjectConfig`).
  Instance codex defaults (`approval_policy: never`) apply to freeform assistant
  chats and as a base for per-project `codex:` overrides.
  """

  @default_poll_interval_ms 60_000
  @default_tracker_sync_min_pull_ms 60_000
  @default_tracker_pr_sync_ttl_ms 300_000
  @default_max_concurrent_agents 10
  @default_max_turns 30
  @default_agent_token_budget 4_000_000
  @default_agent_budget_max_retries 2
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
  @default_codex_approval_policy "never"
  @default_codex_thread_sandbox "workspace-write"
  @default_claude_command "claude"
  @default_cursor_command "cursor-agent"
  @default_opencode_command "opencode"
  @default_agent_kind "codex"
  @default_preview_pool_range [10_000, 30_000]
  @default_preview_slots_per_project 32
  @default_preview_ports_per_slot 8

  @spec poll_interval_ms() :: pos_integer()
  def poll_interval_ms, do: get(:poll_interval_ms, @default_poll_interval_ms)

  @doc """
  PR follow-up monitor tick interval (ms). Defaults to `poll_interval_ms/0` when
  `SYMPHONY_PR_MONITOR_INTERVAL_MS` is unset or invalid.
  """
  @spec pr_monitor_interval_ms() :: pos_integer()
  def pr_monitor_interval_ms do
    case Application.get_env(:symphony_elixir, :pr_monitor_interval_ms) do
      ms when is_integer(ms) and ms > 0 -> ms
      _ -> poll_interval_ms()
    end
  end

  @doc """
  Minimum spacing (ms) between successive remote pulls for a single project in the
  background tracker sync. A pull requested within this window is coalesced into a
  push-only sync, so a fast orchestrator poll cannot multiply GitHub reads.
  Defaults to #{@default_tracker_sync_min_pull_ms}.
  """
  @spec tracker_sync_min_pull_ms() :: non_neg_integer()
  def tracker_sync_min_pull_ms,
    do: get(:tracker_sync_min_pull_ms, @default_tracker_sync_min_pull_ms)

  @doc """
  TTL (ms) for re-enriching an issue's pull requests during a background sync. An
  issue whose PRs were synced within this window is skipped on the next pull.
  Defaults to #{@default_tracker_pr_sync_ttl_ms}.
  """
  @spec tracker_pr_sync_ttl_ms() :: non_neg_integer()
  def tracker_pr_sync_ttl_ms,
    do: get(:tracker_pr_sync_ttl_ms, @default_tracker_pr_sync_ttl_ms)

  @spec max_concurrent_agents() :: pos_integer()
  def max_concurrent_agents, do: get(:max_concurrent_agents, @default_max_concurrent_agents)

  @spec max_concurrent_agents_for_state(term()) :: pos_integer()
  def max_concurrent_agents_for_state(state) when is_binary(state) do
    normalized = normalize_state(state)

    :max_concurrent_agents_by_state
    |> get(%{})
    |> Map.new(fn {k, v} -> {normalize_state(to_string(k)), v} end)
    |> Map.get(normalized, max_concurrent_agents())
  end

  def max_concurrent_agents_for_state(_state), do: max_concurrent_agents()

  @spec default_max_turns() :: pos_integer()
  def default_max_turns, do: get(:default_max_turns, @default_max_turns)

  @doc """
  Legacy env/config hook for a per-run token ceiling. Runtime orchestrator
  enforcement reads `Settings.Orchestration.agent_token_budget/0` instead.
  `0` disables the guard. Defaults to #{@default_agent_token_budget}.
  """
  @spec agent_token_budget() :: non_neg_integer()
  def agent_token_budget, do: max(0, get(:agent_token_budget, 0))

  @doc """
  How many times a run that overruns its token budget may be re-dispatched before
  it is parked for human attention instead of retried. Bounds budget-overrun
  loops. Defaults to #{@default_agent_budget_max_retries}.
  """
  @spec agent_budget_max_retries() :: non_neg_integer()
  def agent_budget_max_retries, do: max(0, get(:agent_budget_max_retries, @default_agent_budget_max_retries))

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

  @spec server_port() :: non_neg_integer() | nil
  def server_port do
    case Application.get_env(:symphony_elixir, :server_port_override) do
      port when is_integer(port) and port >= 0 ->
        port

      _ ->
        # Read directly (not via get/2) so an explicit `nil` (e.g. test config,
        # which suppresses the HTTP listener) is honored rather than coalesced
        # to the default port.
        Application.get_env(:symphony_elixir, :server_port, @default_server_port)
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

  @spec codex_approval_policy() :: String.t()
  def codex_approval_policy, do: get(:codex_approval_policy, @default_codex_approval_policy)

  @spec codex_thread_sandbox() :: String.t()
  def codex_thread_sandbox, do: get(:codex_thread_sandbox, @default_codex_thread_sandbox)

  @spec codex_section() :: map()
  def codex_section do
    %{
      "command" => codex_command(),
      "approval_policy" => codex_approval_policy(),
      "thread_sandbox" => codex_thread_sandbox()
    }
  end

  @spec merge_codex_section(map()) :: map()
  def merge_codex_section(%{} = project_section) do
    Map.merge(codex_section(), project_section)
  end

  @spec claude_command() :: String.t()
  def claude_command, do: get(:claude_command, @default_claude_command)

  @spec cursor_command() :: String.t()
  def cursor_command, do: get(:cursor_command, @default_cursor_command)

  @spec opencode_command() :: String.t()
  def opencode_command, do: get(:opencode_command, @default_opencode_command)

  @spec default_agent_kind() :: String.t()
  def default_agent_kind, do: get(:default_agent_kind, @default_agent_kind)

  @doc """
  Inclusive `[low, high]` global TCP port pool that preview dev servers draw from.
  Projects lease non-overlapping bands inside this range. Falls back to
  #{inspect(@default_preview_pool_range)} when unset or malformed.
  """
  @spec preview_pool_range() :: [pos_integer()]
  def preview_pool_range do
    case Application.get_env(:symphony_elixir, :preview_pool_range) do
      [low, high]
      when is_integer(low) and is_integer(high) and low > 0 and high > low ->
        [low, high]

      _ ->
        @default_preview_pool_range
    end
  end

  @doc """
  Number of issue slots reserved per project band. Falls back to
  #{@default_preview_slots_per_project} when unset or non-positive.
  """
  @spec preview_slots_per_project() :: pos_integer()
  def preview_slots_per_project do
    case Application.get_env(:symphony_elixir, :preview_slots_per_project) do
      n when is_integer(n) and n > 0 -> n
      _ -> @default_preview_slots_per_project
    end
  end

  @doc """
  Number of contiguous ports reserved per issue slot (i.e. the max number of
  serve steps a single issue can host). Falls back to
  #{@default_preview_ports_per_slot} when unset or non-positive.
  """
  @spec preview_ports_per_slot() :: pos_integer()
  def preview_ports_per_slot do
    case Application.get_env(:symphony_elixir, :preview_ports_per_slot) do
      n when is_integer(n) and n > 0 -> n
      _ -> @default_preview_ports_per_slot
    end
  end

  defp get(key, default) do
    case Application.get_env(:symphony_elixir, key, default) do
      nil -> default
      value -> value
    end
  end

  defp normalize_state(state), do: state |> String.trim() |> String.downcase()

  defp browser_host("0.0.0.0"), do: "127.0.0.1"
  defp browser_host("::"), do: "[::1]"
  defp browser_host(host) when is_binary(host) and host != "", do: host
  defp browser_host(_host), do: "127.0.0.1"
end
