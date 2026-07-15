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

  test "appends trimmed search query to the GitHub open-PR search" do
    rest_get = fn path, _opts ->
      assert path =~ "q="
      assert path =~ URI.encode_www_form("repo:o/r is:pr is:open 9174")
      send(self(), {:searched, path})

      {:ok,
       %{
         status: 200,
         body: %{
           "items" => [
             %{
               "number" => 9174,
               "title" => "GraphQL Go API",
               "html_url" => "https://github.com/o/r/pull/9174",
               "pull_request" => %{"html_url" => "https://github.com/o/r/pull/9174"},
               "user" => %{"login" => "dev"},
               "updated_at" => "2026-07-14T10:00:00Z",
               "body" => ""
             }
           ]
         }
       }}
    end

    prs = ProjectPullRequests.list_open(["o/r"], rest_get_fun: rest_get, q: "  9174  ")
    assert [%{number: 9174}] = prs
    assert_received {:searched, _}
  end

  test "ignores blank search queries and keeps the default open-PR search" do
    rest_get = fn path, _opts ->
      assert path =~ URI.encode_www_form("repo:o/r is:pr is:open")
      refute path =~ "9174"
      {:ok, %{status: 200, body: %{"items" => []}}}
    end

    assert ProjectPullRequests.list_open(["o/r"], rest_get_fun: rest_get, q: "  ") == []
  end
end
