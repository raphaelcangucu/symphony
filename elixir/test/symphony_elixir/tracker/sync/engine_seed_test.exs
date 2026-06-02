defmodule SymphonyElixir.Tracker.Sync.EngineSeedTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, IssueRecord, WorkflowStatus}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Engine, StateRecord}
  import Ecto.Query

  defmodule FakeRemote do
    @behaviour SymphonyElixir.Tracker.IssueAdapter

    alias SymphonyElixir.Tracker.IssueDTO

    @impl true
    def kind, do: :github

    @impl true
    def list_statuses(_project) do
      {:ok,
       [
         %{name: "Human Review", category: "started", position: 0, is_terminal: false},
         %{name: "Done", category: "completed", position: 1, is_terminal: true}
       ]}
    end

    @impl true
    def list_issues(_project, _filters) do
      {:ok,
       [
         %IssueDTO{
           id: "I_510",
           identifier: "510",
           title: "Issue 510",
           description: "d",
           status: %{name: "Human Review", category: "started", position: nil, is_terminal: false}
         },
         %IssueDTO{
           id: "I_507",
           identifier: "507",
           title: "Issue 507",
           description: "d",
           status: %{name: "Done", category: "completed", position: nil, is_terminal: true}
         }
       ]}
    end

    @impl true
    def get_issue(_project, _identifier), do: {:error, :issue_not_found}
    @impl true
    def create_issue(_project, _attrs), do: {:error, :not_supported_on_remote}
    @impl true
    def update_issue(_project, _identifier, _attrs), do: {:error, :not_supported_on_remote}
    @impl true
    def move_issue(_project, _identifier, _attrs), do: {:error, :not_supported_on_remote}
    @impl true
    def list_labels(_project), do: {:ok, []}
    @impl true
    def list_assignable_users(_project), do: {:ok, []}
    @impl true
    def list_comments(_project, _identifier), do: {:ok, []}
    @impl true
    def add_comment(_project, _identifier, _body, _opts), do: {:error, :not_supported_on_remote}
  end

  setup do
    migrate_repo()
    clean_repo()

    prev = Application.get_env(:symphony_elixir, :issue_adapters, %{})
    prev_seed = Application.get_env(:symphony_elixir, :tracker_seed_on_empty, true)
    Application.put_env(:symphony_elixir, :issue_adapters, Map.put(prev, "github", FakeRemote))
    Application.put_env(:symphony_elixir, :tracker_seed_on_empty, true)

    on_exit(fn ->
      Application.put_env(:symphony_elixir, :issue_adapters, prev)
      Application.put_env(:symphony_elixir, :tracker_seed_on_empty, prev_seed)
    end)

    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    Repo.delete_all(from(s in WorkflowStatus, where: s.project_id == ^project.id))
    # Drive the remote seed path without persisting a full github project config.
    %{project: %{project | tracker_kind: "github"}}
  end

  test "ensure_seeded mirrors statuses and issues for a cold github project", %{project: project} do
    assert Repo.aggregate(from(i in IssueRecord, where: i.project_id == ^project.id), :count) == 0

    :ok = Engine.ensure_seeded(project)

    assert Repo.aggregate(from(i in IssueRecord, where: i.project_id == ^project.id), :count) == 2

    state = Repo.get_by(StateRecord, project_id: project.id)
    refute is_nil(state.last_full_sync_at)

    issue =
      IssueRecord
      |> Repo.get_by(project_id: project.id, identifier: "510")
      |> Repo.preload(:status)

    assert issue.status.name == "Human Review"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
