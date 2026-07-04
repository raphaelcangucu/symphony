defmodule SymphonyElixir.GitHub.ProjectIssuesTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.ProjectIssues

  test "list returns normalized GitHub issues for configured repositories" do
    rest_get = fn "/search/issues?" <> query, [] ->
      assert %{"q" => "repo:acme/app is:issue state:open", "per_page" => "50"} = URI.decode_query(query)

      {:ok,
       %{
         body: %{
           "items" => [
             %{
               "number" => 42,
               "title" => "Fix auth bug",
               "html_url" => "https://github.com/acme/app/issues/42",
               "state" => "open",
               "updated_at" => "2026-07-03T12:00:00Z",
               "user" => %{"login" => "octocat"}
             }
           ]
         }
       }}
    end

    assert [
             %{
               number: 42,
               title: "Fix auth bug",
               url: "https://github.com/acme/app/issues/42",
               repo: "acme/app",
               state: "open",
               author: "octocat",
               updated_at: "2026-07-03T12:00:00Z"
             }
           ] = ProjectIssues.list(["acme/app"], state: "open", rest_get_fun: rest_get)
  end

  test "list returns an empty list for invalid or empty repo configuration" do
    assert [] = ProjectIssues.list([], rest_get_fun: fn _path, _opts -> flunk("not called") end)
    assert [] = ProjectIssues.list(["not-a-repo"], rest_get_fun: fn _path, _opts -> flunk("not called") end)
  end

  test "list omits state qualifier when requesting all issues" do
    rest_get = fn "/search/issues?" <> query, [] ->
      assert %{"q" => "repo:acme/app is:issue"} = URI.decode_query(query)

      {:ok, %{body: %{"items" => []}}}
    end

    assert [] = ProjectIssues.list(["acme/app"], state: "all", rest_get_fun: rest_get)
  end
end
