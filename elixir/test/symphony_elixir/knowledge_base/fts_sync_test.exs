defmodule SymphonyElixir.KnowledgeBase.FtsSyncTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.PageRecord
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    on_exit(fn -> Repo.delete_all(PageRecord) end)
    :ok
  end

  test "inserting a page makes it discoverable by body text via MATCH" do
    {:ok, _} =
      %PageRecord{}
      |> PageRecord.changeset(%{
        project_slug: "p",
        repo_slug: "acme~web",
        path: "a.md",
        title: "Auth",
        body: "rotate the refresh token nightly"
      })
      |> Repo.insert()

    assert {:ok, %{rows: [[count]]}} =
             Repo.query("SELECT count(*) FROM kb_pages_fts WHERE kb_pages_fts MATCH ?", ["refresh"])

    assert count == 1
  end

  test "updating body re-syncs the index (old terms gone, new terms present)" do
    {:ok, record} =
      %PageRecord{}
      |> PageRecord.changeset(%{
        project_slug: "p",
        repo_slug: "acme~web",
        path: "a.md",
        title: "T",
        body: "alpha"
      })
      |> Repo.insert()

    {:ok, _} = record |> PageRecord.changeset(%{body: "bravo"}) |> Repo.update()

    assert {:ok, %{rows: [[0]]}} =
             Repo.query("SELECT count(*) FROM kb_pages_fts WHERE kb_pages_fts MATCH ?", ["alpha"])

    assert {:ok, %{rows: [[1]]}} =
             Repo.query("SELECT count(*) FROM kb_pages_fts WHERE kb_pages_fts MATCH ?", ["bravo"])
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
