defmodule SymphonyElixir.GitHub.IssueCommentsTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.GitHub.IssueComments

  setup do
    prev = System.get_env("GITHUB_TOKEN")
    System.put_env("GITHUB_TOKEN", "test-gh-token")
    on_exit(fn -> restore_env("GITHUB_TOKEN", prev) end)
    :ok
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
        assert payload["query"] =~ "SymphonyApiIssueComments"
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
                       %{
                         "body" => "## Codex Workpad",
                         "createdAt" => "2026-05-26T10:00:00Z",
                         "author" => %{"login" => "codex-bot"}
                       },
                       %{
                         "body" => "Reviewed",
                         "createdAt" => "2026-05-27T10:00:00Z",
                         "author" => %{"login" => "alice"}
                       }
                     ]
                   }
                 }
               }
             }
           }
         }}
      end

      assert {:ok, [%{kind: "comment", author: "alice"}, %{kind: "workpad", author: "codex-bot"}]} =
               IssueComments.for_issue("o/r", "#42", request_fun: request_fun)
    end

    test "returns empty list for a missing issue" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"data" => %{"repository" => %{"issue" => nil}}}}}
      end

      assert {:ok, []} = IssueComments.for_issue("o/r", "999", request_fun: request_fun)
    end

    test "degrades a non-issue GraphQL error to an empty list" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"errors" => [%{"type" => "NOT_FOUND", "message" => "Could not resolve to an Issue"}]}}}
      end

      assert {:ok, []} = IssueComments.for_issue("o/r", "42", request_fun: request_fun)
    end
  end

  describe "create/4" do
    test "resolves the issue node id then posts the comment" do
      request_fun = fn payload, _headers ->
        cond do
          payload["query"] =~ "SymphonyApiIssueNodeId" ->
            assert payload["variables"]["number"] == 42
            {:ok, %{status: 200, body: %{"data" => %{"repository" => %{"issue" => %{"id" => "I_99"}}}}}}

          payload["query"] =~ "SymphonyApiAddComment" ->
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
               IssueComments.create("o/r", "#42", "## Codex Workpad", request_fun: request_fun)
    end

    test "returns issue_not_found when the issue node is missing" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"data" => %{"repository" => %{"issue" => nil}}}}}
      end

      assert {:error, :issue_not_found} =
               IssueComments.create("o/r", "#42", "hello", request_fun: request_fun)
    end

    test "falls back to REST when GraphQL is rate-limited" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"errors" => [%{"type" => "RATE_LIMITED"}]}}}
      end

      rest_fun = fn url, _headers, body ->
        assert url == "https://api.github.com/repos/o/r/issues/42/comments"
        assert body == %{"body" => "hello"}
        {:ok, %{status: 201, body: %{"id" => 5, "html_url" => "u", "body" => "hello", "user" => %{"login" => "a"}}}}
      end

      assert {:ok, %{id: "5", body: "hello"}} =
               IssueComments.create("o/r", "#42", "hello",
                 request_fun: request_fun,
                 rest_request_fun: rest_fun
               )
    end
  end

  describe "create_for_subject/3" do
    test "posts to the issue node id without a number lookup" do
      request_fun = fn payload, _headers ->
        refute payload["query"] =~ "SymphonyApiIssueNodeId"
        assert payload["variables"]["subjectId"] == "I_node"

        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "addComment" => %{
                 "commentEdge" => %{"node" => %{"id" => "IC_7", "body" => "## Codex Evidence", "author" => %{"login" => "bot"}}}
               }
             }
           }
         }}
      end

      assert {:ok, %{id: "IC_7", kind: "evidence"}} =
               IssueComments.create_for_subject("I_node", "## Codex Evidence", request_fun: request_fun)
    end

    test "rejects a blank subject id" do
      assert {:error, :invalid_arguments} = IssueComments.create_for_subject("", "body")
    end
  end
end
