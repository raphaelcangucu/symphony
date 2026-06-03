defmodule SymphonyElixir.Tracker.Sync.LocalFirstAdapterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.IssueDTO
  alias SymphonyElixir.Tracker.Sync.{LocalFirstAdapter, LocalStore, Outbox}

  defmodule SeedRemoteStub do
    @moduledoc false
    @behaviour SymphonyElixir.Tracker.IssueAdapter

    def calls, do: Agent.get(__MODULE__, & &1)
    def reset, do: Agent.start_link(fn -> 0 end, name: __MODULE__)

    @impl true
    def kind, do: :github

    @impl true
    def list_issues(_project, _filters) do
      Agent.update(__MODULE__, &(&1 + 1))

      {:ok,
       [
         IssueDTO.build(%{
           id: "I_seed",
           identifier: "7",
           title: "seeded",
           status: %{name: "Todo"},
           url: "https://x/7"
         })
       ]}
    end

    @impl true
    def get_issue(_project, _id), do: {:error, :issue_not_found}
    @impl true
    def create_issue(_project, _attrs), do: {:error, :not_supported_on_remote}
    @impl true
    def update_issue(_project, _id, _attrs), do: {:error, :not_supported_on_remote}
    @impl true
    def move_issue(_project, _id, _attrs), do: {:error, :not_supported_on_remote}
    @impl true
    def list_statuses(_project), do: {:ok, []}
    @impl true
    def list_labels(_project), do: {:ok, []}
    @impl true
    def list_assignable_users(_project), do: {:ok, []}
    @impl true
    def list_comments(_project, _id), do: {:ok, []}
    @impl true
    def add_comment(_project, _id, _body, _attrs), do: {:error, :not_supported_on_remote}
  end

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    project = %{project | tracker_kind: "github"}

    {:ok, _issue} =
      LocalStore.upsert_remote_issue(project, %{
        remote_id: "I_1",
        remote_number: 1,
        identifier: "1",
        title: "t",
        description: nil,
        state: "Todo",
        priority: nil,
        assignee_id: nil,
        branch_name: nil,
        remote_url: "u",
        creator: nil,
        position: 0,
        remote_updated_at: DateTime.utc_now(),
        labels: [],
        comments: []
      })

    %{project: project}
  end

  test "list_issues reads from the local store", %{project: project} do
    assert {:ok, [dto]} = LocalFirstAdapter.list_issues(project, [])
    assert dto.identifier == "1"
  end

  test "move_issue updates locally and enqueues an outbox entry", %{project: project} do
    assert {:ok, _dto} = LocalFirstAdapter.move_issue(project, "1", %{"status" => "Done"})

    reloaded = Repo.get_by(IssueRecord, project_id: project.id, identifier: "1")
    assert reloaded.sync_status == "pending"
    assert Outbox.pending_count(project.id) == 1
  end

  test "add_comment stores locally and enqueues", %{project: project} do
    assert {:ok, _comment} = LocalFirstAdapter.add_comment(project, "1", "hello", %{})
    assert Outbox.pending_count(project.id) == 1
  end

  test "archive_issue archives locally and enqueues an outbox entry", %{project: project} do
    assert {:ok, _dto} = LocalFirstAdapter.archive_issue(project, "1")

    reloaded = Repo.get_by(IssueRecord, project_id: project.id, identifier: "1")
    assert reloaded.archived_at
    assert Outbox.pending_count(project.id) == 1
  end

  test "delete_issue deletes locally and enqueues an outbox entry", %{project: project} do
    assert {:ok, _dto} = LocalFirstAdapter.delete_issue(project, "1")

    assert is_nil(Repo.get_by(IssueRecord, project_id: project.id, identifier: "1"))
    assert Outbox.pending_count(project.id) == 1
  end

  describe "seed on empty mirror" do
    setup do
      SeedRemoteStub.reset()
      previous_seed = Application.get_env(:symphony_elixir, :tracker_seed_on_empty)
      previous_adapters = Application.get_env(:symphony_elixir, :issue_adapters)
      Application.put_env(:symphony_elixir, :tracker_seed_on_empty, true)
      Application.put_env(:symphony_elixir, :issue_adapters, %{"github" => SeedRemoteStub})

      on_exit(fn ->
        # The seed fires a fire-and-forget `Engine.request_sync/0` cast. Drain the
        # engine mailbox synchronously here (a no-op while sync is disabled in the
        # test env) so a leftover cast cannot race into a later test that enables
        # sync and pollute the shared DB.
        if pid = Process.whereis(SymphonyElixir.Tracker.Sync.Engine), do: :sys.get_state(pid)
        restore(:tracker_seed_on_empty, previous_seed)
        restore(:issue_adapters, previous_adapters)
      end)

      {:ok, empty_project} = Context.ensure_project(%{name: "Cold", slug: "cold"})
      %{empty_project: %{empty_project | tracker_kind: "github"}}
    end

    test "fetches from the remote once to populate a never-synced project", %{empty_project: project} do
      assert {:ok, [dto]} = LocalFirstAdapter.list_issues(project, [])
      assert dto.identifier == "7"
      assert SeedRemoteStub.calls() == 1
    end

    test "does not re-seed once the project has been synced", %{empty_project: project} do
      assert {:ok, [_dto]} = LocalFirstAdapter.list_issues(project, [])
      assert {:ok, [_dto]} = LocalFirstAdapter.list_issues(project, [])
      assert SeedRemoteStub.calls() == 1
    end

    test "does not seed a project that already has local issues", %{project: project} do
      assert {:ok, [dto]} = LocalFirstAdapter.list_issues(project, [])
      assert dto.identifier == "1"
      assert SeedRemoteStub.calls() == 0
    end
  end

  defp restore(key, nil), do: Application.delete_env(:symphony_elixir, key)
  defp restore(key, value), do: Application.put_env(:symphony_elixir, key, value)

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
