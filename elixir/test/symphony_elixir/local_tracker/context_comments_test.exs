defmodule SymphonyElixir.LocalTracker.ContextCommentsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    {:ok, project} = Context.ensure_project(%{name: "MM", slug: "mm"})
    {:ok, issue} = Context.create_issue("mm", %{title: "Do the thing", status: "Todo"})
    %{project: project, issue: issue}
  end

  test "add_comment classifies workpad bodies", %{project: project, issue: issue} do
    {:ok, comment} = Context.add_comment(project.slug, issue.identifier, "## Codex Workpad\n\nPlan", %{})
    assert comment.kind == "workpad"

    {:ok, plain} = Context.add_comment(project.slug, issue.identifier, "hello", %{})
    assert plain.kind == "comment"
  end

  test "explicit kind attr still wins", %{project: project, issue: issue} do
    {:ok, comment} = Context.add_comment(project.slug, issue.identifier, "body", %{kind: "workpad"})
    assert comment.kind == "workpad"
  end

  test "update_comment replaces body and reclassifies", %{project: project, issue: issue} do
    {:ok, comment} = Context.add_comment(project.slug, issue.identifier, "## Codex Workpad\nv1", %{})
    {:ok, updated} = Context.update_comment(comment.id, "## Codex Workpad\nv2")
    assert updated.body =~ "v2"
    assert updated.kind == "workpad"
  end

  test "update_comment for an unknown id returns not_found" do
    assert {:error, :not_found} = Context.update_comment(999_999, "body")
  end

  test "delete_issue_comment removes the comment", %{project: project, issue: issue} do
    {:ok, comment} = Context.add_comment(project.slug, issue.identifier, "to delete", %{})
    assert {:ok, deleted} = Context.delete_issue_comment(project.slug, issue.identifier, comment.id)
    assert deleted.id == comment.id
    assert {:ok, []} = Context.list_comments(project.slug, issue.identifier)
  end

  test "delete_issue_comment for an unknown id returns not_found", %{project: project, issue: issue} do
    assert {:error, :comment_not_found} = Context.delete_issue_comment(project.slug, issue.identifier, 999_999)
  end

  test "latest_workpad returns the newest workpad comment", %{project: project, issue: issue} do
    {:ok, _} = Context.add_comment(project.slug, issue.identifier, "plain", %{})
    {:ok, wp} = Context.add_comment(project.slug, issue.identifier, "## Codex Workpad\nv1", %{})
    assert {:ok, found} = Context.latest_workpad(project.slug, issue.identifier)
    assert found.id == wp.id
  end

  test "latest_workpad without workpad returns error", %{project: project, issue: issue} do
    {:ok, _} = Context.add_comment(project.slug, issue.identifier, "plain", %{})
    assert {:error, :not_found} = Context.latest_workpad(project.slug, issue.identifier)
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
