defmodule SymphonyElixir.KnowledgeBase.SyncStateTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.SyncState
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    on_exit(fn -> Repo.delete_all(SyncState) end)
    :ok
  end

  test "put upserts and get returns the latest state" do
    assert {:ok, _} = SyncState.put("acme", "web", %{status: "syncing"})
    assert {:ok, _} = SyncState.put("acme", "web", %{status: "open_pr", pr_number: 9, pr_url: "u"})
    state = SyncState.get("acme", "web")
    assert state.status == "open_pr"
    assert state.pr_number == 9
  end

  test "get returns a default idle state when none exists" do
    assert SyncState.get("acme", "missing").status == "idle"
  end

  test "rejects unknown statuses" do
    assert {:error, cs} = SyncState.put("acme", "web", %{status: "bogus"})
    refute cs.valid?
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
