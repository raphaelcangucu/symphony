defmodule SymphonyElixir.Tracker.Sync.EngineTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Engine, Outbox, OutboxEntry, StateRecord}

  defmodule FakeDriver do
    @behaviour SymphonyElixir.Tracker.Sync.Driver

    @impl true
    def pull(_project, _opts) do
      send(self(), {:fake_pull, :called})

      {:ok,
       [
         %{
           remote_id: "I_1",
           remote_number: 1,
           identifier: "1",
           title: "Pulled issue",
           description: "body",
           state: "Todo",
           priority: nil,
           assignee_id: nil,
           branch_name: nil,
           remote_url: "u",
           creator: "octo",
           position: 0,
           remote_updated_at: DateTime.utc_now(),
           labels: [],
           comments: []
         }
       ]}
    end

    @impl true
    def push(_project, %OutboxEntry{} = entry) do
      send(self(), {:fake_push, entry.dedup_key})
      {:ok, "REMOTE_#{entry.id}"}
    end

    @impl true
    def pull_pull_requests(_project, _issue), do: {:ok, [%{remote_id: "PR_1", number: 7, url: "u", title: "t", state: "open"}]}
  end

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: project}
  end

  test "sync_project pushes outbox entries then pulls remote issues", %{project: project} do
    {:ok, _} =
      Outbox.enqueue(%{project_id: project.id, entity_type: "state", operation: "move", payload: %{"state" => "Done"}, dedup_key: "k1"})

    assert {:ok, summary} = Engine.sync_project(project, driver: FakeDriver)

    assert_received {:fake_push, "k1"}
    assert_received {:fake_pull, :called}
    assert summary.pushed == 1
    assert summary.pulled == 1

    assert Outbox.pending_count(project.id) == 0
    assert Repo.aggregate(IssueRecord, :count) == 1
    state = Repo.get_by(StateRecord, project_id: project.id)
    assert state.status == "idle"
    refute is_nil(state.last_pull_at)
  end

  test "sync_project stores pull requests for pulled issues", %{project: project} do
    assert {:ok, _summary} = Engine.sync_project(project, driver: FakeDriver, pr_driver: FakeDriver)

    prs = Repo.all(SymphonyElixir.Tracker.Sync.PullRequestRecord)
    assert Enum.map(prs, & &1.remote_id) == ["PR_1"]
  end

  test "a failing push marks the entry failed without aborting the pull", %{project: project} do
    defmodule FailPushDriver do
      @behaviour SymphonyElixir.Tracker.Sync.Driver
      @impl true
      def pull(_p, _o), do: {:ok, []}
      @impl true
      def push(_p, _e), do: {:error, "boom"}
      @impl true
      def pull_pull_requests(_p, _i), do: {:ok, []}
    end

    {:ok, _} = Outbox.enqueue(%{project_id: project.id, entity_type: "comment", operation: "create", payload: %{}, dedup_key: "c"})

    assert {:ok, summary} = Engine.sync_project(project, driver: FailPushDriver, max_attempts: 1)
    assert summary.failed == 1
    failed = Repo.one(OutboxEntry)
    assert failed.status == "failed"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
