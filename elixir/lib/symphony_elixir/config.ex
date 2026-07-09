defmodule SymphonyElixir.Config do
  @moduledoc """
  Runtime configuration loaded from `WORKFLOW.md`.

  Facade over the focused config modules — front-matter parsing/validation
  lives in `Config.Workflow`, tracker detection and board states in
  `Config.Tracker`, agent kind detection/validation in `Config.Agent` — plus
  the process-level getters kept here. All public functions are stable;
  callers do not need to know the split.
  """

  alias SymphonyElixir.Config.Agent
  alias SymphonyElixir.Config.Tracker
  alias SymphonyElixir.Config.Workflow
  alias SymphonyElixir.InstanceConfig
  alias SymphonyElixir.Settings.Orchestration, as: OrchestrationSettings

  @default_dev_server_port_range [4100, 4199]
  @default_assistant_draft_status "Triage"

  @type workflow_payload :: SymphonyElixir.Workflow.loaded_workflow()
  @type workspace_hooks :: %{
          after_create: String.t() | nil,
          before_run: String.t() | nil,
          after_run: String.t() | nil,
          before_remove: String.t() | nil,
          timeout_ms: pos_integer()
        }

  @spec current_workflow() :: {:ok, workflow_payload()} | {:error, term()}
  def current_workflow do
    SymphonyElixir.Workflow.current()
  end

  # ────────────────────────────────────────────────────────────
  # WORKFLOW.md parsing/validation (Config.Workflow)
  # ────────────────────────────────────────────────────────────

  @spec section(String.t()) :: map()
  defdelegate section(name), to: Workflow

  @spec workflow_front_matter() :: map()
  defdelegate workflow_front_matter, to: Workflow, as: :config

  @spec validate_front_matter(map()) :: map()
  defdelegate validate_front_matter(front_matter), to: Workflow

  @spec validate_workflow_config(map()) :: :ok | {:error, [String.t()]}
  defdelegate validate_workflow_config(front_matter), to: Workflow

  @spec portable_workflow_markdown(String.t()) :: String.t()
  defdelegate portable_workflow_markdown(markdown), to: Workflow

  @spec parse_workflow_markdown(String.t()) ::
          {:ok, %{front_matter: keyword(), body: String.t()}} | {:error, String.t()}
  defdelegate parse_workflow_markdown(markdown), to: Workflow

  # ────────────────────────────────────────────────────────────
  # Tracker detection + board states (Config.Tracker)
  # ────────────────────────────────────────────────────────────

  @spec tracker_kind() :: String.t()
  defdelegate tracker_kind, to: Tracker

  @spec tracker_sync_enabled?() :: boolean()
  defdelegate tracker_sync_enabled?, to: Tracker

  @spec active_states() :: [String.t()]
  defdelegate active_states, to: Tracker

  @spec terminal_states() :: [String.t()]
  defdelegate terminal_states, to: Tracker

  @spec field_states() :: [String.t()]
  defdelegate field_states, to: Tracker

  @spec workflow_statuses() :: [{String.t(), String.t(), boolean()}]
  defdelegate workflow_statuses, to: Tracker

  @spec dispatch_states() :: [String.t()]
  defdelegate dispatch_states, to: Tracker

  @spec wait_states() :: [String.t()]
  defdelegate wait_states, to: Tracker

  # ────────────────────────────────────────────────────────────
  # Agent kind detection/validation (Config.Agent)
  # ────────────────────────────────────────────────────────────

  @spec agent_kind() :: String.t()
  defdelegate agent_kind, to: Agent

  @spec configured_agent_kinds() :: [String.t()]
  defdelegate configured_agent_kinds, to: Agent

  @spec default_agent_kind() :: String.t()
  defdelegate default_agent_kind, to: Agent

  @spec agent_kind_from_config(map() | term()) :: String.t() | nil
  defdelegate agent_kind_from_config(front_matter), to: Agent

  # ────────────────────────────────────────────────────────────
  # Local tracker / backups
  # ────────────────────────────────────────────────────────────

  @spec local_tracker_database_path() :: String.t()
  def local_tracker_database_path do
    root = Application.get_env(:symphony_elixir, :root_dir, File.cwd!())

    env_path =
      case System.get_env("SYMPHONY_LOCAL_TRACKER_DATABASE") do
        path when is_binary(path) and path != "" -> expand_under_root(path, root)
        _ -> nil
      end

    repo_path =
      case Application.get_env(:symphony_elixir, SymphonyElixir.Repo) do
        config when is_list(config) -> Keyword.get(config, :database)
        _ -> nil
      end

    env_path || repo_path || local_database_path()
  end

  @spec local_database_path() :: String.t()
  def local_database_path do
    root = Application.get_env(:symphony_elixir, :root_dir, File.cwd!())

    section("local")
    |> Map.get("database_path")
    |> resolve_path_value(".symphony/tracker.sqlite3")
    |> expand_under_root(root)
  end

  @spec local_tracker_database_info() :: map()
  def local_tracker_database_info do
    path = local_tracker_database_path()

    size_bytes =
      case File.stat(path) do
        {:ok, %{size: size}} -> size
        _ -> 0
      end

    %{
      path: path,
      size_bytes: size_bytes,
      exists: File.exists?(path)
    }
  end

  @spec backup_local_dir() :: String.t()
  def backup_local_dir do
    Application.get_env(:symphony_elixir, :backup_local_dir, ".symphony/backups")
    |> resolve_path_value(".symphony/backups")
  end

  @spec backup_retention_days() :: pos_integer()
  def backup_retention_days do
    Application.get_env(:symphony_elixir, :backup_retention_days, 30)
    |> case do
      days when is_integer(days) and days > 0 -> days
      _ -> 30
    end
  end

  @spec local_project_slug() :: String.t() | nil
  def local_project_slug do
    section("local")
    |> Map.get("project_slug")
    |> Workflow.trim_string()
  end

  @spec local_api_token_env() :: String.t()
  def local_api_token_env do
    section("local")
    |> Map.get("api_token_env")
    |> Workflow.trim_string()
    |> case do
      nil -> "SYMPHONY_TRACKER_TOKEN"
      value -> value
    end
  end

  @spec local_assignee() :: String.t() | nil
  def local_assignee do
    section("local")
    |> Map.get("assignee")
    |> Workflow.trim_string()
  end

  # ────────────────────────────────────────────────────────────
  # Process-level getters
  # ────────────────────────────────────────────────────────────

  @spec assistant_draft_status() :: String.t()
  def assistant_draft_status do
    case section("assistant")["draft_status"] do
      value when is_binary(value) and value != "" -> String.trim(value)
      _ -> @default_assistant_draft_status
    end
  end

  @spec poll_interval_ms() :: pos_integer()
  def poll_interval_ms do
    InstanceConfig.poll_interval_ms()
  end

  @spec pr_monitor_interval_ms() :: pos_integer()
  def pr_monitor_interval_ms do
    InstanceConfig.pr_monitor_interval_ms()
  end

  @doc """
  Minimum spacing (ms) between successive GitHub read requests through the
  `GitHub.RequestGateway`. Defaults to 150.
  """
  @spec github_read_interval_ms() :: non_neg_integer()
  def github_read_interval_ms do
    get_in(validated_workflow_options(), [:github, :read_interval_ms])
  end

  @doc """
  Minimum spacing (ms) between successive GitHub mutation requests. GitHub advises
  at least one second between mutative requests. Defaults to 1000.
  """
  @spec github_mutation_interval_ms() :: non_neg_integer()
  def github_mutation_interval_ms do
    get_in(validated_workflow_options(), [:github, :mutation_interval_ms])
  end

  @doc """
  Maximum number of attempts a rate-limited GitHub request is retried before the
  rate-limit error is surfaced. Defaults to 4.
  """
  @spec github_max_retries() :: pos_integer()
  def github_max_retries do
    get_in(validated_workflow_options(), [:github, :max_retries])
  end

  @doc """
  Cap (ms) on the exponential backoff used when GitHub does not provide a
  `Retry-After` / `x-ratelimit-reset` hint. Defaults to 60000.
  """
  @spec github_max_backoff_ms() :: pos_integer()
  def github_max_backoff_ms do
    get_in(validated_workflow_options(), [:github, :max_backoff_ms])
  end

  @spec workspace_root() :: Path.t()
  def workspace_root do
    validated_workflow_options()
    |> get_in([:workspace, :root])
    |> resolve_path_value(Workflow.default_workspace_root())
  end

  @spec workspace_hooks() :: workspace_hooks()
  def workspace_hooks do
    hooks = get_in(validated_workflow_options(), [:hooks])

    %{
      after_create: Map.get(hooks, :after_create),
      before_run: Map.get(hooks, :before_run),
      after_run: Map.get(hooks, :after_run),
      before_remove: Map.get(hooks, :before_remove),
      timeout_ms: Map.get(hooks, :timeout_ms)
    }
  end

  @spec hook_timeout_ms() :: pos_integer()
  def hook_timeout_ms, do: InstanceConfig.hook_timeout_ms()

  @spec max_concurrent_agents() :: pos_integer()
  def max_concurrent_agents, do: InstanceConfig.max_concurrent_agents()

  @spec max_retry_backoff_ms() :: pos_integer()
  def max_retry_backoff_ms, do: InstanceConfig.max_retry_backoff_ms()

  @spec agent_max_turns() :: pos_integer()
  def agent_max_turns, do: InstanceConfig.default_max_turns()

  @spec agent_token_budget() :: non_neg_integer()
  def agent_token_budget, do: OrchestrationSettings.agent_token_budget()

  @spec agent_budget_max_retries() :: non_neg_integer()
  def agent_budget_max_retries, do: InstanceConfig.agent_budget_max_retries()

  @doc """
  Process-level fallback completion transitions. Per-project transitions are
  resolved from each project's `workflow_markdown` via `ProjectConfig`; this is
  only used when a project declares none. Defaults to an empty map.
  """
  @spec completion_transitions() :: %{String.t() => String.t()}
  def completion_transitions, do: InstanceConfig.completion_transitions()

  @spec max_concurrent_agents_for_state(term()) :: pos_integer()
  def max_concurrent_agents_for_state(state_name),
    do: InstanceConfig.max_concurrent_agents_for_state(state_name)

  @spec agent_turn_timeout_ms() :: pos_integer()
  def agent_turn_timeout_ms, do: InstanceConfig.turn_timeout_ms()

  @spec agent_read_timeout_ms() :: pos_integer()
  def agent_read_timeout_ms, do: InstanceConfig.read_timeout_ms()

  @spec agent_stall_timeout_ms() :: non_neg_integer()
  def agent_stall_timeout_ms, do: InstanceConfig.stall_timeout_ms()

  @spec workflow_prompt() :: String.t()
  def workflow_prompt do
    case current_workflow() do
      {:ok, %{prompt_template: prompt}} when is_binary(prompt) ->
        if String.trim(prompt) == "", do: SymphonyElixir.Tracker.default_prompt_template(), else: prompt

      _ ->
        SymphonyElixir.Tracker.default_prompt_template()
    end
  end

  @spec observability_enabled?() :: boolean()
  def observability_enabled?, do: InstanceConfig.observability_enabled?()

  @spec observability_refresh_ms() :: pos_integer()
  def observability_refresh_ms, do: InstanceConfig.observability_refresh_ms()

  @spec observability_render_interval_ms() :: pos_integer()
  def observability_render_interval_ms, do: InstanceConfig.observability_render_interval_ms()

  @spec observability_hub_url() :: String.t() | nil
  def observability_hub_url, do: InstanceConfig.observability_hub_url()

  @spec observability_heartbeat_interval_ms() :: pos_integer()
  def observability_heartbeat_interval_ms, do: InstanceConfig.observability_heartbeat_interval_ms()

  @spec observability_min_report_interval_ms() :: pos_integer()
  def observability_min_report_interval_ms,
    do: InstanceConfig.observability_min_report_interval_ms()

  @spec observability_label() :: String.t() | nil
  def observability_label, do: InstanceConfig.observability_label()

  @spec observability_runtime_id() :: String.t()
  def observability_runtime_id do
    InstanceConfig.observability_runtime_id() || "symphony"
  end

  @spec server_port() :: non_neg_integer() | nil
  def server_port, do: InstanceConfig.server_port()

  @spec server_host() :: String.t()
  def server_host, do: InstanceConfig.server_host()

  @spec editor_enabled?() :: boolean()
  def editor_enabled?, do: InstanceConfig.editor_enabled?()

  @spec editor_binary() :: String.t()
  def editor_binary, do: InstanceConfig.editor_binary()

  @spec editor_host() :: String.t()
  def editor_host, do: InstanceConfig.editor_host()

  @spec editor_port() :: pos_integer()
  def editor_port, do: InstanceConfig.editor_port()

  @spec editor_auth() :: String.t()
  def editor_auth, do: InstanceConfig.editor_auth()

  @spec editor_password() :: String.t() | nil
  def editor_password, do: InstanceConfig.editor_password()

  @spec editor_base_url() :: String.t()
  def editor_base_url, do: InstanceConfig.editor_base_url()

  @spec preview_pool_range() :: [pos_integer()]
  def preview_pool_range, do: InstanceConfig.preview_pool_range()

  @spec preview_slots_per_project() :: pos_integer()
  def preview_slots_per_project, do: InstanceConfig.preview_slots_per_project()

  @spec preview_ports_per_slot() :: pos_integer()
  def preview_ports_per_slot, do: InstanceConfig.preview_ports_per_slot()

  @spec dev_server_enabled?() :: boolean()
  def dev_server_enabled? do
    get_in(validated_workflow_options(), [:dev_server, :enabled])
  end

  @spec dev_server_port_range() :: [pos_integer()]
  def dev_server_port_range do
    get_in(validated_workflow_options(), [:dev_server, :port_range]) ||
      @default_dev_server_port_range
  end

  @spec dev_server_max_concurrent() :: pos_integer()
  def dev_server_max_concurrent do
    get_in(validated_workflow_options(), [:dev_server, :max_concurrent])
  end

  @spec dev_server_idle_timeout_ms() :: pos_integer()
  def dev_server_idle_timeout_ms do
    get_in(validated_workflow_options(), [:dev_server, :idle_timeout_ms])
  end

  @spec dev_server_auto_start_on() :: [String.t()]
  def dev_server_auto_start_on do
    get_in(validated_workflow_options(), [:dev_server, :auto_start_on])
  end

  @spec dev_server_base_url() :: String.t() | nil
  def dev_server_base_url do
    case get_in(validated_workflow_options(), [:dev_server, :base_url]) do
      url when is_binary(url) and url != "" -> String.trim_trailing(url, "/")
      _ -> nil
    end
  end

  @spec public_tunnel_enabled?() :: boolean()
  def public_tunnel_enabled? do
    get_in(validated_workflow_options(), [:public_tunnel, :enabled])
  end

  @spec public_tunnel_base_domain() :: String.t()
  def public_tunnel_base_domain do
    get_in(validated_workflow_options(), [:public_tunnel, :base_domain])
  end

  @spec public_tunnel_namespace() :: String.t() | nil
  def public_tunnel_namespace do
    get_in(validated_workflow_options(), [:public_tunnel, :namespace])
  end

  @spec validate!() :: :ok | {:error, String.t()}
  def validate! do
    with {:ok, _workflow} <- current_workflow(),
         :ok <- validate_completion_transitions!(),
         :ok <- Tracker.config_module().validate!(),
         :ok <- Agent.validate_configured_agents!() do
      :ok
    else
      {:error, reason} when is_binary(reason) ->
        {:error, reason}

      {:error, reason} ->
        {:error, "Invalid WORKFLOW.md: #{inspect(reason)}"}
    end
  end

  defp validate_completion_transitions! do
    allowed = MapSet.new(field_states())

    invalid =
      completion_transitions()
      |> Enum.flat_map(fn {source, destination} -> [source, destination] end)
      |> Enum.reject(&MapSet.member?(allowed, &1))
      |> Enum.uniq()

    case invalid do
      [] ->
        :ok

      names ->
        {:error, "agent.completion_transitions references states not in field_states: #{Enum.join(names, ", ")}"}
    end
  end

  defp validated_workflow_options do
    Workflow.validated_options()
  end

  defp resolve_path_value(:missing, default), do: default
  defp resolve_path_value(nil, default), do: default

  defp resolve_path_value(value, default) when is_binary(value) do
    case normalize_path_token(value) do
      :missing ->
        default

      path ->
        path
        |> String.trim()
        |> preserve_command_name()
        |> then(fn
          "" -> default
          resolved -> resolved
        end)
    end
  end

  defp resolve_path_value(_value, default), do: default

  defp preserve_command_name(path) do
    cond do
      uri_path?(path) ->
        path

      String.contains?(path, "/") or String.contains?(path, "\\") ->
        Path.expand(path)

      true ->
        path
    end
  end

  defp uri_path?(path) do
    String.match?(to_string(path), ~r/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)
  end

  defp normalize_path_token(value) when is_binary(value) do
    trimmed = String.trim(value)

    case env_reference_name(trimmed) do
      {:ok, env_name} -> resolve_env_token(env_name)
      :error -> trimmed
    end
  end

  defp env_reference_name("$" <> env_name) do
    if String.match?(env_name, ~r/^[A-Za-z_][A-Za-z0-9_]*$/) do
      {:ok, env_name}
    else
      :error
    end
  end

  defp env_reference_name(_value), do: :error

  defp resolve_env_token(value) do
    case System.get_env(value) do
      nil -> :missing
      env_value -> env_value
    end
  end

  defp expand_under_root(path, root) when is_binary(path) do
    if Path.type(path) == :absolute, do: path, else: Path.expand(path, root)
  end
end

