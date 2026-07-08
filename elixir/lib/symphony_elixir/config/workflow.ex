defmodule SymphonyElixir.Config.Workflow do
  @moduledoc """
  WORKFLOW.md front-matter parsing and validation.

  Owns the NimbleOptions schema (with all option defaults), the lenient
  operator-file validation (`validate_front_matter/1`), the strict
  per-project validation (`validate_workflow_config/1` /
  `parse_workflow_markdown/1`), and the import/export sanitizer
  (`portable_workflow_markdown/1`). `SymphonyElixir.Config` delegates here and
  reads validated options through `validated_options/0`.
  """

  alias NimbleOptions

  @default_active_states ["Todo", "In Progress"]
  @default_terminal_states ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]
  @default_poll_interval_ms 60_000
  @default_workspace_root "~/code/workspaces"
  @default_hook_timeout_ms 60_000
  @default_max_concurrent_agents 10
  @default_agent_max_turns 30
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
  @default_dev_server_reclaim_ports false
  @default_dev_server_max_concurrent 3
  @default_dev_server_idle_timeout_ms 1_800_000
  @default_dev_server_auto_start_on ["pull_request", "human_review"]
  @default_public_tunnel_enabled false
  @default_public_tunnel_base_domain "tracker.cods.dev"
  @default_github_read_interval_ms 150
  @default_github_mutation_interval_ms 1_000
  @default_github_max_retries 4
  @default_github_max_backoff_ms 60_000

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
                                 reclaim_ports: [
                                   type: :boolean,
                                   default: @default_dev_server_reclaim_ports
                                 ],
                                 port_range: [
                                   type: {:or, [{:list, :pos_integer}, nil]},
                                   default: nil
                                 ],
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
                                 required: [type: :boolean, default: false],
                                 repos: [type: {:map, :string, :any}, default: %{}]
                               ]
                             ]
                           )

  # Sections that must NOT appear in a per-project `workflow_markdown`: connection
  # identity (form/DB-owned) and process-level settings (env/runtime-owned).
  @forbidden_per_project_sections ~w(github linear local server observability polling editor)

  @doc """
  Normalized (string-keyed) front matter of the current global WORKFLOW.md;
  empty map when no workflow is loaded.
  """
  @spec config() :: map()
  def config do
    case SymphonyElixir.Workflow.current() do
      {:ok, %{config: config}} when is_map(config) ->
        normalize_keys(config)

      _ ->
        %{}
    end
  end

  @doc "One front-matter section as a map (empty when absent or malformed)."
  @spec section(String.t()) :: map()
  def section(name) when is_binary(name) do
    section_map(config(), name)
  end

  @doc "Current front matter validated against the workflow options schema."
  @spec validated_options() :: map()
  def validated_options do
    validate_front_matter(config())
  end

  @doc "Front-matter section names (from `names`) present in the current workflow."
  @spec detect_sections([String.t()]) :: [String.t()]
  def detect_sections(section_names) do
    config = config()
    Enum.filter(section_names, &Map.has_key?(config, &1))
  end

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

  @doc """
  Strips process/connection-owned sections from workflow markdown so bundles
  round-trip through import/export. Connection identity lives in the project
  `tracker` field; runtime settings belong in process config.
  """
  @spec portable_workflow_markdown(String.t()) :: String.t()
  def portable_workflow_markdown(markdown) when is_binary(markdown) do
    case SymphonyElixir.Workflow.parse_string(markdown) do
      {:ok, %{config: raw, prompt: body}} when is_map(raw) ->
        filtered =
          Map.reject(raw, fn {key, _value} ->
            key
            |> to_string()
            |> String.downcase()
            |> then(&(&1 in @forbidden_per_project_sections))
          end)

        SymphonyElixir.Workflow.to_markdown(filtered, body || "")

      _ ->
        markdown
    end
  end

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

  @doc false
  @spec normalize_keys(term()) :: term()
  def normalize_keys(value) when is_map(value) do
    Enum.reduce(value, %{}, fn {key, raw_value}, normalized ->
      Map.put(normalized, normalize_key(key), normalize_keys(raw_value))
    end)
  end

  def normalize_keys(value) when is_list(value), do: Enum.map(value, &normalize_keys/1)
  def normalize_keys(value), do: value

  @doc false
  @spec trim_string(term()) :: String.t() | nil
  def trim_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  def trim_string(_value), do: nil

  @doc false
  @spec default_workspace_root() :: Path.t()
  def default_workspace_root, do: Path.expand(@default_workspace_root)

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
    |> put_if_present(:reclaim_ports, boolean_value(Map.get(section, "reclaim_ports")))
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

  # Evidence is normalized to a single per-repo shape:
  #
  #   %{required: bool, repos: %{name => %{unit_command, ui_paths, e2e, impacts,
  #     contract_paths}}}
  #
  # Both the per-repo `repos:` format and the legacy flat format
  # (`test_command`/`e2e_command`/`ui_paths`) are accepted; the flat format is
  # converted into the same per-repo shape so the gate only deals with one form.
  defp extract_evidence_options(section) do
    %{}
    |> put_if_present(:required, boolean_value(Map.get(section, "required")))
    |> put_evidence_repos(section)
  end

  defp put_evidence_repos(map, section) do
    case evidence_repos(section) do
      repos when map_size(repos) > 0 -> Map.put(map, :repos, repos)
      _ -> map
    end
  end

  defp evidence_repos(section) do
    case Map.get(section, "repos") do
      repos when is_map(repos) and map_size(repos) > 0 -> parse_repo_configs(repos)
      _ -> repos_from_flat(section)
    end
  end

  defp parse_repo_configs(repos) do
    Enum.reduce(repos, %{}, fn {name, cfg}, acc ->
      case {trim_string(to_string(name)), parse_repo_config(cfg)} do
        {nil, _config} -> acc
        {_name, config} when map_size(config) == 0 -> acc
        {name, config} -> Map.put(acc, name, config)
      end
    end)
  end

  defp parse_repo_config(cfg) when is_map(cfg) do
    %{}
    |> put_if_present(:unit_command, scalar_string_value(Map.get(cfg, "unit_command")))
    |> put_if_present(:ui_paths, csv_value(Map.get(cfg, "ui_paths")))
    |> put_if_present(:e2e, parse_e2e(Map.get(cfg, "e2e")))
    |> put_if_present(:impacts, csv_value(Map.get(cfg, "impacts")))
    |> put_if_present(:contract_paths, csv_value(Map.get(cfg, "contract_paths")))
  end

  defp parse_repo_config(_cfg), do: %{}

  defp parse_e2e(%{} = e2e) do
    case e2e_command_map(scalar_string_value(Map.get(e2e, "command"))) do
      :omit -> :omit
      map -> put_if_present(map, :require_url_pattern, scalar_string_value(Map.get(e2e, "require_url_pattern")))
    end
  end

  defp parse_e2e(command) when is_binary(command), do: e2e_command_map(scalar_string_value(command))
  defp parse_e2e(_e2e), do: :omit

  defp e2e_command_map(:omit), do: :omit
  defp e2e_command_map(command), do: %{command: command}

  defp repos_from_flat(section) do
    unit = value_or(string_map_value(Map.get(section, "test_command")), %{})
    e2e = value_or(string_map_value(Map.get(section, "e2e_command")), %{})
    ui = group_ui_paths(value_or(csv_value(Map.get(section, "ui_paths")), []))

    [Map.keys(unit), Map.keys(e2e), Map.keys(ui)]
    |> Enum.concat()
    |> Enum.uniq()
    |> Enum.reduce(%{}, fn name, acc ->
      config =
        %{}
        |> put_if_present(:unit_command, scalar_string_value(Map.get(unit, name)))
        |> put_if_present(:e2e, parse_e2e(Map.get(e2e, name)))
        |> put_if_present(:ui_paths, present_list(Map.get(ui, name)))

      if map_size(config) == 0, do: acc, else: Map.put(acc, name, config)
    end)
  end

  # Legacy `ui_paths` are repo-prefixed globs (e.g. "frontend/src/**"); split the
  # leading segment as the repo name and keep the remainder as a repo-relative
  # glob so it matches the per-repo `changed_files` map.
  defp group_ui_paths(globs) do
    Enum.reduce(globs, %{}, fn glob, acc ->
      {repo, rest} = split_repo_prefix(glob)
      Map.update(acc, repo, [rest], &(&1 ++ [rest]))
    end)
  end

  defp split_repo_prefix(glob) do
    case String.split(glob, "/", parts: 2) do
      [repo, rest] when rest != "" -> {repo, rest}
      [repo | _rest] -> {repo, "**"}
    end
  end

  defp value_or(:omit, default), do: default
  defp value_or(value, _default), do: value

  defp present_list(nil), do: :omit
  defp present_list([]), do: :omit
  defp present_list(list) when is_list(list), do: list

  defp section_map(config, key) do
    case Map.get(config, key) do
      section when is_map(section) -> section
      _ -> %{}
    end
  end

  defp strict_section_issues(_section, nil, _fields), do: []

  defp strict_section_issues(section, value, _fields) when not is_map(value),
    do: ["#{section} must be a mapping"]

  # credo:disable-for-lines:15
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

  defp normalize_key(value) when is_atom(value), do: Atom.to_string(value)
  defp normalize_key(value), do: to_string(value)
end
