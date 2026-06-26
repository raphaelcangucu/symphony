defmodule SymphonyElixir.KnowledgeBase.SearchTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.{Indexer, PageRecord, Search}
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    on_exit(fn -> Repo.delete_all(PageRecord) end)

    insert("acme", "acme~web", "auth.md", "Authentication", "rotate the refresh token nightly")
    insert("acme", "acme~api", "tokens.md", "Tokens", "the refresh flow lives here")
    insert("acme", "acme~web", "ui.md", "Buttons", "unrelated content about colors")
    :ok
  end

  test "query returns ranked results across repos with a snippet" do
    assert {:ok, results} = Search.search_project("acme", "refresh", [])
    paths = Enum.map(results, & &1.path)
    assert "auth.md" in paths and "tokens.md" in paths
    refute "ui.md" in paths
    assert Enum.all?(results, &is_binary(&1.snippet))
    assert Enum.all?(results, &(&1.repo_slug in ["acme~web", "acme~api"]))
  end

  test "repo filter narrows results to one repository" do
    assert {:ok, results} = Search.search_project("acme", "refresh", repo_slug: "acme~web")
    assert Enum.map(results, & &1.repo_slug) |> Enum.uniq() == ["acme~web"]
  end

  test "blank or too-short queries return an empty list without error" do
    assert {:ok, []} = Search.search_project("acme", "  ", [])
    assert {:ok, []} = Search.search_project("acme", "a", [])
  end

  test "special FTS characters are treated as literal terms" do
    insert("acme", "acme~web", "weird.md", "C++ guide", "pointers and refs")
    assert {:ok, results} = Search.search_project("acme", "C++", [])
    assert Enum.any?(results, &(&1.path == "weird.md"))
  end

  defp insert(p, r, path, title, body) do
    {:ok, _} = Indexer.index_page(p, r, path, "---\ntitle: #{title}\n---\n#{body}\n")
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
