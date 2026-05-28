defmodule SymphonyElixir.LocalTracker.CloneWorkerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{CloneJob, CloneWorker, Context}
  alias SymphonyElixir.Repo

  defmodule OkGit do
    def clone(_url, _dest, _opts), do: {:ok, "abc123"}
  end

  defmodule FailGit do
    def clone(_url, _dest, _opts), do: {:error, "authentication required"}
  end

  defmodule SkipGit do
    def clone(_url, _dest, _opts), do: {:ok, :already_cloned}
  end

  setup do
    {:ok, _repo, _apps} = Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

    for table <- ["local_tracker_clone_jobs", "local_tracker_repositories", "local_tracker_projects"] do
      Repo.query!("delete from #{table}")
    end

    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "P",
        "slug" => "p",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [%{"github_full_name" => "g/api", "workspace_path" => "api", "role" => "backend", "clone_url" => "https://github.com/g/api.git"}],
        "setup" => %{}
      })

    [repo] = Context.list_repositories("p")
    {:ok, job} = Repo.insert(CloneJob.changeset(%CloneJob{}, %{project_id: project.id, repository_id: repo.id, status: "pending"}))

    %{job: job}
  end

  test "marks job succeeded with commit sha", %{job: job} do
    assert {:ok, %CloneJob{status: "succeeded", commit_sha: "abc123"}} =
             CloneWorker.run_sync(job.id, git: OkGit)
  end

  test "marks job failed with error", %{job: job} do
    assert {:ok, %CloneJob{status: "failed", error: "authentication required"}} =
             CloneWorker.run_sync(job.id, git: FailGit)
  end

  test "marks job skipped when already cloned", %{job: job} do
    assert {:ok, %CloneJob{status: "skipped"}} = CloneWorker.run_sync(job.id, git: SkipGit)
  end

  test "returns error when job does not exist" do
    assert {:error, :job_not_found} = CloneWorker.run_sync(-1)
  end

  test "runs through the supervised GenServer entry point", %{job: job} do
    {:ok, pid} = CloneWorker.start_link(job_id: job.id, git: OkGit)
    ref = Process.monitor(pid)

    assert_receive {:DOWN, ^ref, :process, ^pid, :normal}, 2_000

    assert %CloneJob{status: "succeeded", commit_sha: "abc123"} = Repo.get(CloneJob, job.id)
  end
end
