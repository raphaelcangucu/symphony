defmodule SymphonyElixir.LocalTracker.DevServerRecordTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, DevServerRecord}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()

    {:ok, project} =
      Context.create_workspace_project(%{
        "name" => "P",
        "slug" => "p",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [],
        "setup" => %{}
      })

    {:ok, project: project}
  end

  test "upsert inserts then updates by (project, issue, slug)", %{project: project} do
    {:ok, a} = DevServerRecord.upsert(project.id, "#1", "front", %{status: "starting", port: 4100, primary: true})
    {:ok, b} = DevServerRecord.upsert(project.id, "#1", "front", %{status: "ready", url: "http://127.0.0.1:4100"})

    assert a.id == b.id
    assert b.status == "ready"
    assert b.url == "http://127.0.0.1:4100"
  end

  test "upsert updates only provided fields on conflict", %{project: project} do
    {:ok, _} = DevServerRecord.upsert(project.id, "#1", "front", %{status: "starting", port: 4100, primary: true})

    {:ok, row} =
      DevServerRecord.upsert(project.id, "#1", "front", %{
        "status" => "ready",
        "url" => "http://127.0.0.1:4100"
      })

    assert row.status == "ready"
    assert row.url == "http://127.0.0.1:4100"
    assert row.port == 4100
    assert row.primary == true
  end

  test "upsert conflict updates use casted values", %{project: project} do
    {:ok, _} = DevServerRecord.upsert(project.id, "#1", "front", %{status: "starting", port: 4100, primary: true})

    assert {:ok, row} =
             DevServerRecord.upsert(project.id, "#1", "front", %{
               "status" => "ready",
               "port" => "4101",
               "primary" => "false"
             })

    assert row.status == "ready"
    assert row.port == 4101
    assert row.primary == false
  end

  test "list_for_issue returns rows for the issue", %{project: project} do
    {:ok, _} = DevServerRecord.upsert(project.id, "#1", "front", %{status: "ready", primary: true})

    assert [row] = DevServerRecord.list_for_issue(project.id, "#1")
    assert row.slug == "front"
  end

  test "list_for_issue orders primary rows before slug", %{project: project} do
    {:ok, _} = DevServerRecord.upsert(project.id, "#1", "zeta", %{status: "ready"})
    {:ok, _} = DevServerRecord.upsert(project.id, "#1", "front", %{status: "ready", primary: true})
    {:ok, _} = DevServerRecord.upsert(project.id, "#1", "api", %{status: "ready"})

    assert ["front", "api", "zeta"] =
             project.id
             |> DevServerRecord.list_for_issue("#1")
             |> Enum.map(& &1.slug)
  end

  test "mark_all_stopped flips non-terminal rows to stopped", %{project: project} do
    {:ok, _} = DevServerRecord.upsert(project.id, "#1", "front", %{status: "ready"})

    assert {1, _} = DevServerRecord.mark_all_stopped()
    assert [row] = DevServerRecord.list_for_issue(project.id, "#1")
    assert row.status == "stopped"
  end

  test "changeset rejects invalid status" do
    changeset =
      DevServerRecord.changeset(%DevServerRecord{}, %{
        project_id: 1,
        issue_identifier: "#1",
        slug: "front",
        status: "warming"
      })

    refute changeset.valid?
    assert {"is invalid", [validation: :inclusion, enum: _statuses]} = changeset.errors[:status]
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
