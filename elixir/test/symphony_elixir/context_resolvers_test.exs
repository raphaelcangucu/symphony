defmodule SymphonyElixir.ContextResolversTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.ContextResolvers
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)

    {:ok, project} = Context.ensure_project(%{name: "Symphony Tracker", slug: "symphony-tracker"})
    %{project: project}
  end

  test "board_issue includes identifier, title, status, description, and recent comments", %{project: project} do
    {:ok, issue} =
      Context.create_issue(project.slug, %{
        title: "Load context into composer",
        description: "Composer should carry issue context.",
        status: "Todo"
      })

    {:ok, _comment} =
      Context.add_comment(project.slug, issue.identifier, "Remember to keep one composer.", %{author: "raphael"})

    assert {:ok, %{title: title, content_md: markdown}} =
             ContextResolvers.resolve(project, "board_issue", issue.identifier, %{})

    assert title == "#{issue.identifier} Load context into composer"
    assert markdown =~ "### Board issue #{issue.identifier}"
    assert markdown =~ "Load context into composer"
    assert markdown =~ "Status: Todo"
    assert markdown =~ "Composer should carry issue context."
    assert markdown =~ "raphael"
    assert markdown =~ "Remember to keep one composer."
  end

  test "unknown kind returns an error", %{project: project} do
    assert {:error, {:unsupported_kind, "nope"}} =
             ContextResolvers.resolve(project, "nope", "SYM-1", %{})
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
