defmodule SymphonyElixir.Assistant.PullRequestToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.PullRequestTools
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!()
    :ok
  end

  defp project_with_issue do
    {:ok, _} = Context.ensure_project(%{name: "Macro", slug: "macro"})
    {:ok, issue} = Context.create_issue("macro", %{"title" => "T", "status" => "Todo"})
    issue
  end

  test "assistant spec requires identifier and url" do
    spec = PullRequestTools.assistant_tool_spec()
    assert spec["name"] == "link_pull_request"
    assert "identifier" in spec["inputSchema"]["required"]
    assert "url" in spec["inputSchema"]["required"]
  end

  test "issue-bound spec requires only url" do
    spec = PullRequestTools.issue_bound_tool_spec()
    assert spec["inputSchema"]["required"] == ["url"]
  end

  test "links a valid PR url to the issue" do
    issue = project_with_issue()

    assert {:ok, result} =
             PullRequestTools.execute("macro", %{
               "identifier" => issue.identifier,
               "url" => "https://github.com/org/repo/pull/42"
             })

    assert result.tool == "link_pull_request"
    assert result.data.pull_request.number == 42
    assert result.data.pull_request.repo == "org/repo"
    assert result.data.pull_request.origin == "manual"
  end

  test "rejects an invalid PR url" do
    issue = project_with_issue()

    assert {:error, :invalid_pr_url} =
             PullRequestTools.execute("macro", %{"identifier" => issue.identifier, "url" => "nope"})
  end

  test "requires a url" do
    issue = project_with_issue()

    assert {:error, :missing_url} =
             PullRequestTools.execute("macro", %{"identifier" => issue.identifier})
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
