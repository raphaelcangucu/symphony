defmodule SymphonyElixir.Tracker.ProjectSessionsTest do
  use ExUnit.Case, async: false

  import Ecto.Query

  alias SymphonyElixir.Assistant.Thread
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.ProjectSessions

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    {:ok, _project} = Context.ensure_project(%{name: "Sessions", slug: "sessions"})
    :ok
  end

  test "returns limited lightweight rows ordered by updated_at descending" do
    older = insert_thread!("Older title", ~U[2026-07-01 10:00:00.000000Z])
    newer = insert_thread!("Newer title", ~U[2026-07-01 11:00:00.000000Z])

    assert {:ok, %{data: [row], meta: %{next_cursor: next_cursor, project_activity_at: activity_at}}} =
             ProjectSessions.list("sessions", limit: 1)

    assert row.id == "thread:#{newer.id}"
    assert row.title == "Newer title"
    assert row.href == "/projects/sessions/workspaces/#{newer.id}"
    assert is_binary(row.updated_at)
    assert is_binary(next_cursor)
    assert activity_at == row.updated_at
    refute Map.has_key?(row, :description)
    assert older.id != newer.id
  end

  test "uses the cursor to return the next older row" do
    older = insert_thread!("Older title", ~U[2026-07-01 10:00:00.000000Z])
    _newer = insert_thread!("Newer title", ~U[2026-07-01 11:00:00.000000Z])

    assert {:ok, %{data: [_newer_row], meta: %{next_cursor: cursor}}} =
             ProjectSessions.list("sessions", limit: 1)

    assert {:ok, %{data: [older_row], meta: %{next_cursor: nil}}} =
             ProjectSessions.list("sessions", limit: 1, cursor: cursor)

    assert older_row.id == "thread:#{older.id}"
    assert older_row.title == "Older title"
  end

  test "does not include board issues as sidebar sessions" do
    huge_description = String.duplicate("x", 50_000)
    {:ok, issue} = Context.create_issue("sessions", %{title: "Huge description issue", description: huge_description})

    assert {:ok, %{data: rows}} = ProjectSessions.list("sessions", limit: 20)

    refute Enum.any?(rows, &(&1.id == "issue:#{issue.id}"))
    refute inspect(rows) =~ huge_description
  end

  test "includes legacy project-scoped assistant threads as chat sessions" do
    {:ok, thread} =
      %Thread{}
      |> Thread.changeset(%{
        scope: "project",
        project_slug: "sessions",
        title: "Legacy project chat",
        workspace_path: "/tmp/legacy-project-chat",
        status: "active",
        agent_kind: "codex"
      })
      |> Repo.insert()

    assert {:ok, %{data: [row]}} = ProjectSessions.list("sessions", limit: 20)

    assert row.id == "thread:#{thread.id}"
    assert row.title == "Legacy project chat"
    assert row.kind == "chat"
    assert row.href == "/projects/sessions/workspaces/#{thread.id}"
  end

  defp insert_thread!(title, updated_at) do
    {:ok, thread} =
      %Thread{}
      |> Thread.changeset(%{
        scope: "project_session",
        project_slug: "sessions",
        title: title,
        workspace_path: "/tmp/#{String.downcase(String.replace(title, " ", "-"))}",
        status: "active",
        metadata: %{"workspace_id" => "workspace-1"},
        agent_kind: "codex"
      })
      |> Repo.insert()

    {1, _} = Repo.update_all(from(thread in Thread, where: thread.id == ^thread.id), set: [updated_at: updated_at])
    Repo.get!(Thread, thread.id)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
