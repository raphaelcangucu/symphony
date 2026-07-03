defmodule SymphonyElixir.GitHub.ProjectPullRequestsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.ProjectPullRequests

  defmodule FakeClient do
    @moduledoc false

    def rest_get("/search/issues?" <> _qs = _path, _opts) do
      {:ok,
       %{
         status: 200,
         body: %{
           "items" => [
             %{
               "number" => 42,
               "title" => "Fix login",
               "html_url" => "https://github.com/o/r/pull/42",
               "pull_request" => %{"html_url" => "https://github.com/o/r/pull/42"},
               "user" => %{"login" => "codex-bot"},
               "updated_at" => "2026-06-20T10:00:00Z",
               "body" => "Symphony-Issue: DEMO-7\n\nfixes things"
             }
           ]
         }
       }}
    end
  end

  test "lists open PRs across repos, annotated with the tracker issue identifier" do
    prs =
      ProjectPullRequests.list_open(["o/r"],
        client_module: FakeClient,
        marker_key: "Symphony-Issue"
      )

    assert [pr] = prs
    assert pr.number == 42
    assert pr.repo == "o/r"
    assert pr.url == "https://github.com/o/r/pull/42"
    assert pr.title == "Fix login"
    assert pr.author == "codex-bot"
    assert pr.issue_identifier == "DEMO-7"
  end

  test "returns [] and never raises when a repo search fails" do
    failing = fn _path, _opts -> {:error, :boom} end
    assert ProjectPullRequests.list_open(["o/r"], rest_get_fun: failing) == []
  end
end
