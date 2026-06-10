defmodule SymphonyElixir.Tracker.UpsertWorkpadTest do
  use ExUnit.Case, async: false

  import Ecto.Query

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{LocalFirstTracker, OutboxEntry}

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    {:ok, issue} = Context.create_issue("mm", %{title: "Do the thing", status: "Todo"})
    %{project: project, issue: issue}
  end

  test "creates the workpad when none exists", %{project: project, issue: issue} do
    assert :ok = LocalFirstTracker.upsert_workpad(to_string(issue.id), "## Codex Workpad\nv1")

    assert {:ok, wp} = Context.latest_workpad(project.slug, issue.identifier)
    assert wp.body =~ "v1"

    assert [%OutboxEntry{entity_type: "comment", operation: "create"}] = pending_entries(project.id)
  end

  test "updates the existing workpad in place", %{project: project, issue: issue} do
    :ok = LocalFirstTracker.upsert_workpad(to_string(issue.id), "## Codex Workpad\nv1")
    :ok = LocalFirstTracker.upsert_workpad(to_string(issue.id), "## Codex Workpad\nv2")

    {:ok, comments} = Context.list_comments(project.slug, issue.identifier)
    workpads = Enum.filter(comments, &(&1.kind == "workpad"))
    assert length(workpads) == 1
    assert hd(workpads).body =~ "v2"
    assert hd(workpads).sync_status == "pending"

    ops = pending_entries(project.id) |> Enum.map(& &1.operation) |> Enum.sort()
    assert ops == ["create", "update"]
  end

  test "rapid updates coalesce by dedup key", %{project: project, issue: issue} do
    :ok = LocalFirstTracker.upsert_workpad(to_string(issue.id), "## Codex Workpad\nv1")
    :ok = LocalFirstTracker.upsert_workpad(to_string(issue.id), "## Codex Workpad\nv2")
    :ok = LocalFirstTracker.upsert_workpad(to_string(issue.id), "## Codex Workpad\nv3")

    updates = pending_entries(project.id) |> Enum.filter(&(&1.operation == "update"))
    assert [%OutboxEntry{payload: %{"body" => body}}] = updates
    assert body =~ "v3"
  end

  test "upsert_evidence creates then edits the evidence comment in place", %{project: project, issue: issue} do
    :ok = LocalFirstTracker.upsert_evidence(to_string(issue.id), "## Codex Evidence\n\nRun `r1`")
    :ok = LocalFirstTracker.upsert_evidence(to_string(issue.id), "## Codex Evidence\n\nRun `r2`")

    {:ok, comments} = Context.list_comments(project.slug, issue.identifier)
    evidence = Enum.filter(comments, &(&1.kind == "evidence"))
    assert length(evidence) == 1
    assert hd(evidence).body =~ "r2"
    assert hd(evidence).sync_status == "pending"

    ops = pending_entries(project.id) |> Enum.map(& &1.operation) |> Enum.sort()
    assert ops == ["create", "update"]
  end

  test "evidence and workpad comments are upserted independently", %{project: project, issue: issue} do
    :ok = LocalFirstTracker.upsert_workpad(to_string(issue.id), "## Codex Workpad\nplan")
    :ok = LocalFirstTracker.upsert_evidence(to_string(issue.id), "## Codex Evidence\nrun")
    :ok = LocalFirstTracker.upsert_evidence(to_string(issue.id), "## Codex Evidence\nrun v2")

    {:ok, comments} = Context.list_comments(project.slug, issue.identifier)
    assert Enum.count(comments, &(&1.kind == "workpad")) == 1
    assert Enum.count(comments, &(&1.kind == "evidence")) == 1

    {:ok, workpad} = Context.latest_workpad(project.slug, issue.identifier)
    assert workpad.body =~ "plan"

    {:ok, evidence} = Context.latest_comment_of_kind(project.slug, issue.identifier, "evidence")
    assert evidence.body =~ "run v2"
  end

  defp pending_entries(project_id) do
    Repo.all(from(e in OutboxEntry, where: e.project_id == ^project_id and e.status == "pending", order_by: e.id))
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
