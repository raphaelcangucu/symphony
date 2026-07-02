defmodule SymphonyElixir.Tracker.Sync.ParentLinkTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{Outbox, ParentLink}

  setup do
    previous = Application.get_env(:symphony_elixir, :tracker)
    on_exit(fn -> restore_tracker(previous) end)
    Application.put_env(:symphony_elixir, :tracker, sync_enabled: true)

    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    project = %{project | tracker_kind: "github"}
    {:ok, parent} = Context.create_issue(project.slug, %{title: "Parent", status: "Todo"})
    {:ok, child} = Context.create_issue(project.slug, %{title: "Child", status: "Todo"})
    {:ok, _} = Context.set_issue_parent(project.slug, child.identifier, parent.identifier)

    %{project: project, parent: parent, child: child}
  end

  test "enqueue_link inserts a pending relation entry", %{project: project, parent: parent, child: child} do
    assert :ok = ParentLink.enqueue_link(project, child.identifier, parent.identifier)
    assert Outbox.pending_count(project.id) == 1
  end

  test "requeue_unsynced_relations enqueues link when both issues have remote ids", %{
    project: project,
    parent: parent,
    child: child
  } do
    parent
    |> Ecto.Changeset.change(%{remote_id: "I_parent", remote_number: 510})
    |> Repo.update!()

    child
    |> Ecto.Changeset.change(%{remote_id: "I_child", remote_number: 511})
    |> Repo.update!()

    assert :ok = ParentLink.requeue_unsynced_relations(project)
    assert Outbox.pending_count(project.id) >= 1

    assert Enum.any?(Outbox.claim_pending(project.id, 10), fn entry ->
             entry.entity_type == "relation" and entry.operation == "link_parent" and
               entry.payload["child_identifier"] == child.identifier and
               entry.payload["parent_identifier"] == parent.identifier
           end)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    Repo.query!("delete from tracker_sync_outbox")
    Repo.query!("delete from local_tracker_issue_relations")
    Repo.query!("delete from local_tracker_issues")
    Repo.query!("delete from local_tracker_projects")
  end

  defp restore_tracker(nil), do: Application.delete_env(:symphony_elixir, :tracker)
  defp restore_tracker(value), do: Application.put_env(:symphony_elixir, :tracker, value)
end
