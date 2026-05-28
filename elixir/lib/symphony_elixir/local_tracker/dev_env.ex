defmodule SymphonyElixir.LocalTracker.DevEnv do
  @moduledoc "Persistence + run tracking for project dev-environment steps."

  import Ecto.Query

  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.DevEnv.{Proposer, ProposedStep, Run, Step, StepRun}
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

  @spec save_steps(String.t(), [map()]) :: {:ok, [Step.t()]} | {:error, error()}
  def save_steps(project_slug, steps) when is_list(steps) do
    with {:ok, project} <- Context.get_project(project_slug) do
      Repo.transaction(fn ->
        Repo.delete_all(from(s in Step, where: s.project_id == ^project.id))

        steps
        |> Enum.with_index()
        |> Enum.reduce_while([], fn {attrs, index}, acc ->
          changeset = Step.changeset(%Step{}, step_attrs(attrs, project.id, index))

          case Repo.insert(changeset) do
            {:ok, step} -> {:cont, [step | acc]}
            {:error, reason} -> Repo.rollback(reason)
          end
        end)
        |> Enum.reverse()
      end)
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
  end

  defp default_repo([], project_slug), do: [%{workspace_path: ".", github_full_name: project_slug}]
  defp default_repo(repositories, _project_slug), do: repositories

  defp workspace_root(project_slug), do: Path.join(Config.workspace_root(), project_slug)

  defp now, do: DateTime.utc_now()
end
