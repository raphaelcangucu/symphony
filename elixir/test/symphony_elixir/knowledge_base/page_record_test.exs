defmodule SymphonyElixir.KnowledgeBase.PageRecordTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.PageRecord
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    on_exit(fn -> Repo.delete_all(PageRecord) end)
    :ok
  end

  test "inserts and enforces uniqueness on project/repo/path" do
    attrs = %{
      project_slug: "p",
      repo_slug: "acme~web",
      path: "index.md",
      title: "Home",
      body: "hello"
    }

    assert {:ok, _} = %PageRecord{} |> PageRecord.changeset(attrs) |> Repo.insert()
    assert {:error, cs} = %PageRecord{} |> PageRecord.changeset(attrs) |> Repo.insert()
    refute cs.valid?
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end
end
