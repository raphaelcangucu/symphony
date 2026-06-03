defmodule SymphonyElixir.Tracker.Sync.EngineSeedLockTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, WorkflowStatus}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Engine, StateRecord}
  import Ecto.Query

  defmodule RateLimitedStatusRemote do
    @behaviour SymphonyElixir.Tracker.IssueAdapter

    @impl true
    def kind, do: :github

    @impl true
    def list_statuses(_project), do: {:error, {:rate_limited, %{}}}

    @impl true
    def list_issues(_project, _filters), do: {:ok, []}

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

  defmodule SeededStatusRemote do
    @behaviour SymphonyElixir.Tracker.IssueAdapter

    @impl true
    def kind, do: :github

    @impl true
    def list_statuses(_project) do
      {:ok, [%{name: "Done", category: "completed", position: 0, is_terminal: true}]}
    end

    @impl true
    def list_issues(_project, _filters), do: {:ok, []}

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
    Application.put_env(:symphony_elixir, :tracker_seed_on_empty, true)

    on_exit(fn ->
      Application.put_env(:symphony_elixir, :issue_adapters, prev)
      Application.put_env(:symphony_elixir, :tracker_seed_on_empty, prev_seed)
    end)

    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    Repo.delete_all(from(s in WorkflowStatus, where: s.project_id == ^project.id))
    %{base_project: %{project | tracker_kind: "github"}, prev_adapters: prev}
  end

  test "does not lock an empty board when status seeding fails", ctx do
    use_remote(ctx, RateLimitedStatusRemote)
    project = ctx.base_project

    :ok = Engine.ensure_seeded(project)

    state = Repo.get_by(StateRecord, project_id: project.id)
    assert is_nil(state.last_full_sync_at)
    assert Repo.aggregate(from(s in WorkflowStatus, where: s.project_id == ^project.id), :count) == 0
  end

  test "locks an empty board once statuses are seeded", ctx do
    use_remote(ctx, SeededStatusRemote)
    project = ctx.base_project

    :ok = Engine.ensure_seeded(project)

    state = Repo.get_by(StateRecord, project_id: project.id)
    refute is_nil(state.last_full_sync_at)
    assert Repo.aggregate(from(s in WorkflowStatus, where: s.project_id == ^project.id), :count) == 1
  end

  defp use_remote(%{prev_adapters: prev}, remote) do
    Application.put_env(:symphony_elixir, :issue_adapters, Map.put(prev, "github", remote))
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
