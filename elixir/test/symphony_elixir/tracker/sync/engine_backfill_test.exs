defmodule SymphonyElixir.Tracker.Sync.EngineBackfillTest do
  use ExUnit.Case, async: false

  import ExUnit.CaptureLog

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Engine, StateRecord}

  defmodule FakeDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver
    @impl true
    def pull(_project, _opts), do: {:ok, []}
    @impl true
    def push(_project, _entry), do: {:ok, nil}
    @impl true
    def pull_pull_requests(_project, _issue), do: {:ok, []}
  end

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: %{project | tracker_kind: "github"}}
  end

  test "first successful sync stamps last_full_sync_at", %{project: project} do
    assert {:ok, _} = Engine.sync_project(project, driver: FakeDriver, pr_driver: FakeDriver)

    state = Repo.get_by(StateRecord, project_id: project.id)
    assert %DateTime{} = state.last_full_sync_at
    first = state.last_full_sync_at

    assert {:ok, _} = Engine.sync_project(project, driver: FakeDriver, pr_driver: FakeDriver)
    assert Repo.get_by(StateRecord, project_id: project.id).last_full_sync_at == first
  end

  test "logs a structured sync summary", %{project: project} do
    log =
      capture_log(fn ->
        Engine.sync_project(project, driver: FakeDriver, pr_driver: FakeDriver)
        Engine.log_summary(project, %{pushed: 0, failed: 0, pulled: 0})
      end)

    assert log =~ "tracker_sync"
    assert log =~ "project=mm"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    for table <- ["tracker_sync_state", "tracker_sync_outbox", "local_tracker_issues", "local_tracker_workflow_statuses", "local_tracker_projects"] do
      Repo.query!("delete from #{table}")
    end
  end
end
