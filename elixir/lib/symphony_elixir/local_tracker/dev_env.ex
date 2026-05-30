defmodule SymphonyElixir.LocalTracker.DevEnv do
  @moduledoc "Persistence + run tracking for project dev-environment steps."

  import Ecto.Query

  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.DevEnv.{ProposedStep, Proposer, Run, Step, StepRun}
  alias SymphonyElixir.Repo

  @type error :: :project_not_found | Ecto.Changeset.t()

  @spec propose_steps(String.t()) :: {:ok, [ProposedStep.t()]} | {:error, :project_not_found}
  def propose_steps(project_slug) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      repositories =
        project_slug
        |> Context.list_repositories()
        |> Enum.map(fn repo -> %{workspace_path: repo.workspace_path, github_full_name: repo.github_full_name} end)
        |> default_repo(project_slug)

      {:ok, Proposer.propose(workspace_root(project_slug), repositories)}
    end
  end

  @spec list_steps(String.t()) :: [Step.t()]
  def list_steps(project_slug) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        Repo.all(from(s in Step, where: s.project_id == ^project.id, order_by: [asc: s.position, asc: s.id]))

      _ ->
        []
    end
  end

  @spec list_serve_steps(String.t()) :: [Step.t()]
  def list_serve_steps(project_slug) do
    project_slug
    |> list_steps()
    |> Enum.filter(&(&1.role == "serve"))
  end

  @spec save_steps(String.t(), [map()]) :: {:ok, [Step.t()]} | {:error, error()}
  def save_steps(project_slug, steps) when is_list(steps) do
    with {:ok, project} <- Context.get_project(project_slug) do
      Repo.transaction(fn -> replace_steps(project, steps) end)
    end
  end

  defp replace_steps(project, steps) do
    Repo.delete_all(from(s in Step, where: s.project_id == ^project.id))

    steps
    |> normalize_primary()
    |> Enum.with_index()
    |> Enum.reduce_while([], fn {attrs, index}, acc -> insert_step(project, attrs, index, acc) end)
    |> Enum.reverse()
  end

  defp insert_step(project, attrs, index, acc) do
    changeset = Step.changeset(%Step{}, step_attrs(attrs, project.id, index))

    case Repo.insert(changeset) do
      {:ok, step} -> {:cont, [step | acc]}
      {:error, reason} -> Repo.rollback(reason)
    end
  end

  @spec start_run(String.t()) :: {:ok, Run.t()} | {:error, error()}
  def start_run(project_slug) do
    with {:ok, project} <- Context.get_project(project_slug) do
      %Run{}
      |> Run.changeset(%{project_id: project.id, status: "running", started_at: now()})
      |> Repo.insert()
    end
  end

  @spec record_step_result(Run.t(), Step.t(), map()) :: {:ok, StepRun.t()} | {:error, Ecto.Changeset.t()}
  def record_step_result(%Run{} = run, %Step{} = step, result) when is_map(result) do
    %StepRun{}
    |> StepRun.changeset(%{
      run_id: run.id,
      step_id: step.id,
      description: step.description,
      command: step.command,
      status: Map.get(result, :status, "succeeded"),
      exit_code: Map.get(result, :exit_code),
      output: Map.get(result, :output),
      started_at: Map.get(result, :started_at, now()),
      completed_at: Map.get(result, :completed_at, now())
    })
    |> Repo.insert()
  end

  @spec finish_run(Run.t()) :: {:ok, Run.t()} | {:error, Ecto.Changeset.t()}
  def finish_run(%Run{} = run) do
    failed? = Repo.exists?(from(sr in StepRun, where: sr.run_id == ^run.id and sr.status == "failed"))
    status = if failed?, do: "failed", else: "succeeded"

    run |> Run.changeset(%{status: status, completed_at: now()}) |> Repo.update()
  end

  @spec list_runs(String.t()) :: [Run.t()]
  def list_runs(project_slug) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        Repo.all(from(r in Run, where: r.project_id == ^project.id, order_by: [desc: r.id], preload: [:step_runs]))

      _ ->
        []
    end
  end

  defp step_attrs(attrs, project_id, index) do
    attrs
    |> Map.new(fn {k, v} -> {to_string(k), v} end)
    |> Map.put("project_id", project_id)
    |> Map.put("position", index)
    |> Map.put_new("source", "manual")
    |> Map.put_new("role", "setup")
  end

  defp normalize_primary(steps) do
    serve_indexes =
      steps
      |> Enum.with_index()
      |> Enum.filter(fn {attrs, _index} -> step_role(attrs) == "serve" end)
      |> Enum.map(fn {_attrs, index} -> index end)

    chosen_primary =
      Enum.find(serve_indexes, fn index ->
        attrs = Enum.at(steps, index)
        truthy?(step_value(attrs, :primary, false))
      end) || List.first(serve_indexes)

    steps
    |> Enum.with_index()
    |> Enum.map(fn {attrs, index} -> put_primary(attrs, index == chosen_primary and index in serve_indexes) end)
  end

  defp step_role(attrs), do: to_string(step_value(attrs, :role, "setup"))

  defp step_value(attrs, key, default) do
    Map.get(attrs, key, Map.get(attrs, Atom.to_string(key), default))
  end

  defp put_primary(attrs, value) when is_map(attrs) do
    if Map.has_key?(attrs, "primary") do
      Map.put(attrs, "primary", value)
    else
      Map.put(attrs, :primary, value)
    end
  end

  defp truthy?(true), do: true
  defp truthy?("true"), do: true
  defp truthy?(_value), do: false

  defp default_repo([], project_slug), do: [%{workspace_path: ".", github_full_name: project_slug}]
  defp default_repo(repositories, _project_slug), do: repositories

  defp workspace_root(project_slug), do: Path.join(Config.workspace_root(), project_slug)

  defp now, do: DateTime.utc_now()
end
