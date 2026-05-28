defmodule SymphonyElixir.GitHub.IssueDiscussionTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.IssueDiscussion
  alias SymphonyElixir.Issue

  defmodule TestClient do
    @moduledoc false

    def graphql(query, variables, opts) do
      request_fun = Keyword.fetch!(opts, :request_fun)

      case request_fun.(%{"query" => query, "variables" => variables}, []) do
        {:ok, %{status: 200, body: body}} -> {:ok, body}
        {:error, _reason} = error -> error
      end
    end
  end

  describe "parse_issue_comments/1" do
    test "maps issue comment nodes" do
      content = %{
        "comments" => %{
          "nodes" => [
            %{
              "author" => %{"login" => "reviewer"},
              "body" => "Please fix the locale bug",
              "createdAt" => "2026-05-26T10:00:00Z"
            }
          ]
        }
      }

      assert [
               %{
                 "author" => "reviewer",
                 "body" => "Please fix the locale bug",
                 "created_at" => "2026-05-26T10:00:00Z",
                 "source" => "issue"
               }
             ] = IssueDiscussion.parse_issue_comments(content)
    end

    test "returns empty list when no comments" do
      assert IssueDiscussion.parse_issue_comments(%{}) == []
    end
  end

  describe "enrich_issues/3" do
    test "appends PR review comments" do
      issue = %Issue{
        id: "I_1",
        identifier: "502",
        title: "Test",
        comments: [
          %{
            "author" => "human",
            "body" => "Rework this",
            "created_at" => "2026-05-26T09:00:00Z",
            "source" => "issue"
          }
        ]
      }

      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyGitHubIssuePRDiscussion"
        assert payload["variables"]["number"] == 502

        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "repository" => %{
                 "issue" => %{
                   "closedByPullRequestsReferences" => %{
                     "nodes" => [
                       %{
                         "number" => 503,
                         "title" => "Fix",
                         "comments" => %{"nodes" => []},
                         "reviews" => %{
                           "nodes" => [
                             %{
                               "author" => %{"login" => "alice"},
                               "body" => "Use homolog path helper",
                               "state" => "CHANGES_REQUESTED",
                               "createdAt" => "2026-05-26T11:00:00Z"
                             }
                           ]
                         },
                         "reviewThreads" => %{"nodes" => []}
                       }
                     ]
                   }
                 }
               }
             }
           }
         }}
      end

      [enriched] =
        IssueDiscussion.enrich_issues([issue], "clouapp/front",
          client_module: TestClient,
          request_fun: request_fun
        )

      assert Enum.any?(enriched.comments, fn comment ->
               comment["source"] =~ "PR #503 review" and
                 comment["body"] == "Use homolog path helper"
             end)
    end
  end
end
