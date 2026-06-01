defmodule SymphonyElixir.Tracker.Sync.UserRecordTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.UserRecord

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    %{project: project}
  end

  test "inserts a user cache row", %{project: project} do
    attrs = %{project_id: project.id, remote_id: "U_1", login: "octocat", name: "Octo Cat", avatar_url: "https://x/y.png"}
    assert {:ok, user} = %UserRecord{} |> UserRecord.changeset(attrs) |> Repo.insert()
    assert user.login == "octocat"
  end

  test "is unique per project+login", %{project: project} do
    base = %{project_id: project.id, remote_id: "U_1", login: "octocat"}
    {:ok, _} = %UserRecord{} |> UserRecord.changeset(base) |> Repo.insert()
    assert {:error, _} = %UserRecord{} |> UserRecord.changeset(base) |> Repo.insert()
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    Repo.query!("delete from tracker_users")
    Repo.query!("delete from local_tracker_projects")
  end
end
