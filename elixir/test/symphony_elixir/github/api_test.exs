defmodule SymphonyElixir.GitHub.ApiTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.GitHub.Api

  setup do
    prev = System.get_env("GITHUB_TOKEN")
    System.put_env("GITHUB_TOKEN", "test-gh-token")
    on_exit(fn -> restore_env("GITHUB_TOKEN", prev) end)
    :ok
  end

  # GraphQL 200 body carrying a RATE_LIMIT error (how GitHub signals GraphQL limits).
  defp graphql_rate_limited do
    {:ok,
     %{
       status: 200,
       headers: %{"x-ratelimit-reset" => "4102444800"},
       body: %{"errors" => [%{"type" => "RATE_LIMITED", "message" => "rate limited"}]}
     }}
  end

  describe "add_comment/4" do
    test "uses GraphQL on the happy path and normalizes the node" do
      request_fun = fn payload, _headers ->
        cond do
          payload["query"] =~ "SymphonyApiIssueNodeId" ->
            {:ok, %{status: 200, body: %{"data" => %{"repository" => %{"issue" => %{"id" => "I_node"}}}}}}

          payload["query"] =~ "SymphonyApiAddComment" ->
            assert payload["variables"]["subjectId"] == "I_node"

            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "addComment" => %{
                     "commentEdge" => %{
                       "node" => %{
                         "id" => "IC_1",
                         "url" => "https://gh/c/1",
                         "body" => "## Codex Workpad\nx",
                         "createdAt" => "2026-06-01T00:00:00Z",
                         "updatedAt" => "2026-06-01T00:00:00Z",
                         "author" => %{"login" => "bot"}
                       }
                     }
                   }
                 }
               }
             }}
        end
      end

      assert {:ok, comment} =
               Api.add_comment("owner/repo", "42", "## Codex Workpad\nx", request_fun: request_fun)

      assert comment.id == "IC_1"
      assert comment.author == "bot"
      assert comment.kind == "workpad"
      assert comment.url == "https://gh/c/1"
    end

    test "falls back to REST when GraphQL is rate-limited, normalizing to the same shape" do
      request_fun = fn _payload, _headers -> graphql_rate_limited() end

      rest_fun = fn url, _headers, body ->
        assert url == "https://api.github.com/repos/owner/repo/issues/42/comments"
        assert body == %{"body" => "## Codex Workpad\nx"}

        {:ok,
         %{
           status: 201,
           body: %{
             "id" => 999,
             "html_url" => "https://gh/c/999",
             "body" => "## Codex Workpad\nx",
             "created_at" => "2026-06-01T00:00:00Z",
             "updated_at" => "2026-06-01T00:00:00Z",
             "user" => %{"login" => "bot"}
           }
         }}
      end

      assert {:ok, comment} =
               Api.add_comment("owner/repo", "42", "## Codex Workpad\nx",
                 request_fun: request_fun,
                 rest_request_fun: rest_fun
               )

      assert comment.id == "999"
      assert comment.author == "bot"
      assert comment.kind == "workpad"
      assert comment.url == "https://gh/c/999"
    end

    test "non-rate-limit GraphQL error passes through without calling REST" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"errors" => [%{"type" => "NOT_FOUND", "message" => "nope"}]}}}
      end

      rest_fun = fn _u, _h, _b -> flunk("REST must not be called for non-rate-limit errors") end

      assert {:error, _reason} =
               Api.add_comment("owner/repo", "42", "x",
                 request_fun: request_fun,
                 rest_request_fun: rest_fun
               )
    end
  end

  describe "add_comment_by_subject/3" do
    test "posts directly to the issue node id without resolving a numeric number" do
      request_fun = fn payload, _headers ->
        # No issue-number lookup happens: we already have the node id.
        refute payload["query"] =~ "SymphonyApiIssueNodeId"
        assert payload["query"] =~ "SymphonyApiAddComment"
        assert payload["variables"]["subjectId"] == "I_kwDOJHngx8"

        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "addComment" => %{
                 "commentEdge" => %{
                   "node" => %{
                     "id" => "IC_evidence",
                     "url" => "https://gh/c/evidence",
                     "body" => "## Codex Evidence",
                     "author" => %{"login" => "bot"}
                   }
                 }
               }
             }
           }
         }}
      end

      assert {:ok, %{id: "IC_evidence", kind: "evidence"}} =
               Api.add_comment_by_subject("I_kwDOJHngx8", "## Codex Evidence", request_fun: request_fun)
    end

    test "maps an unexpected payload to :remote_unavailable" do
      request_fun = fn _payload, _headers -> {:ok, %{status: 200, body: %{"data" => %{}}}} end

      assert {:error, :remote_unavailable} =
               Api.add_comment_by_subject("I_node", "body", request_fun: request_fun)
    end
  end

  describe "list_comments/3" do
    test "GraphQL happy path, normalized" do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyApiIssueComments"

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
                         "id" => "IC_1",
                         "url" => "u1",
                         "body" => "first",
                         "createdAt" => "t1",
                         "updatedAt" => "t1",
                         "author" => %{"login" => "a"}
                       }
                     ]
                   }
                 }
               }
             }
           }
         }}
      end

      assert {:ok, [%{id: "IC_1", body: "first", kind: "comment"}]} =
               Api.list_comments("owner/repo", "42", request_fun: request_fun)
    end

    test "falls back to REST on rate limit with identical shape" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"errors" => [%{"type" => "RATE_LIMITED"}]}}}
      end

      rest_fun = fn url, _headers ->
        assert url == "https://api.github.com/repos/owner/repo/issues/42/comments?per_page=100"

        {:ok,
         %{
           status: 200,
           body: [
             %{
               "id" => 1,
               "html_url" => "u1",
               "body" => "first",
               "created_at" => "t1",
               "updated_at" => "t1",
               "user" => %{"login" => "a"}
             }
           ]
         }}
      end

      assert {:ok, [%{id: "1", body: "first", kind: "comment", url: "u1"}]} =
               Api.list_comments("owner/repo", "42", request_fun: request_fun, rest_request_fun: rest_fun)
    end
  end

  describe "transition_issue_open_state/4" do
    test "GraphQL close returns normalized CLOSED" do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyApiCloseIssue"
        assert payload["variables"]["issueId"] == "I_node"

        {:ok,
         %{
           status: 200,
           body: %{"data" => %{"closeIssue" => %{"issue" => %{"id" => "I_node", "state" => "CLOSED"}}}}
         }}
      end

      assert {:ok, %{state: "CLOSED"}} =
               Api.transition_issue_open_state("owner/repo", "I_node", :close, request_fun: request_fun)
    end

    test "falls back to REST PUT on rate limit (reopen -> OPEN)" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"errors" => [%{"type" => "RATE_LIMITED"}]}}}
      end

      rest_fun = fn url, _headers, body ->
        assert url == "https://api.github.com/repos/owner/repo/issues/42"
        assert body == %{"state" => "open"}
        {:ok, %{status: 200, body: %{"state" => "open"}}}
      end

      assert {:ok, %{state: "OPEN"}} =
               Api.transition_issue_open_state("owner/repo", "I_node", :reopen,
                 request_fun: request_fun,
                 rest_request_fun: rest_fun,
                 issue_number: 42
               )
    end

    test "rate-limited without issue_number defers with capability" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"errors" => [%{"type" => "RATE_LIMITED"}]}}}
      end

      assert {:error, {:rate_limited, %{capability: :needs_issue_number}}} =
               Api.transition_issue_open_state("owner/repo", "I_node", :close, request_fun: request_fun)
    end
  end

  describe "list_label_issues/3" do
    test "GraphQL happy path returns number+node_id" do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyApiLabelIssues"

        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "repository" => %{
                 "issues" => %{
                   "nodes" => [%{"id" => "I_1", "number" => 11}],
                   "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
                 }
               }
             }
           }
         }}
      end

      assert {:ok, [%{number: 11, node_id: "I_1"}]} =
               Api.list_label_issues("owner/repo", "symphony", request_fun: request_fun)
    end

    test "falls back to REST and follows pagination Link header" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"errors" => [%{"type" => "RATE_LIMITED"}]}}}
      end

      rest_fun = fn url, _headers ->
        if url =~ "page=2" do
          {:ok, %{status: 200, headers: %{}, body: [%{"number" => 22, "node_id" => "I_2"}]}}
        else
          {:ok,
           %{
             status: 200,
             headers: %{
               "link" => "<https://api.github.com/repos/owner/repo/issues?labels=symphony&state=open&per_page=100&page=2>; rel=\"next\""
             },
             body: [%{"number" => 11, "node_id" => "I_1"}]
           }}
        end
      end

      assert {:ok, [%{number: 11, node_id: "I_1"}, %{number: 22, node_id: "I_2"}]} =
               Api.list_label_issues("owner/repo", "symphony",
                 request_fun: request_fun,
                 rest_request_fun: rest_fun
               )
    end
  end

  describe "list_issue_prs/4" do
    test "GraphQL happy path returns basic PR records" do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyApiIssuePRs"

        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "repository" => %{
                 "issue" => %{
                   "closedByPullRequestsReferences" => %{
                     "nodes" => [
                       %{"number" => 7, "url" => "pr7", "title" => "t", "state" => "OPEN", "merged" => false}
                     ]
                   }
                 }
               }
             }
           }
         }}
      end

      assert {:ok, [%{number: 7, url: "pr7", title: "t", state: "open"}]} =
               Api.list_issue_prs("owner/repo", "42", "feat/x", request_fun: request_fun)
    end

    test "REST fallback maps merged/closed/open" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"errors" => [%{"type" => "RATE_LIMITED"}]}}}
      end

      rest_fun = fn url, _headers ->
        assert url =~ "/repos/owner/repo/pulls?head=owner:feat/x&state=all"

        {:ok,
         %{
           status: 200,
           body: [
             %{
               "number" => 7,
               "html_url" => "pr7",
               "title" => "t",
               "state" => "closed",
               "merged_at" => "2026-06-01T00:00:00Z"
             }
           ]
         }}
      end

      assert {:ok, [%{number: 7, url: "pr7", title: "t", state: "merged"}]} =
               Api.list_issue_prs("owner/repo", "42", "feat/x",
                 request_fun: request_fun,
                 rest_request_fun: rest_fun
               )
    end
  end

  describe "pull_request_detail/3" do
    test "GraphQL happy path returns the rich rollup" do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyPullRequestByNumber"
        assert payload["variables"]["owner"] == "clouapp"
        assert payload["variables"]["name"] == "back"
        assert payload["variables"]["number"] == 277

        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "repository" => %{
                 "pullRequest" => %{
                   "number" => 277,
                   "title" => "Backend fix",
                   "url" => "https://github.com/clouapp/back/pull/277",
                   "state" => "OPEN",
                   "isDraft" => false,
                   "merged" => false,
                   "headRefName" => "fix-277",
                   "baseRefName" => "dev",
                   "repository" => %{"nameWithOwner" => "clouapp/back"},
                   "author" => %{"login" => "codex-bot"},
                   "updatedAt" => "2026-06-01T12:00:00Z",
                   "commits" => %{
                     "nodes" => [
                       %{
                         "commit" => %{
                           "statusCheckRollup" => %{
                             "state" => "FAILURE",
                             "contexts" => %{
                               "nodes" => [
                                 %{
                                   "__typename" => "CheckRun",
                                   "name" => "tests (1) / test",
                                   "status" => "COMPLETED",
                                   "conclusion" => "FAILURE",
                                   "checkSuite" => %{
                                     "workflowRun" => %{
                                       "url" => "https://github.com/clouapp/back/actions/runs/9",
                                       "workflow" => %{"name" => "CI/CD Pipeline"}
                                     }
                                   }
                                 }
                               ]
                             }
                           }
                         }
                       }
                     ]
                   },
                   "comments" => %{"nodes" => []},
                   "reviews" => %{"nodes" => []}
                 }
               }
             }
           }
         }}
      end

      assert {:ok, pr} =
               Api.pull_request_detail("clouapp/back", 277, request_fun: request_fun)

      assert pr.number == 277
      assert pr.checks_state == "FAILURE"
      assert [%{name: "CI/CD Pipeline", jobs: [%{name: "tests (1) / test"}]}] = pr.pipelines
    end

    test "falls back to REST check-runs when GraphQL is rate-limited" do
      request_fun = fn _payload, _headers -> graphql_rate_limited() end

      rest_fun = fn url, _headers ->
        cond do
          url == "https://api.github.com/repos/clouapp/back/pulls/277" ->
            {:ok,
             %{
               status: 200,
               body: %{
                 "html_url" => "https://github.com/clouapp/back/pull/277",
                 "title" => "Backend fix",
                 "state" => "open",
                 "draft" => false,
                 "merged" => false,
                 "merged_at" => nil,
                 "head" => %{"sha" => "075310af"}
               }
             }}

          url =~ "/repos/clouapp/back/commits/075310af/check-runs" ->
            {:ok,
             %{
               status: 200,
               body: %{
                 "total_count" => 3,
                 "check_runs" => [
                   %{
                     "id" => 1,
                     "name" => "tests (1) / test",
                     "status" => "completed",
                     "conclusion" => "failure",
                     "details_url" => "https://github.com/clouapp/back/runs/1",
                     "started_at" => "2026-06-01T11:00:00Z",
                     "completed_at" => "2026-06-01T11:02:00Z",
                     "app" => %{"name" => "GitHub Actions"}
                   },
                   %{
                     "id" => 2,
                     "name" => "deploy-macro",
                     "status" => "completed",
                     "conclusion" => "skipped",
                     "details_url" => "https://github.com/clouapp/back/runs/2",
                     "app" => %{"name" => "GitHub Actions"}
                   }
                 ]
               }
             }}

          url =~ "/repos/clouapp/back/commits/075310af/status" ->
            {:ok, %{status: 200, body: %{"state" => "failure", "statuses" => []}}}

          true ->
            flunk("unexpected REST url: #{url}")
        end
      end

      assert {:ok, pr} =
               Api.pull_request_detail("clouapp/back", 277,
                 request_fun: request_fun,
                 rest_request_fun: rest_fun
               )

      assert pr.number == 277
      assert pr.repo == "clouapp/back"
      assert pr.url == "https://github.com/clouapp/back/pull/277"
      assert pr.title == "Backend fix"
      assert pr.state == "open"
      assert pr.checks_state == "FAILURE"

      assert [%{name: "GitHub Actions", jobs: jobs}] = pr.pipelines
      assert Enum.map(jobs, & &1.name) == ["tests (1) / test", "deploy-macro"]

      failing = Enum.find(jobs, &(&1.name == "tests (1) / test"))
      assert failing.conclusion == "FAILURE"
      assert failing.status == "COMPLETED"
      assert failing.job_id == 1
    end

    test "returns {:ok, nil} when the PR is not visible (REST 404)" do
      request_fun = fn _payload, _headers -> graphql_rate_limited() end
      rest_fun = fn _url, _headers -> {:ok, %{status: 404, body: %{"message" => "Not Found"}}} end

      assert {:ok, nil} =
               Api.pull_request_detail("clouapp/back", 277,
                 request_fun: request_fun,
                 rest_request_fun: rest_fun
               )
    end
  end
end
