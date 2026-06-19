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

  @spec start_run(String.t(), String.t()) :: {:ok, Run.t()} | {:error, error()}
  def start_run(project_slug, kind \\ "run") do
    with {:ok, project} <- Context.get_project(project_slug) do
      %Run{}
      |> Run.changeset(%{project_id: project.id, kind: kind, status: "running", started_at: now()})
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

  @doc """
  One-time, project-level dev-env warm-up: run the `.symphony/` setup + a
  `SYMPHONY_WARMUP=1` serve dry-run (boot → /health → teardown) as a blocking
  shell exec, classify any failure, record a `warm_up` run, and update project
  readiness. Injectable `:exec`/`:base`/`:tenant`/`:port` keep it testable.
  """
  @spec warm_up(String.t(), keyword()) :: {:ok, map()} | {:error, error()}
  def warm_up(project_slug, opts \\ []) do
    exec = Keyword.get(opts, :exec, &default_warm_up_exec/3)
    tenant = Keyword.get(opts, :tenant, "illume")
    base = Keyword.get(opts, :base, workspace_root(project_slug))

    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, run} <- start_run(project_slug, "warm_up") do
      if File.exists?(Path.join([base, ".symphony", "serve.sh"])) do
        port = Keyword.get(opts, :port, pick_ephemeral_port())
        {output, status} = exec.(base, warm_up_command(port, tenant), [])
        run_status = if status == 0, do: "succeeded", else: "failed"
        failure = if status == 0, do: nil, else: classify_warm_up_failure(output)
        finalize_warm_up(project_slug, run, run_status, failure, port, output)
      else
        finalize_warm_up(project_slug, run, "failed", "needs_scaffold", nil, "Missing .symphony/serve.sh")
      end
    end
  end

  defp warm_up_command(port, tenant) do
    env = "INSPIRE_PORT=#{port} SYMPHONY_WARMUP=1 SYMPHONY_PREVIEW_TENANT=#{tenant}"

    "export PATH=\"$PWD/node_modules/.bin:$PATH\" && " <>
      "#{env} bash .symphony/setup.sh && #{env} bash .symphony/serve.sh"
  end

  defp default_warm_up_exec(base, command, _opts) do
    System.cmd("bash", ["-lc", command], cd: base, stderr_to_stdout: true)
  rescue
    error -> {Exception.message(error), 1}
  end

  defp classify_warm_up_failure(output) do
    cond do
      output =~ ~r/403 Forbidden|pull access denied|not authorized|no basic auth/i -> "image_pull_auth"
      output =~ ~r/already in use by container/i -> "container_name_conflict"
      output =~ ~r/port is already allocated|address already in use/i -> "port_allocation"
      output =~ ~r/No such file or directory.*\.symphony|\.symphony.*No such file/i -> "needs_scaffold"
      output =~ ~r/Health was not confirmed|not running after|is not running/i -> "health_timeout"
      true -> "unknown"
    end
  end

  defp finalize_warm_up(project_slug, run, status, failure, port, output) do
    record_step_result(run, warm_up_step(), %{
      status: status,
      output: String.slice(output || "", 0, 20_000)
    })

    {:ok, _finished} = finish_run(run)
    {:ok, _project} = Context.update_warm_up_state(project_slug, %{status: status, run_id: run.id})

    {:ok, %{run_id: run.id, status: status, failure_class: failure, port: port, output: output}}
  end

  # Transient (non-persisted) step carrying only description/command for the
  # StepRun record; warm-up has no project-scoped Step row.
  defp warm_up_step do
    %Step{id: nil, description: "warm-up dry-run", command: "bash .symphony/serve.sh (SYMPHONY_WARMUP=1)"}
  end

  defp pick_ephemeral_port do
    {:ok, socket} = :gen_tcp.listen(0, [:binary, ip: {127, 0, 0, 1}])
    {:ok, port} = :inet.port(socket)
    :gen_tcp.close(socket)
    port
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
