defmodule SymphonyElixir.Tracker.Sync.LocalStoreUsersTest do
  use ExUnit.Case, async: false

  import Ecto.Query

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.{LocalStore, UserRecord}

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "Gamba", slug: "gamba"})
    Repo.delete_all(from(u in UserRecord, where: u.project_id == ^project.id))
    %{project: project}
  end

  test "upsert_users seeds assignable users and is idempotent", %{project: project} do
    users = [
      %{id: "U1", login: "alice", name: "Alice", avatar_url: "https://x/alice.png"},
      %{id: "U2", login: "bob", name: "Bob", avatar_url: nil}
    ]

    :ok = LocalStore.upsert_users(project, users)
    :ok = LocalStore.upsert_users(project, users)

    rows =
      Repo.all(from(u in UserRecord, where: u.project_id == ^project.id, order_by: u.login))

    assert length(rows) == 2
    assert Enum.map(rows, & &1.login) == ["alice", "bob"]
    assert Enum.find(rows, &(&1.login == "alice")).remote_id == "U1"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
