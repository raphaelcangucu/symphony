defmodule SymphonyElixir.Tracker.Sync.LocalStoreStatusesTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.{Context, WorkflowStatus}
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.LocalStore
  import Ecto.Query

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    Repo.delete_all(from(s in WorkflowStatus, where: s.project_id == ^project.id))
    %{project: project}
  end

  test "upsert_statuses seeds workflow statuses and is idempotent", %{project: project} do
    statuses = [
      %{name: "Backlog", category: "backlog", position: 0, is_terminal: false},
      %{name: "Done", category: "completed", position: 1, is_terminal: true}
    ]

    :ok = LocalStore.upsert_statuses(project, statuses)
    :ok = LocalStore.upsert_statuses(project, statuses)

    rows =
      Repo.all(from(s in WorkflowStatus, where: s.project_id == ^project.id, order_by: s.position))

    assert Enum.map(rows, & &1.name) == ["Backlog", "Done"]
    assert Enum.map(rows, & &1.category) == ["backlog", "completed"]
  end

  test "upsert_statuses preserves imported column order on later sync", %{project: project} do
    :ok =
      LocalStore.upsert_statuses(project, [
        %{name: "Backlog", category: "backlog", position: 0, is_terminal: false},
        %{name: "Done", category: "completed", position: 1, is_terminal: true}
      ])

    :ok =
      LocalStore.upsert_statuses(project, [
        %{name: "Done", category: "completed", position: 0, is_terminal: true},
        %{name: "Backlog", category: "backlog", position: 1, is_terminal: false}
      ])

    rows =
      Repo.all(from(s in WorkflowStatus, where: s.project_id == ^project.id, order_by: s.position))

    assert Enum.map(rows, &{&1.name, &1.position}) == [{"Backlog", 0}, {"Done", 1}]
  end

  test "merge_remote_statuses leaves configured columns alone and appends new remote statuses", %{
    project: project
  } do
    :ok =
      LocalStore.upsert_statuses(project, [
        %{name: "Backlog", category: "backlog", position: 0, is_terminal: false},
        %{name: "Done", category: "completed", position: 1, is_terminal: true}
      ])

    :ok =
      LocalStore.merge_remote_statuses(project, [
        %{name: "Done", category: "completed", position: 0, is_terminal: true},
        %{name: "Backlog", category: "backlog", position: 1, is_terminal: false},
        %{name: "In QA", category: "started", position: 2, is_terminal: false}
      ])

    rows =
      Repo.all(from(s in WorkflowStatus, where: s.project_id == ^project.id, order_by: s.position))

    assert Enum.map(rows, &{&1.name, &1.position}) == [
             {"Backlog", 0},
             {"Done", 1},
             {"In QA", 2}
           ]
  end

  test "upsert_remote_issue creates a status on the fly when none is seeded", %{
    project: project
  } do
    assert Repo.aggregate(from(s in WorkflowStatus, where: s.project_id == ^project.id), :count) ==
             0

    {:ok, issue} =
      LocalStore.upsert_remote_issue(project, %{
        remote_id: "I_510",
        remote_number: 510,
        identifier: "510",
        title: "Issue 510",
        state: "Human Review",
        position: 0,
        labels: [],
        comments: []
      })

    refute is_nil(issue.status_id)
    status = Repo.get(WorkflowStatus, issue.status_id)
    assert status.name == "Human Review"
  end

  test "upsert_remote_issue reuses a seeded status by name", %{project: project} do
    :ok =
      LocalStore.upsert_statuses(project, [
        %{name: "Human Review", category: "started", position: 3, is_terminal: false}
      ])

    seeded = Repo.get_by(WorkflowStatus, project_id: project.id, name: "Human Review")

    {:ok, issue} =
      LocalStore.upsert_remote_issue(project, %{
        remote_id: "I_510",
        remote_number: 510,
        identifier: "510",
        title: "Issue 510",
        state: "Human Review",
        position: 0,
        labels: [],
        comments: []
      })

    assert issue.status_id == seeded.id

    assert Repo.aggregate(from(s in WorkflowStatus, where: s.project_id == ^project.id), :count) ==
             1
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
