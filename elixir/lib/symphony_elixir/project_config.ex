defmodule SymphonyElixir.ProjectConfig do
  @moduledoc """
  Resolves the effective configuration + prompt for a single project.

  A project's DB-owned WORKFLOW front matter (parsed from
  `ProjectSetup.workflow_markdown`) is validated through the same schema the
  global config uses. Omitted keys inherit the **code-level defaults** from that
  schema (never a loaded global workflow). The prompt comes solely from the
  markdown body; a project without a prompt resolves to `nil` and is treated as
  unresolved (`resolve_runnable/1`), never falling back to a global prompt.
  """

  alias SymphonyElixir.Config
  alias SymphonyElixir.GitHub.IssueMarker
  alias SymphonyElixir.LocalTracker.{Project, ProjectSetup}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Workflow

  @enforce_keys [:project_id, :project_slug, :tracker_kind]
  defstruct [
    :project_id,
    :project_slug,
    :tracker_kind,
    :tracker_config,
    :repo,
    :active_states,
    :dispatch_states,
    :wait_states,
    :terminal_states,
    :field_states,
    :workspace_root,
    :after_create_hook,
    :agent_kind,
    :agent_model,
    :agent_effort,
    :prompt_template,
    :codex,
    :claude,
    :cursor,
    :max_turns,
    :turn_timeout_ms,
    :read_timeout_ms,
    :stall_timeout_ms,
    :completion_transitions,
    :max_concurrent_agents_by_state,
    :dev_server,
    :source_control,
    :pr_monitor,
    :hooks,
    :evidence
  ]

  @type t :: %__MODULE__{}

  @spec resolve(Project.t()) :: t()
  def resolve(%Project{} = project) do
    setup = load_setup(project)
    {project_front_matter, prompt_body} = setup_source(setup)
    opts = Config.validate_front_matter(project_front_matter)

    %__MODULE__{
      project_id: project.id,
      project_slug: project.slug,
      tracker_kind: project.tracker_kind,
      tracker_config: project.tracker_config || %{},
      repo: project_repo(project),
      active_states: get_in(opts, [:tracker, :active_states]),
      dispatch_states: dispatch_states(opts),
      wait_states: get_in(opts, [:tracker, :wait_states]) || [],
      terminal_states: get_in(opts, [:tracker, :terminal_states]),
      field_states: field_states(opts),
      workspace_root: project_workspace_root(project_front_matter),
      after_create_hook: resolve_after_create_hook(setup, project_front_matter),
      agent_kind: Config.agent_kind_from_config(project_front_matter),
      agent_model: Config.agent_model_from_config(project_front_matter),
      agent_effort: Config.agent_effort_from_config(project_front_matter),
      prompt_template: prompt_body,
      codex: front_matter_section(project_front_matter, "codex"),
      claude: front_matter_section(project_front_matter, "claude"),
      cursor: front_matter_section(project_front_matter, "cursor"),
      max_turns: agent_override(project_front_matter, "max_turns"),
      turn_timeout_ms: agent_override(project_front_matter, "turn_timeout_ms"),
      read_timeout_ms: agent_override(project_front_matter, "read_timeout_ms"),
      stall_timeout_ms: agent_override(project_front_matter, "stall_timeout_ms"),
      completion_transitions: agent_override(project_front_matter, "completion_transitions"),
      max_concurrent_agents_by_state: agent_override(project_front_matter, "max_concurrent_agents_by_state"),
      dev_server: front_matter_section(project_front_matter, "dev_server"),
      source_control: front_matter_section(project_front_matter, "source_control"),
      pr_monitor: front_matter_section(project_front_matter, "pr_monitor"),
      hooks: front_matter_section(project_front_matter, "hooks"),
      evidence: get_in(opts, [:evidence]) || %{}
    }
  end

  # Per-project agent overrides are read raw (not schema-defaulted) so an unset
  # value stays `nil` and the caller falls back to the process-level default,
  # instead of silently masking it with the schema's filler default.
  defp agent_override(%{} = front_matter, key), do: get_in(front_matter, ["agent", key])
  defp agent_override(_front_matter, _key), do: nil

  @doc """
  Resolves a project and classifies whether it can actually run.

  Returns `{:ok, config}` when the project has both a tracker identity and a
  prompt, or `{:skip, reason}` when it cannot run on its own (no tracker
  identity or no prompt). Callers skip-with-warning rather than inheriting any
  other project's identity or a global fallback.
  """
  @spec resolve_runnable(Project.t()) :: {:ok, t()} | {:skip, String.t()}
  def resolve_runnable(%Project{} = project) do
    config = resolve(project)

    cond do
      is_nil(config.tracker_kind) or config.tracker_kind == "" ->
        {:skip, "no tracker identity"}

      is_nil(config.prompt_template) or String.trim(config.prompt_template) == "" ->
        {:skip, "no prompt configured"}

      true ->
        {:ok, config}
    end
  end

  @doc """
  Strictly validates a project's own DB-owned `workflow_markdown` front matter
  against the schema. Returns `:ok` for an absent/empty config (it inherits the
  schema defaults) or `{:error, issues}` when a stored value is malformed.
  """
  @spec validate(Project.t()) :: :ok | {:error, [String.t()]}
  def validate(%Project{} = project) do
    {front_matter, _prompt} =
      project
      |> load_setup()
      |> setup_source()

    Config.validate_workflow_config(front_matter)
  end

  # Only an explicit per-project `workspace.root` overrides the process-level
  # default (`Config.workspace_root/0`); otherwise stay `nil` so the caller's
  # process default applies rather than the schema's filler default.
  #
  # Expand the configured value (mirroring the global `Config.workspace_root/0`)
  # so a leading `~` resolves to the user's home. Otherwise the literal tilde
  # leaks into every derived path — `File.mkdir_p!` creates a stray `~` directory,
  # the coding agent's `cd` cannot resolve it, and the code-server editor URL
  # (`?folder=~%2F...`) points at a non-existent tree.
  defp project_workspace_root(%{} = front_matter) do
    case get_in(front_matter, ["workspace", "root"]) do
      root when is_binary(root) and root != "" -> Path.expand(root)
      _ -> nil
    end
  end

  defp project_workspace_root(_front_matter), do: nil

  defp project_repo(%Project{tracker_config: %{} = config}) do
    case Map.get(config, "repo") do
      repo when is_binary(repo) and repo != "" -> repo
      _ -> nil
    end
  end

  defp project_repo(_project), do: nil

  defp resolve_after_create_hook(%ProjectSetup{after_create_hook: hook}, _front_matter)
       when is_binary(hook) and hook != "",
       do: hook

  defp resolve_after_create_hook(_setup, %{"hooks" => %{"after_create" => hook}})
       when is_binary(hook) and hook != "",
       do: hook

  defp resolve_after_create_hook(_setup, _front_matter), do: nil

  defp load_setup(%Project{setup: %ProjectSetup{} = setup}), do: setup

  defp load_setup(%Project{setup: %Ecto.Association.NotLoaded{}} = project) do
    Repo.get_by(ProjectSetup, project_id: project.id)
  end

  defp load_setup(%Project{}), do: nil

  # Source of truth for per-project behavior: `workflow_markdown` (parsed into
  # front matter + prompt body).
  defp setup_source(%ProjectSetup{workflow_markdown: md})
       when is_binary(md) and md != "" do
    case Workflow.parse_string(md) do
      {:ok, %{config: %{} = config, prompt: body}} -> {config, normalize_prompt(body)}
      _ -> {%{}, nil}
    end
  end

  defp setup_source(_setup), do: {%{}, nil}

  defp normalize_prompt(prompt) when is_binary(prompt) do
    case String.trim(prompt) do
      "" -> nil
      _ -> prompt
    end
  end

  defp normalize_prompt(_prompt), do: nil

  defp front_matter_section(%{} = front_matter, key) do
    case Map.get(front_matter, key) do
      %{} = section -> section
      _ -> nil
    end
  end

  defp front_matter_section(_front_matter, _key), do: nil

  @doc """
  Returns whether this project's workflow enables issue preview dev servers.
  """
  @spec dev_server_enabled?(t()) :: boolean()
  def dev_server_enabled?(%__MODULE__{dev_server: %{"enabled" => true}}), do: true
  def dev_server_enabled?(%__MODULE__{dev_server: %{enabled: true}}), do: true
  def dev_server_enabled?(_config), do: false

  @doc """
  Returns configured auto-start triggers for this project's dev server.

  Reads the raw `dev_server.auto_start_on` front matter only. When the key is
  omitted, returns `[]` (manual preview only). Set `pull_request` and/or
  `human_review` explicitly to enable polling-based auto-start.
  """
  @spec dev_server_auto_start_on(t()) :: [String.t()]
  def dev_server_auto_start_on(%__MODULE__{dev_server: dev_server}) when is_map(dev_server) do
    case Map.get(dev_server, "auto_start_on") || Map.get(dev_server, :auto_start_on) do
      triggers when is_list(triggers) ->
        triggers
        |> Enum.map(&to_string/1)
        |> Enum.filter(&(&1 in ["pull_request", "human_review"]))

      triggers when is_binary(triggers) ->
        triggers
        |> String.split(",", trim: true)
        |> Enum.map(&String.trim/1)
        |> Enum.filter(&(&1 in ["pull_request", "human_review"]))

      _ ->
        []
    end
  end

  def dev_server_auto_start_on(_config), do: []

  @doc """
  Returns whether this project's workflow enables the PR follow-up monitor.
  """
  @spec pr_monitor_enabled?(t()) :: boolean()
  def pr_monitor_enabled?(%__MODULE__{pr_monitor: %{"enabled" => true}}), do: true
  def pr_monitor_enabled?(%__MODULE__{}), do: false

  @doc """
  Returns the maximum automatic rework attempts before the monitor stops.

  Reads the raw `pr_monitor.max_auto_rework` front matter only. When the key is
  omitted or invalid, returns `2`.
  """
  @spec pr_monitor_max_auto_rework(t()) :: pos_integer()
  def pr_monitor_max_auto_rework(%__MODULE__{pr_monitor: %{"max_auto_rework" => max}})
      when is_integer(max) and max > 0,
      do: max

  def pr_monitor_max_auto_rework(%__MODULE__{}), do: 2

  @doc """
  Returns whether merged PRs should transition the issue to Done.

  Reads the raw `pr_monitor.done_on_merge` front matter only. When the key is
  omitted, returns `true`.
  """
  @spec pr_monitor_done_on_merge?(t()) :: boolean()
  def pr_monitor_done_on_merge?(%__MODULE__{pr_monitor: %{"done_on_merge" => false}}), do: false
  def pr_monitor_done_on_merge?(%__MODULE__{}), do: true

  @default_branch_pattern "symphony/{issue}"
  @default_pr_title_pattern "{issue}: {title}"

  @doc """
  Branch naming convention (advisory; the marker is the authoritative link).
  Reads `source_control.branch_pattern`, defaulting to `symphony/{issue}`.
  """
  @spec source_control_branch_pattern(t()) :: String.t()
  def source_control_branch_pattern(%__MODULE__{source_control: %{"branch_pattern" => p}})
      when is_binary(p) and p != "",
      do: p

  def source_control_branch_pattern(%__MODULE__{}), do: @default_branch_pattern

  @doc """
  PR title convention (advisory). Reads `source_control.pr_title_pattern`,
  defaulting to `{issue}: {title}`.
  """
  @spec source_control_pr_title_pattern(t()) :: String.t()
  def source_control_pr_title_pattern(%__MODULE__{source_control: %{"pr_title_pattern" => p}})
      when is_binary(p) and p != "",
      do: p

  def source_control_pr_title_pattern(%__MODULE__{}), do: @default_pr_title_pattern

  @doc """
  Key of the PR-body marker that authoritatively links a PR to the issue.
  Reads `source_control.issue_marker_key`, defaulting to `IssueMarker.default_key/0`.
  """
  @spec source_control_issue_marker_key(t()) :: String.t()
  def source_control_issue_marker_key(%__MODULE__{source_control: %{"issue_marker_key" => k}})
      when is_binary(k) and k != "",
      do: k

  def source_control_issue_marker_key(%__MODULE__{}), do: IssueMarker.default_key()

  defp dispatch_states(opts) do
    case get_in(opts, [:tracker, :dispatch_states]) do
      states when is_list(states) and states != [] -> states
      _ -> get_in(opts, [:tracker, :active_states])
    end
  end

  defp field_states(opts) do
    case get_in(opts, [:tracker, :field_states]) do
      states when is_list(states) and states != [] ->
        Enum.uniq(states)

      _ ->
        Enum.uniq(get_in(opts, [:tracker, :active_states]) ++ get_in(opts, [:tracker, :terminal_states]))
    end
  end
end
