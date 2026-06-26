defmodule SymphonyElixir.KnowledgeBase.IndexerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.{Indexer, PageRecord}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    Repo.delete_all(PageRecord)
    on_exit(fn -> Repo.delete_all(PageRecord) end)

    docs = Path.join(System.tmp_dir!(), "kb-idx-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(docs, "sub"))
    File.write!(Path.join(docs, "index.md"), "---\ntitle: Home\n---\n# Home\n\nwelcome aboard\n")
    File.write!(Path.join(docs, "sub/a.md"), "---\ntitle: Alpha\n---\n# Alpha\n\nsecret payload\n")
    on_exit(fn -> File.rm_rf(docs) end)
    {:ok, docs: docs}
  end

  test "reindex_dir inserts a row per page with title and body", %{docs: docs} do
    assert {:ok, 2} = Indexer.reindex_dir("acme", "acme~web", docs)

    rows = Repo.all(PageRecord) |> Enum.sort_by(& &1.path)
    assert Enum.map(rows, & &1.path) == ["index.md", "sub/a.md"]
    assert Enum.find(rows, &(&1.path == "sub/a.md")).title == "Alpha"
    assert Enum.find(rows, &(&1.path == "sub/a.md")).body =~ "secret payload"
  end

  test "reindex_dir prunes rows whose files were removed", %{docs: docs} do
    {:ok, 2} = Indexer.reindex_dir("acme", "acme~web", docs)
    File.rm!(Path.join(docs, "sub/a.md"))
    assert {:ok, 1} = Indexer.reindex_dir("acme", "acme~web", docs)
    assert Repo.aggregate(PageRecord, :count) == 1
  end

  test "remove_page deletes a single row", %{docs: docs} do
    {:ok, 2} = Indexer.reindex_dir("acme", "acme~web", docs)
    assert {:ok, _} = Indexer.remove_page("acme", "acme~web", "index.md")
    refute Enum.any?(Repo.all(PageRecord), &(&1.path == "index.md"))
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
