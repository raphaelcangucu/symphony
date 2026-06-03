defmodule SymphonyElixir.ProjectConfig do
  @moduledoc """
  Resolves the effective configuration + prompt for a single project.

  A project's DB-owned WORKFLOW front matter (`ProjectSetup.workflow_config`) is
  validated through the same schema the global config uses. Omitted keys inherit
  the **code-level defaults** from that schema (never a loaded global workflow).
  The prompt comes solely from the project's `prompt_template`; a project without
  a prompt resolves to `nil` and is treated as unresolved (`resolve_runnable/1`),
  never falling back to a global prompt.
  """

  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.{Project, ProjectSetup}
  alias SymphonyElixir.Repo

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
    :prompt_template
  ]

  @type t :: %__MODULE__{}

  @spec resolve(Project.t()) :: t()
  def resolve(%Project{} = project) do
    setup = load_setup(project)
    project_front_matter = setup_front_matter(setup)
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
      prompt_template: resolve_prompt(setup)
    }
  end

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
  Strictly validates a project's own DB-owned `workflow_config` against the
  schema. Returns `:ok` for an absent/empty config (it inherits global defaults)
  or `{:error, issues}` when a stored value is malformed.
  """
  @spec validate(Project.t()) :: :ok | {:error, [String.t()]}
  def validate(%Project{} = project) do
    project
    |> load_setup()
    |> setup_front_matter()
    |> Config.validate_workflow_config()
  end

  # Only an explicit per-project `workspace.root` overrides the process-level
  # default (`Config.workspace_root/0`); otherwise stay `nil` so the caller's
  # process default applies rather than the schema's filler default.
  defp project_workspace_root(%{} = front_matter) do
    case get_in(front_matter, ["workspace", "root"]) do
      root when is_binary(root) and root != "" -> root
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

  defp setup_front_matter(%ProjectSetup{workflow_config: %{} = config}) when map_size(config) > 0,
    do: config

  defp setup_front_matter(_setup), do: %{}

  defp resolve_prompt(%ProjectSetup{prompt_template: prompt}) when is_binary(prompt) do
    case String.trim(prompt) do
      "" -> nil
      _ -> prompt
    end
  end

  defp resolve_prompt(_setup), do: nil

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
