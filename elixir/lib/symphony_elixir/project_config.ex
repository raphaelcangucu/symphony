defmodule SymphonyElixir.ProjectConfig do
  @moduledoc """
  Resolves the effective configuration + prompt for a single project.

  A project's DB-owned WORKFLOW front matter (`ProjectSetup.workflow_config`) is
  deep-merged over the global workflow front matter (`Config.workflow_front_matter/0`),
  then validated through the same schema the global config uses. Omitted keys
  inherit the global defaults; the prompt falls back to the global default when
  the project has no `prompt_template`.
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
    merged = deep_merge(Config.workflow_front_matter(), project_front_matter)
    opts = Config.validate_front_matter(merged)

    %__MODULE__{
      project_id: project.id,
      project_slug: project.slug,
      tracker_kind: project.tracker_kind,
      tracker_config: project.tracker_config || %{},
      active_states: get_in(opts, [:tracker, :active_states]),
      dispatch_states: dispatch_states(opts),
      wait_states: get_in(opts, [:tracker, :wait_states]) || [],
      terminal_states: get_in(opts, [:tracker, :terminal_states]),
      field_states: field_states(opts),
      workspace_root: get_in(opts, [:workspace, :root]),
      after_create_hook: setup && setup.after_create_hook,
      agent_kind: Config.default_agent_kind(),
      prompt_template: resolve_prompt(setup)
    }
  end

  defp load_setup(%Project{setup: %ProjectSetup{} = setup}), do: setup

  defp load_setup(%Project{setup: %Ecto.Association.NotLoaded{}} = project) do
    Repo.get_by(ProjectSetup, project_id: project.id)
  end

  defp load_setup(%Project{}), do: nil

  defp setup_front_matter(%ProjectSetup{workflow_config: %{} = config}) when map_size(config) > 0,
    do: config

  defp setup_front_matter(_setup), do: %{}

  defp resolve_prompt(%ProjectSetup{prompt_template: prompt}) when is_binary(prompt) do
    if String.trim(prompt) == "", do: Config.workflow_prompt(), else: prompt
  end

  defp resolve_prompt(_setup), do: Config.workflow_prompt()

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

  defp deep_merge(left, right) when is_map(left) and is_map(right) do
    Map.merge(left, right, fn _key, l, r -> deep_merge(l, r) end)
  end

  defp deep_merge(_left, right), do: right
end
