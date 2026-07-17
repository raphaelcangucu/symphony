defmodule SymphonyElixir.Agent.SessionLogMigratorTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias SymphonyElixir.Agent.SessionLogMigrator
  alias SymphonyElixir.Agent.SessionStore
  alias SymphonyElixir.Assistant.Thread
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    SQL.query!(Repo, "DELETE FROM assistant_threads", [])
    :ok
  end

  test "migrates when no per-session transcript exists" do
    workspace = tmp_workspace!("migrate")
    source_path = Path.join(workspace, "source.jsonl")
    content = ~s({"type":"assistant","text":"hello"}\n)
    File.write!(source_path, content)

    {:ok, thread} = insert_thread!(workspace, "advising", "CDE-MIG-1")

    result =
      SessionLogMigrator.migrate(
        resolve: fn _thread -> {:ok, "codex", source_path} end
      )

    assert result == %{migrated: 1, skipped: 0, errors: 0}

    dest = SessionStore.transcript_path(workspace, thread.id)
    assert File.regular?(dest)
    assert File.read!(dest) == content
  end

  test "skips when per-session transcript already exists" do
    workspace = tmp_workspace!("skip")
    source_path = Path.join(workspace, "source.jsonl")
    File.write!(source_path, ~s({"type":"assistant","text":"source"}\n))

    {:ok, thread} = insert_thread!(workspace, "advising", "CDE-MIG-2")

    existing = ~s({"type":"assistant","text":"already-here"}\n)
    dest = SessionStore.transcript_path(workspace, thread.id)
    File.mkdir_p!(Path.dirname(dest))
    File.write!(dest, existing)

    result =
      SessionLogMigrator.migrate(
        resolve: fn _thread -> {:ok, "codex", source_path} end
      )

    assert result == %{migrated: 0, skipped: 1, errors: 0}
    assert File.read!(dest) == existing
  end

  test "dry_run counts migrated without writing" do
    workspace = tmp_workspace!("dry-run")
    source_path = Path.join(workspace, "source.jsonl")
    File.write!(source_path, ~s({"type":"assistant","text":"dry"}\n))

    {:ok, thread} = insert_thread!(workspace, "advising", "CDE-MIG-3")

    result =
      SessionLogMigrator.migrate(
        dry_run: true,
        resolve: fn _thread -> {:ok, "codex", source_path} end
      )

    assert result == %{migrated: 1, skipped: 0, errors: 0}
    refute SessionStore.exists?(workspace, thread.id)
  end

  defp insert_thread!(workspace, project_slug, identifier) do
    %Thread{}
    |> Thread.changeset(%{
      scope: "issue_execution",
      project_slug: project_slug,
      issue_identifier: identifier,
      workspace_path: workspace,
      agent_kind: "codex",
      status: "active"
    })
    |> Repo.insert()
  end

  defp tmp_workspace!(label) do
    workspace =
      Path.join(System.tmp_dir!(), "session-log-migrator-#{label}-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workspace)
    on_exit(fn -> File.rm_rf!(workspace) end)
    workspace
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
