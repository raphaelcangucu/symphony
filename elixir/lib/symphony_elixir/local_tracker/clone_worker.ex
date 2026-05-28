defmodule SymphonyElixir.LocalTracker.CloneWorker do
  @moduledoc "Runs a single clone job and broadcasts progress."

  use GenServer, restart: :temporary

  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.{Broadcaster, CloneJob, Git, Repository}
  alias SymphonyElixir.Repo

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  @impl true
  def init(opts) do
    job_id = Keyword.fetch!(opts, :job_id)
    {:ok, opts, {:continue, {:run, job_id}}}
  end

  @impl true
  def handle_continue({:run, job_id}, opts) do
    run_sync(job_id, opts)
    {:stop, :normal, opts}
  end

  @spec run_sync(integer(), keyword()) :: {:ok, CloneJob.t()} | {:error, term()}
  def run_sync(job_id, opts \\ []) do
    git = Keyword.get(opts, :git, Git)

    with %CloneJob{} = job <- Repo.get(CloneJob, job_id),
         %Repository{} = repo <- Repo.get(Repository, job.repository_id) do
      project = Repo.preload(job, :project).project
      mark!(job, %{status: "running", started_at: now()})
      Broadcaster.clone_event(project.slug, "clone_started", clone_payload(repo))

      dest = Path.join([Config.workspace_root(), project.slug, repo.workspace_path])

      case git.clone(repo.clone_url || "https://github.com/#{repo.github_full_name}.git", dest, branch: repo.selected_branch || repo.default_branch) do
        {:ok, :already_cloned} ->
          updated = mark!(job, %{status: "skipped", completed_at: now()})
          Broadcaster.clone_event(project.slug, "clone_skipped", clone_payload(repo))
          {:ok, updated}

        {:ok, sha} ->
          updated = mark!(job, %{status: "succeeded", commit_sha: sha, completed_at: now()})
          Broadcaster.clone_event(project.slug, "clone_succeeded", Map.put(clone_payload(repo), :commit_sha, sha))
          {:ok, updated}

        {:error, message} ->
          updated = mark!(job, %{status: "failed", error: message, completed_at: now()})
          Broadcaster.clone_event(project.slug, "clone_failed", Map.put(clone_payload(repo), :error, message))
          {:ok, updated}
      end
    else
      nil -> {:error, :job_not_found}
    end
  end

  defp mark!(job, attrs) do
    job |> CloneJob.changeset(attrs) |> Repo.update!()
  end

  defp clone_payload(repo) do
    %{repository_id: to_string(repo.id), github_full_name: repo.github_full_name}
  end

  defp now, do: DateTime.utc_now()
end
