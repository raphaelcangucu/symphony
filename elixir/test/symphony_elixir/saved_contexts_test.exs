defmodule SymphonyElixir.SavedContextsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Repo
  alias SymphonyElixir.SavedContexts
  alias SymphonyElixir.SavedContexts.Entry

  setup do
    migrate_repo()
    Repo.delete_all(Entry)
    :ok
  end

  test "create, list, and get_by_slug manage saved context entries" do
    assert {:ok, entry} =
             SavedContexts.create(%{
               project_slug: "sym",
               slug: "task-summary",
               name: "Task summary",
               content_md: "# Task summary",
               source_scope: "execution",
               source_issue_identifier: "SYM-1"
             })

    assert entry.slug == "task-summary"
    assert [listed] = SavedContexts.list("sym")
    assert listed.id == entry.id
    assert %Entry{id: id} = SavedContexts.get_by_slug("sym", "task-summary")
    assert id == entry.id
  end

  test "generate returns an explicit not_configured error until agent summarization is wired" do
    assert {:error, :not_configured} = SavedContexts.generate(%{project_slug: "sym"}, %{})
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
