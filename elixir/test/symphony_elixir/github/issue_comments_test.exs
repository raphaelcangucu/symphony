defmodule SymphonyElixir.GitHub.IssueCommentsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.IssueComments

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

  describe "parse_node/1" do
    test "classifies the Codex Workpad comment" do
      node = %{
        "id" => "IC_1",
        "url" => "https://github.com/o/r/issues/1#issuecomment-1",
        "body" => "## Codex Workpad\n\n### Acceptance criteria",
        "createdAt" => "2026-05-26T10:00:00Z",
        "updatedAt" => "2026-05-26T11:00:00Z",
        "author" => %{"login" => "codex-bot"}
      }

      assert %{kind: "workpad", author: "codex-bot", url: "https://github.com/o/r/issues/1#issuecomment-1"} =
               IssueComments.parse_node(node)
    end

    test "classifies a regular comment" do
      node = %{"body" => "Looks good to me", "author" => %{"login" => "alice"}}
      assert %{kind: "comment", author: "alice"} = IssueComments.parse_node(node)
    end
  end

  describe "for_issue/3" do
    test "fetches and parses issue comments" do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyTrackerIssueComments"
        assert payload["variables"]["number"] == 42

        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "repository" => %{
                 "issue" => %{
                   "comments" => %{
                     "nodes" => [
                       %{"body" => "## Codex Workpad", "author" => %{"login" => "codex-bot"}},
                       %{"body" => "Reviewed", "author" => %{"login" => "alice"}}
                     ]
                   }
                 }
               }
             }
           }
         }}
      end

      assert {:ok, [%{kind: "workpad"}, %{kind: "comment"}]} =
               IssueComments.for_issue("o/r", "#42",
                 client_module: TestClient,
                 request_fun: request_fun
               )
    end

    test "returns empty list for a missing issue" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"data" => %{"repository" => %{"issue" => nil}}}}}
      end

      assert {:ok, []} =
               IssueComments.for_issue("o/r", "999",
                 client_module: TestClient,
                 request_fun: request_fun
               )
    end
  end

  describe "create/4" do
    test "resolves the issue node id then posts the comment" do
      request_fun = fn payload, _headers ->
        cond do
          payload["query"] =~ "SymphonyTrackerIssueNodeId" ->
            assert payload["variables"]["number"] == 42
            {:ok, %{status: 200, body: %{"data" => %{"repository" => %{"issue" => %{"id" => "I_99"}}}}}}

          payload["query"] =~ "SymphonyTrackerAddIssueComment" ->
            assert payload["variables"]["subjectId"] == "I_99"
            assert payload["variables"]["body"] == "## Codex Workpad"

            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "addComment" => %{
                     "commentEdge" => %{
                       "node" => %{
                         "id" => "IC_99",
                         "url" => "https://github.com/o/r/issues/42#issuecomment-99",
                         "body" => "## Codex Workpad",
                         "createdAt" => "2026-05-27T10:00:00Z",
                         "author" => %{"login" => "codex-bot"}
                       }
                     }
                   }
                 }
               }
             }}
        end
      end

      assert {:ok, %{id: "IC_99", kind: "workpad", author: "codex-bot"}} =
               IssueComments.create("o/r", "#42", "## Codex Workpad",
                 client_module: TestClient,
                 request_fun: request_fun
               )
    end

    test "returns issue_not_found when the issue node is missing" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"data" => %{"repository" => %{"issue" => nil}}}}}
      end

      assert {:error, :issue_not_found} =
               IssueComments.create("o/r", "#42", "hello",
                 client_module: TestClient,
                 request_fun: request_fun
               )
    end
  end
end
