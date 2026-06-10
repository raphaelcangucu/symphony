defmodule SymphonyElixir.Config do
  @moduledoc """
  Runtime configuration loaded from `WORKFLOW.md`.
  """

  alias NimbleOptions
  alias SymphonyElixir.InstanceConfig
  alias SymphonyElixir.Workflow

  @default_active_states ["Todo", "In Progress"]
  @default_terminal_states ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]
  @default_poll_interval_ms 60_000
  @default_workspace_root Path.join(System.tmp_dir!(), "symphony_workspaces")
  @default_hook_timeout_ms 60_000
  @default_max_concurrent_agents 10
  @default_agent_max_turns 20
  @default_max_retry_backoff_ms 300_000
  @default_agent_turn_timeout_ms 3_600_000
  @default_agent_read_timeout_ms 5_000
  @default_agent_stall_timeout_ms 300_000
  @default_observability_enabled true
  @default_observability_refresh_ms 1_000
  @default_observability_render_interval_ms 16
  @default_observability_heartbeat_interval_ms 5_000
  @default_observability_min_report_interval_ms 250
  @default_server_host "127.0.0.1"
  @default_editor_enabled false
  @default_editor_binary "code-server"
  @default_editor_host "127.0.0.1"
  @default_editor_port 4002
  @default_editor_auth "none"
  @default_dev_server_enabled false
  @default_dev_server_port_range [4100, 4199]
  @default_dev_server_max_concurrent 3
  @default_dev_server_idle_timeout_ms 1_800_000
  @default_dev_server_auto_start_on ["pull_request", "human_review"]
  @default_public_tunnel_enabled false
  @default_public_tunnel_base_domain "tracker.cods.dev"
  @default_assistant_draft_status "Triage"
  @default_github_read_interval_ms 150
  @default_github_mutation_interval_ms 1_000
  @default_github_max_retries 4
  @default_github_max_backoff_ms 60_000

  @tracker_sections ["local", "linear", "jira", "github", "memory"]
  @agent_sections ["claude", "codex"]

  # Type expectations for the per-project workflow_config sections that
  # `validate_workflow_config/1` strictly validates. Each entry is
  # `{section_key, [{field_key, expected_type}]}`. Sections/keys not listed here
  # (e.g. codex:/claude:/linear:/local:) are validated by their own modules.
  @strict_workflow_sections %{
    "tracker" => [
      {"active_states", :string_list},
      {"terminal_states", :string_list},
      {"field_states", :string_list},
      {"dispatch_states", :string_list},
      {"wait_states", :string_list}
    ],
    "polling" => [{"interval_ms", :integer}],
    "workspace" => [{"root", :string}],
    "github" => [
      {"read_interval_ms", :integer},
      {"mutation_interval_ms", :integer},
      {"max_retries", :integer},
      {"max_backoff_ms", :integer}
    ],
    "agent" => [
      {"max_concurrent_agents", :integer},
      {"max_turns", :integer},
      {"max_retry_backoff_ms", :integer},
      {"max_concurrent_agents_by_state", :map},
      {"completion_transitions", :map},
      {"turn_timeout_ms", :integer},
      {"read_timeout_ms", :integer},
      {"stall_timeout_ms", :integer}
    ],
    "hooks" => [
      {"after_create", :string},
      {"before_run", :string},
      {"after_run", :string},
      {"before_remove", :string},
      {"timeout_ms", :integer}
    ]
  }

  @workflow_options_schema NimbleOptions.new!(
                             tracker: [
                               type: :map,
                               default: %{},
                               keys: [
                                 active_states: [
                                   type: {:list, :string},
                                   default: @default_active_states
                                 ],
                                 terminal_states: [
                                   type: {:list, :string},
                                   default: @default_terminal_states
                                 ],
                                 field_states: [
                                   type: {:list, :string},
                                   default: []
                                 ],
                                 dispatch_states: [
                                   type: {:list, :string},
                                   default: []
                                 ],
                                 wait_states: [
                                   type: {:list, :string},
                                   default: []
                                 ]
                               ]
                             ],
                             polling: [
                               type: :map,
                               default: %{},
                               keys: [
                                 interval_ms: [type: :integer, default: @default_poll_interval_ms]
                               ]
                             ],
                             github: [
                               type: :map,
                               default: %{},
                               keys: [
                                 read_interval_ms: [
                                   type: :non_neg_integer,
                                   default: @default_github_read_interval_ms
                                 ],
                                 mutation_interval_ms: [
                                   type: :non_neg_integer,
                                   default: @default_github_mutation_interval_ms
                                 ],
                                 max_retries: [
                                   type: :pos_integer,
                                   default: @default_github_max_retries
                                 ],
                                 max_backoff_ms: [
                                   type: :pos_integer,
                                   default: @default_github_max_backoff_ms
                                 ]
                               ]
                             ],
                             workspace: [
                               type: :map,
                               default: %{},
                               keys: [
                                 root: [type: {:or, [:string, nil]}, default: @default_workspace_root]
                               ]
                             ],
                             agent: [
                               type: :map,
                               default: %{},
                               keys: [
                                 max_concurrent_agents: [
                                   type: :integer,
                                   default: @default_max_concurrent_agents
                                 ],
                                 max_turns: [
                                   type: :pos_integer,
                                   default: @default_agent_max_turns
                                 ],
                                 max_retry_backoff_ms: [
                                   type: :pos_integer,
                                   default: @default_max_retry_backoff_ms
                                 ],
                                 max_concurrent_agents_by_state: [
                                   type: {:map, :string, :pos_integer},
                                   default: %{}
                                 ],
                                 completion_transitions: [
                                   type: {:map, :string, :string},
                                   default: %{}
                                 ],
                                 turn_timeout_ms: [
                                   type: :integer,
                                   default: @default_agent_turn_timeout_ms
                                 ],
                                 read_timeout_ms: [
                                   type: :integer,
                                   default: @default_agent_read_timeout_ms
                                 ],
                                 stall_timeout_ms: [
                                   type: :integer,
                                   default: @default_agent_stall_timeout_ms
                                 ]
                               ]
                             ],
                             hooks: [
                               type: :map,
                               default: %{},
                               keys: [
                                 after_create: [type: {:or, [:string, nil]}, default: nil],
                                 before_run: [type: {:or, [:string, nil]}, default: nil],
                                 after_run: [type: {:or, [:string, nil]}, default: nil],
                                 before_remove: [type: {:or, [:string, nil]}, default: nil],
                                 timeout_ms: [type: :pos_integer, default: @default_hook_timeout_ms]
                               ]
                             ],
                             observability: [
                               type: :map,
                               default: %{},
                               keys: [
                                 dashboard_enabled: [
                                   type: :boolean,
                                   default: @default_observability_enabled
                                 ],
                                 refresh_ms: [
                                   type: :integer,
                                   default: @default_observability_refresh_ms
                                 ],
                                 render_interval_ms: [
                                   type: :integer,
                                   default: @default_observability_render_interval_ms
                                 ],
                                 hub_url: [type: {:or, [:string, nil]}, default: nil],
                                 heartbeat_interval_ms: [
                                   type: :pos_integer,
                                   default: @default_observability_heartbeat_interval_ms
                                 ],
                                 min_report_interval_ms: [
                                   type: :pos_integer,
                                   default: @default_observability_min_report_interval_ms
                                 ],
                                 label: [type: {:or, [:string, nil]}, default: nil],
                                 runtime_id: [type: {:or, [:string, nil]}, default: nil]
                               ]
                             ],
                             server: [
                               type: :map,
                               default: %{},
                               keys: [
                                 port: [type: {:or, [:non_neg_integer, nil]}, default: nil],
                                 host: [type: :string, default: @default_server_host]
                               ]
                             ],
                             editor: [
                               type: :map,
                               default: %{},
                               keys: [
                                 enabled: [type: :boolean, default: @default_editor_enabled],
                                 binary: [type: :string, default: @default_editor_binary],
                                 host: [type: :string, default: @default_editor_host],
                                 port: [type: :pos_integer, default: @default_editor_port],
                                 auth: [
                                   type: {:in, ["none", "password"]},
                                   default: @default_editor_auth
                                 ],
                                 password: [type: {:or, [:string, nil]}, default: nil],
                                 base_url: [type: {:or, [:string, nil]}, default: nil]
                               ]
                             ],
                             dev_server: [
                               type: :map,
                               default: %{},
                               keys: [
                                 enabled: [type: :boolean, default: @default_dev_server_enabled],
                                 port_range: [type: {:list, :pos_integer}, default: @default_dev_server_port_range],
                                 max_concurrent: [type: :pos_integer, default: @default_dev_server_max_concurrent],
                                 idle_timeout_ms: [type: :pos_integer, default: @default_dev_server_idle_timeout_ms],
                                 auto_start_on: [
                                   type: {:list, {:in, ["pull_request", "human_review"]}},
                                   default: @default_dev_server_auto_start_on
                                 ],
                                 base_url: [type: {:or, [:string, nil]}, default: nil]
                               ]
                             ],
                             public_tunnel: [
                               type: :map,
                               default: %{},
                               keys: [
                                 enabled: [type: :boolean, default: @default_public_tunnel_enabled],
                                 base_domain: [
                                   type: :string,
                                   default: @default_public_tunnel_base_domain
                                 ],
                                 namespace: [type: {:or, [:string, nil]}, default: nil]
                               ]
                             ],
                             evidence: [
                               type: :map,
                               default: %{},
                               keys: [
                                 test_command: [type: {:map, :string, :string}, default: %{}],
                                 e2e_command: [type: {:map, :string, :string}, default: %{}],
                                 ui_paths: [type: {:list, :string}, default: []],
                                 required: [type: :boolean, default: false]
                               ]
                             ]
                           )

  @type workflow_payload :: Workflow.loaded_workflow()
  @type workspace_hooks :: %{
          after_create: String.t() | nil,
          before_run: String.t() | nil,
          after_run: String.t() | nil,
          before_remove: String.t() | nil,
          timeout_ms: pos_integer()
        }

  @spec current_workflow() :: {:ok, workflow_payload()} | {:error, term()}
  def current_workflow do
    Workflow.current()
  end

  @spec section(String.t()) :: map()
  def section(name) when is_binary(name) do
    section_map(workflow_config(), name)
  end

  @spec tracker_kind() :: String.t()
  def tracker_kind do
    case detect_sections(@tracker_sections) do
      [] -> "github"
      [kind | _] -> kind
    end
  end

  @spec tracker_sync_enabled?() :: boolean()
  def tracker_sync_enabled? do
    :symphony_elixir
    |> Application.get_env(:tracker, [])
    |> fetch_sync_enabled()
    |> truthy?()
  end

  defp fetch_sync_enabled(config) when is_list(config), do: Keyword.get(config, :sync_enabled, false)
  defp fetch_sync_enabled(%{} = config), do: Map.get(config, :sync_enabled, false)
  defp fetch_sync_enabled(_config), do: false

  defp truthy?(true), do: true
  defp truthy?("true"), do: true
  defp truthy?("1"), do: true
  defp truthy?(_other), do: false

  @spec active_states() :: [String.t()]
  def active_states do
    get_in(validated_workflow_options(), [:tracker, :active_states])
  end

  @spec terminal_states() :: [String.t()]
  def terminal_states do
    get_in(validated_workflow_options(), [:tracker, :terminal_states])
  end

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
    |> trim_string()
  end

  @spec local_api_token_env() :: String.t()
  def local_api_token_env do
    section("local")
    |> Map.get("api_token_env")
    |> trim_string()
    |> case do
      nil -> "SYMPHONY_TRACKER_TOKEN"
      value -> value
    end
  end

  @spec local_assignee() :: String.t() | nil
  def local_assignee do
    section("local")
    |> Map.get("assignee")
    |> trim_string()
  end

  @spec workflow_front_matter() :: map()
  def workflow_front_matter, do: workflow_config()

  @spec validate_front_matter(map()) :: map()
  def validate_front_matter(front_matter) when is_map(front_matter) do
    front_matter
    |> normalize_keys()
    |> extract_workflow_options()
    |> NimbleOptions.validate!(@workflow_options_schema)
  end

  @doc """
  Strictly validates a per-project `workflow_config` map.

  Unlike `validate_front_matter/1` (which leniently coerces/omits malformed
  values for the operator-owned global file), this rejects type-mismatched
  values for the known per-project sections so that a malformed config is
  caught at the save boundary instead of silently coerced. Absent sections and
  `nil` values are accepted (they inherit the global defaults).
  """
  @spec validate_workflow_config(map()) :: :ok | {:error, [String.t()]}
  def validate_workflow_config(front_matter) when is_map(front_matter) do
    normalized = normalize_keys(front_matter)

    issues =
      @strict_workflow_sections
      |> Enum.flat_map(fn {section, fields} ->
        strict_section_issues(section, Map.get(normalized, section), fields)
      end)
      |> Enum.sort()

    if issues == [], do: :ok, else: {:error, issues}
  end

  def validate_workflow_config(_front_matter), do: {:error, ["workflow_config must be a mapping"]}

  # Sections that must NOT appear in a per-project `workflow_markdown`: connection
  # identity (form/DB-owned) and process-level settings (env/runtime-owned).
  @forbidden_per_project_sections ~w(github linear local server observability polling editor)

  @doc """
  Parses per-project WORKFLOW markdown (YAML front matter + prompt body).

  Validates that only per-project behavior keys are present (rejecting connection
  and process-level sections), strictly type-checks the known sections, and
  returns the normalized (atom-keyed) front matter plus the prompt body.
  """
  @spec parse_workflow_markdown(String.t()) ::
          {:ok, %{front_matter: keyword(), body: String.t()}} | {:error, String.t()}
  def parse_workflow_markdown(markdown) when is_binary(markdown) do
    with {:ok, %{config: raw, prompt: body}} <- SymphonyElixir.Workflow.parse_string(markdown),
         :ok <- reject_forbidden_sections(raw),
         :ok <- validate_workflow_config(raw),
         {:ok, front_matter} <- safe_validate_front_matter(raw) do
      {:ok, %{front_matter: front_matter, body: body}}
    else
      {:error, issues} when is_list(issues) -> {:error, Enum.join(issues, "; ")}
      {:error, reason} -> {:error, inspect(reason)}
    end
  end

  defp reject_forbidden_sections(raw) when is_map(raw) do
    normalized = normalize_keys(raw)
    present = Enum.filter(@forbidden_per_project_sections, &Map.has_key?(normalized, &1))

    if present == [] do
      :ok
    else
      {:error, ["not allowed in per-project workflow: #{Enum.join(present, ", ")} (set these as process/connection config)"]}
    end
  end

  defp reject_forbidden_sections(_raw), do: {:error, ["front matter must be a mapping"]}

  defp safe_validate_front_matter(raw) do
    {:ok, validate_front_matter(raw)}
  rescue
    error -> {:error, [Exception.message(error)]}
  end

  @doc """
  Resolves the agent kind from a project's own front-matter map.

  Precedence: explicit `agent.kind` > exactly-one-section inference
  (`codex:`/`claude:`) > nil (= inherit; resolved later by
  `SymphonyElixir.AgentPreference`).
  """
  @spec agent_kind_from_config(map() | term()) :: String.t() | nil
  def agent_kind_from_config(front_matter) when is_map(front_matter) do
    normalized = normalize_keys(front_matter)

    explicit_agent_kind(normalized) ||
      case Enum.filter(@agent_sections, &Map.has_key?(normalized, &1)) do
        [single] -> single
        _ -> nil
      end
  end

  def agent_kind_from_config(_front_matter), do: nil

  defp explicit_agent_kind(normalized) do
    case Map.get(normalized, "agent") do
      %{} = section -> SymphonyElixir.AgentPreference.normalize(Map.get(section, "kind"))
      _ -> nil
    end
  end

  @spec assistant_draft_status() :: String.t()
  def assistant_draft_status do
    case section("assistant")["draft_status"] do
      value when is_binary(value) and value != "" -> String.trim(value)
      _ -> @default_assistant_draft_status
    end
  end

  @doc """
  All states provisioned on the GitHub Project `Status` field.

  Defaults to `active_states` plus `terminal_states` (unique, order preserved).
  Use `field_states` in WORKFLOW when the board needs options such as `Backlog`
  that are not polled or dispatched.
  """
  @spec field_states() :: [String.t()]
  def field_states do
    case field_states_from_workflow() do
      [] -> (active_states() ++ terminal_states()) |> Enum.uniq()
      states -> states
    end
  end

  defp field_states_from_workflow do
    validated_workflow_options()
    |> get_in([:tracker, :field_states])
    |> case do
      states when is_list(states) -> states |> Enum.map(&to_string/1) |> Enum.uniq()
      _ -> []
    end
  end

  @doc """
  Workflow statuses derived from the configured board states, ordered to match
  `field_states/0`. Each entry is `{name, category, is_terminal}` where the
  category is inferred from the `terminal_states`/`wait_states`/`active_states`
  lists. Used to seed a project's status set locally so the tracker stays
  local-first when a remote board cannot be reached.
  """
  @spec workflow_statuses() :: [{String.t(), String.t(), boolean()}]
  def workflow_statuses do
    terminal = MapSet.new(terminal_states())
    wait = MapSet.new(wait_states())
    active = MapSet.new(active_states())

    Enum.map(field_states(), fn name ->
      cond do
        MapSet.member?(terminal, name) -> {name, "terminal", true}
        MapSet.member?(wait, name) -> {name, "wait", false}
        MapSet.member?(active, name) -> {name, "active", false}
        true -> {name, "backlog", false}
      end
    end)
  end

  @doc """
  States that may start a new agent run. Defaults to `active_states/0`.
  """
  @spec dispatch_states() :: [String.t()]
  def dispatch_states do
    case get_in(validated_workflow_options(), [:tracker, :dispatch_states]) do
      states when is_list(states) and states != [] ->
        states |> Enum.map(&to_string/1) |> Enum.uniq()

      _ ->
        active_states()
    end
  end

  @doc """
  Active states where an existing run should stop after the current turn (e.g. Human Review).
  """
  @spec wait_states() :: [String.t()]
  def wait_states do
    get_in(validated_workflow_options(), [:tracker, :wait_states])
    |> case do
      states when is_list(states) -> states |> Enum.map(&to_string/1) |> Enum.uniq()
      _ -> []
    end
  end

  @spec agent_kind() :: String.t()
  def agent_kind, do: default_agent_kind()

  @spec configured_agent_kinds() :: [String.t()]
  def configured_agent_kinds do
    detect_sections(@agent_sections)
  end

  @doc """
  Default agent when an issue only has the base `symphony` label.

  Prefers Codex when a (legacy) global WORKFLOW configures it, then the first
  configured agent. With global-less per-project orchestration there is usually
  no global agent section, so the process-level default falls back to the
  `:default_agent_kind` application setting and finally the `codex` code default.
  """
  @spec default_agent_kind() :: String.t()
  def default_agent_kind, do: InstanceConfig.default_agent_kind()

  @spec poll_interval_ms() :: pos_integer()
  def poll_interval_ms do
    InstanceConfig.poll_interval_ms()
  end

  @doc """
  Minimum spacing (ms) between successive GitHub read requests through the
  `GitHub.RequestGateway`. Defaults to #{@default_github_read_interval_ms}.
  """
  @spec github_read_interval_ms() :: non_neg_integer()
  def github_read_interval_ms do
    get_in(validated_workflow_options(), [:github, :read_interval_ms])
  end

  @doc """
  Minimum spacing (ms) between successive GitHub mutation requests. GitHub advises
  at least one second between mutative requests. Defaults to
  #{@default_github_mutation_interval_ms}.
  """
  @spec github_mutation_interval_ms() :: non_neg_integer()
  def github_mutation_interval_ms do
    get_in(validated_workflow_options(), [:github, :mutation_interval_ms])
  end

  @doc """
  Maximum number of attempts a rate-limited GitHub request is retried before the
  rate-limit error is surfaced. Defaults to #{@default_github_max_retries}.
  """
  @spec github_max_retries() :: pos_integer()
  def github_max_retries do
    get_in(validated_workflow_options(), [:github, :max_retries])
  end

  @doc """
  Cap (ms) on the exponential backoff used when GitHub does not provide a
  `Retry-After` / `x-ratelimit-reset` hint. Defaults to
  #{@default_github_max_backoff_ms}.
  """
  @spec github_max_backoff_ms() :: pos_integer()
  def github_max_backoff_ms do
    get_in(validated_workflow_options(), [:github, :max_backoff_ms])
  end

  @spec workspace_root() :: Path.t()
  def workspace_root do
    validated_workflow_options()
    |> get_in([:workspace, :root])
    |> resolve_path_value(@default_workspace_root)
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

  @spec dev_server_enabled?() :: boolean()
  def dev_server_enabled? do
    get_in(validated_workflow_options(), [:dev_server, :enabled])
  end

  @spec dev_server_port_range() :: [pos_integer()]
  def dev_server_port_range do
    get_in(validated_workflow_options(), [:dev_server, :port_range])
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
         :ok <- tracker_config_module().validate!(),
         :ok <- validate_configured_agents!() do
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

  defp validate_configured_agents! do
    case configured_agent_kinds() do
      [] ->
        {:error, "No agent configured — add a codex: or claude: section to WORKFLOW.md"}

      kinds ->
        validate_agent_kinds(kinds)
    end
  end

  defp validate_agent_kinds(kinds) do
    Enum.reduce_while(kinds, :ok, fn kind, :ok ->
      case validate_agent_kind!(kind) do
        :ok -> {:cont, :ok}
        {:error, _} = error -> {:halt, error}
      end
    end)
  end

  defp validate_agent_kind!("codex"), do: SymphonyElixir.Codex.Config.validate!()
  defp validate_agent_kind!("claude"), do: SymphonyElixir.Claude.Config.validate!()
  defp validate_agent_kind!(other), do: {:error, "Unknown agent kind #{inspect(other)} in WORKFLOW.md"}

  defp tracker_config_module do
    case tracker_kind() do
      "local" -> SymphonyElixir.LocalTracker.Config
      "linear" -> SymphonyElixir.Linear.Config
      "jira" -> SymphonyElixir.Jira.Config
      "github" -> SymphonyElixir.GitHub.Config
      "memory" -> SymphonyElixir.Memory.Config
    end
  end

  defp detect_sections(section_names) do
    config = workflow_config()
    Enum.filter(section_names, &Map.has_key?(config, &1))
  end

  defp validated_workflow_options do
    validate_front_matter(workflow_config())
  end

  defp extract_workflow_options(config) do
    %{
      tracker: extract_tracker_options(section_map(config, "tracker")),
      polling: extract_polling_options(section_map(config, "polling")),
      github: extract_github_options(section_map(config, "github")),
      workspace: extract_workspace_options(section_map(config, "workspace")),
      agent: extract_agent_options(section_map(config, "agent")),
      hooks: extract_hooks_options(section_map(config, "hooks")),
      observability: extract_observability_options(section_map(config, "observability")),
      server: extract_server_options(section_map(config, "server")),
      editor: extract_editor_options(section_map(config, "editor")),
      dev_server: extract_dev_server_options(section_map(config, "dev_server")),
      public_tunnel: extract_public_tunnel_options(section_map(config, "public_tunnel")),
      evidence: extract_evidence_options(section_map(config, "evidence"))
    }
  end

  defp extract_tracker_options(section) do
    %{}
    |> put_if_present(:active_states, csv_value(Map.get(section, "active_states")))
    |> put_if_present(:terminal_states, csv_value(Map.get(section, "terminal_states")))
    |> put_if_present(:field_states, csv_value(Map.get(section, "field_states")))
    |> put_if_present(:dispatch_states, csv_value(Map.get(section, "dispatch_states")))
    |> put_if_present(:wait_states, csv_value(Map.get(section, "wait_states")))
  end

  defp extract_polling_options(section) do
    %{}
    |> put_if_present(:interval_ms, integer_value(Map.get(section, "interval_ms")))
  end

  defp extract_github_options(section) do
    %{}
    |> put_if_present(:read_interval_ms, integer_value(Map.get(section, "read_interval_ms")))
    |> put_if_present(:mutation_interval_ms, integer_value(Map.get(section, "mutation_interval_ms")))
    |> put_if_present(:max_retries, positive_integer_value(Map.get(section, "max_retries")))
    |> put_if_present(:max_backoff_ms, positive_integer_value(Map.get(section, "max_backoff_ms")))
  end

  defp extract_workspace_options(section) do
    %{}
    |> put_if_present(:root, binary_value(Map.get(section, "root")))
  end

  defp extract_agent_options(section) do
    %{}
    |> put_if_present(:max_concurrent_agents, integer_value(Map.get(section, "max_concurrent_agents")))
    |> put_if_present(:max_turns, positive_integer_value(Map.get(section, "max_turns")))
    |> put_if_present(:max_retry_backoff_ms, positive_integer_value(Map.get(section, "max_retry_backoff_ms")))
    |> put_if_present(
      :max_concurrent_agents_by_state,
      state_limits_value(Map.get(section, "max_concurrent_agents_by_state"))
    )
    |> put_if_present(
      :completion_transitions,
      string_map_value(Map.get(section, "completion_transitions"))
    )
    |> put_if_present(:turn_timeout_ms, integer_value(Map.get(section, "turn_timeout_ms")))
    |> put_if_present(:read_timeout_ms, integer_value(Map.get(section, "read_timeout_ms")))
    |> put_if_present(:stall_timeout_ms, integer_value(Map.get(section, "stall_timeout_ms")))
  end

  defp extract_hooks_options(section) do
    %{}
    |> put_if_present(:after_create, hook_command_value(Map.get(section, "after_create")))
    |> put_if_present(:before_run, hook_command_value(Map.get(section, "before_run")))
    |> put_if_present(:after_run, hook_command_value(Map.get(section, "after_run")))
    |> put_if_present(:before_remove, hook_command_value(Map.get(section, "before_remove")))
    |> put_if_present(:timeout_ms, positive_integer_value(Map.get(section, "timeout_ms")))
  end

  defp extract_observability_options(section) do
    %{}
    |> put_if_present(:dashboard_enabled, boolean_value(Map.get(section, "dashboard_enabled")))
    |> put_if_present(:refresh_ms, integer_value(Map.get(section, "refresh_ms")))
    |> put_if_present(:render_interval_ms, integer_value(Map.get(section, "render_interval_ms")))
    |> put_if_present(:hub_url, scalar_string_value(Map.get(section, "hub_url")))
    |> put_if_present(
      :heartbeat_interval_ms,
      positive_integer_value(Map.get(section, "heartbeat_interval_ms"))
    )
    |> put_if_present(
      :min_report_interval_ms,
      positive_integer_value(Map.get(section, "min_report_interval_ms"))
    )
    |> put_if_present(:label, scalar_string_value(Map.get(section, "label")))
    |> put_if_present(:runtime_id, scalar_string_value(Map.get(section, "runtime_id")))
  end

  defp extract_server_options(section) do
    %{}
    |> put_if_present(:port, non_negative_integer_value(Map.get(section, "port")))
    |> put_if_present(:host, scalar_string_value(Map.get(section, "host")))
  end

  defp extract_editor_options(section) do
    %{}
    |> put_if_present(:enabled, boolean_value(Map.get(section, "enabled")))
    |> put_if_present(:binary, binary_value(Map.get(section, "binary")))
    |> put_if_present(:host, scalar_string_value(Map.get(section, "host")))
    |> put_if_present(:port, positive_integer_value(Map.get(section, "port")))
    |> put_if_present(:auth, scalar_string_value(Map.get(section, "auth")))
    |> put_if_present(:password, scalar_string_value(Map.get(section, "password")))
    |> put_if_present(:base_url, scalar_string_value(Map.get(section, "base_url")))
  end

  defp extract_dev_server_options(section) do
    %{}
    |> put_if_present(:enabled, boolean_value(Map.get(section, "enabled")))
    |> put_if_present(:port_range, integer_list_value(Map.get(section, "port_range")))
    |> put_if_present(:max_concurrent, positive_integer_value(Map.get(section, "max_concurrent")))
    |> put_if_present(:idle_timeout_ms, positive_integer_value(Map.get(section, "idle_timeout_ms")))
    |> put_if_present(:auto_start_on, csv_value(Map.get(section, "auto_start_on")))
    |> put_if_present(:base_url, scalar_string_value(Map.get(section, "base_url")))
  end

  defp extract_public_tunnel_options(section) do
    %{}
    |> put_if_present(:enabled, boolean_value(Map.get(section, "enabled")))
    |> put_if_present(:base_domain, scalar_string_value(Map.get(section, "base_domain")))
    |> put_if_present(:namespace, scalar_string_value(Map.get(section, "namespace")))
  end

  defp extract_evidence_options(section) do
    %{}
    |> put_if_present(:test_command, string_map_value(Map.get(section, "test_command")))
    |> put_if_present(:e2e_command, string_map_value(Map.get(section, "e2e_command")))
    |> put_if_present(:ui_paths, csv_value(Map.get(section, "ui_paths")))
    |> put_if_present(:required, boolean_value(Map.get(section, "required")))
  end

  # Map of repo-subdir => command string; non-string entries are dropped.
  defp string_map_value(value) when is_map(value) do
    value
    |> Enum.flat_map(fn {key, command} ->
      case {scalar_string_value(key), scalar_string_value(command)} do
        {repo, cmd} when is_binary(repo) and is_binary(cmd) -> [{repo, cmd}]
        _invalid -> []
      end
    end)
    |> Map.new()
  end

  defp string_map_value(_value), do: :omit

  defp section_map(config, key) do
    case Map.get(config, key) do
      section when is_map(section) -> section
      _ -> %{}
    end
  end

  defp strict_section_issues(_section, nil, _fields), do: []

  defp strict_section_issues(section, value, _fields) when not is_map(value),
    do: ["#{section} must be a mapping"]

  defp strict_section_issues(section, section_map, fields) do
    Enum.flat_map(fields, fn {field, type} ->
      case Map.get(section_map, field) do
        nil ->
          []

        field_value ->
          if valid_strict_type?(type, field_value),
            do: [],
            else: ["#{section}.#{field} #{strict_type_hint(type)}"]
      end
    end)
  end

  defp valid_strict_type?(:string_list, value), do: is_list(value) or is_binary(value)

  defp valid_strict_type?(:integer, value) do
    is_integer(value) or (is_binary(value) and match?({:ok, _}, parse_integer(value)))
  end

  defp valid_strict_type?(:string, value), do: is_binary(value)
  defp valid_strict_type?(:map, value), do: is_map(value)

  defp strict_type_hint(:string_list), do: "must be a list or comma-separated string"
  defp strict_type_hint(:integer), do: "must be an integer"
  defp strict_type_hint(:string), do: "must be a string"
  defp strict_type_hint(:map), do: "must be a mapping"

  defp put_if_present(map, _key, :omit), do: map
  defp put_if_present(map, key, value), do: Map.put(map, key, value)

  defp scalar_string_value(nil), do: :omit
  defp scalar_string_value(value) when is_binary(value), do: String.trim(value)
  defp scalar_string_value(value) when is_boolean(value), do: to_string(value)
  defp scalar_string_value(value) when is_integer(value), do: to_string(value)
  defp scalar_string_value(value) when is_float(value), do: to_string(value)
  defp scalar_string_value(value) when is_atom(value), do: Atom.to_string(value)
  defp scalar_string_value(_value), do: :omit

  defp trim_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp trim_string(_value), do: nil

  defp binary_value(value, opts \\ [])

  defp binary_value(value, opts) when is_binary(value) do
    allow_empty = Keyword.get(opts, :allow_empty, false)

    if value == "" and not allow_empty do
      :omit
    else
      value
    end
  end

  defp binary_value(_value, _opts), do: :omit

  defp hook_command_value(value) when is_binary(value) do
    case String.trim(value) do
      "" -> :omit
      _ -> String.trim_trailing(value)
    end
  end

  defp hook_command_value(_value), do: :omit

  defp csv_value(values) when is_list(values) do
    values
    |> Enum.reduce([], fn value, acc -> maybe_append_csv_value(acc, value) end)
    |> Enum.reverse()
    |> case do
      [] -> :omit
      normalized_values -> normalized_values
    end
  end

  defp csv_value(value) when is_binary(value) do
    value
    |> String.split(",", trim: true)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> case do
      [] -> :omit
      normalized_values -> normalized_values
    end
  end

  defp csv_value(_value), do: :omit

  defp maybe_append_csv_value(acc, value) do
    case scalar_string_value(value) do
      :omit ->
        acc

      normalized ->
        append_csv_value_if_present(acc, normalized)
    end
  end

  defp append_csv_value_if_present(acc, value) do
    trimmed = String.trim(value)

    if trimmed == "" do
      acc
    else
      [trimmed | acc]
    end
  end

  defp integer_value(value) do
    case parse_integer(value) do
      {:ok, parsed} -> parsed
      :error -> :omit
    end
  end

  defp positive_integer_value(value) do
    case parse_positive_integer(value) do
      {:ok, parsed} -> parsed
      :error -> :omit
    end
  end

  defp non_negative_integer_value(value) do
    case parse_non_negative_integer(value) do
      {:ok, parsed} -> parsed
      :error -> :omit
    end
  end

  defp integer_list_value(values) when is_list(values) do
    case Enum.filter(values, &is_integer/1) do
      [] -> :omit
      parsed -> parsed
    end
  end

  defp integer_list_value(_value), do: :omit

  defp boolean_value(value) when is_boolean(value), do: value

  defp boolean_value(value) when is_binary(value) do
    case String.downcase(String.trim(value)) do
      "true" -> true
      "false" -> false
      _ -> :omit
    end
  end

  defp boolean_value(_value), do: :omit

  defp state_limits_value(value) when is_map(value) do
    value
    |> Enum.reduce(%{}, fn {state_name, limit}, acc ->
      case parse_positive_integer(limit) do
        {:ok, parsed} ->
          Map.put(acc, normalize_issue_state(to_string(state_name)), parsed)

        :error ->
          acc
      end
    end)
  end

  defp state_limits_value(_value), do: :omit

  defp string_map_value(value) when is_map(value) do
    value
    |> Enum.reduce(%{}, fn
      {key, val}, acc when is_binary(key) and is_binary(val) ->
        case {String.trim(key), String.trim(val)} do
          {"", _} -> acc
          {_, ""} -> acc
          {trimmed_key, trimmed_val} -> Map.put(acc, trimmed_key, trimmed_val)
        end

      {_key, _val}, acc ->
        acc
    end)
  end

  defp string_map_value(_value), do: :omit

  defp parse_integer(value) when is_integer(value), do: {:ok, value}

  defp parse_integer(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {parsed, _} -> {:ok, parsed}
      :error -> :error
    end
  end

  defp parse_integer(_value), do: :error

  defp parse_positive_integer(value) do
    case parse_integer(value) do
      {:ok, parsed} when parsed > 0 -> {:ok, parsed}
      _ -> :error
    end
  end

  defp parse_non_negative_integer(value) do
    case parse_integer(value) do
      {:ok, parsed} when parsed >= 0 -> {:ok, parsed}
      _ -> :error
    end
  end

  defp normalize_issue_state(state_name) when is_binary(state_name) do
    state_name
    |> String.trim()
    |> String.downcase()
  end

  defp workflow_config do
    case current_workflow() do
      {:ok, %{config: config}} when is_map(config) ->
        normalize_keys(config)

      _ ->
        %{}
    end
  end

  defp normalize_keys(value) when is_map(value) do
    Enum.reduce(value, %{}, fn {key, raw_value}, normalized ->
      Map.put(normalized, normalize_key(key), normalize_keys(raw_value))
    end)
  end

  defp normalize_keys(value) when is_list(value), do: Enum.map(value, &normalize_keys/1)
  defp normalize_keys(value), do: value

  defp normalize_key(value) when is_atom(value), do: Atom.to_string(value)
  defp normalize_key(value), do: to_string(value)

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
