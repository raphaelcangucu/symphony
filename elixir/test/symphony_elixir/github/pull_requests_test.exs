defmodule SymphonyElixir.GitHub.PullRequestsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.PullRequests
  alias SymphonyElixir.LocalTracker.Project

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

  defmodule BranchTestClient do
    @moduledoc false

    def graphql(query, variables, opts) do
      request_fun = Keyword.fetch!(opts, :request_fun)

      case request_fun.(%{"query" => query, "variables" => variables}, []) do
        {:ok, %{status: 200, body: body}} -> {:ok, body}
        {:error, _reason} = error -> error
      end
    end

    def rest_get(path, opts) do
      Keyword.fetch!(opts, :request_fun).(path, nil)
    end
  end

  defp pr_node(overrides) do
    Map.merge(
      %{
        "number" => 503,
        "title" => "Fix locale bug",
        "url" => "https://github.com/acme/app/pull/503",
        "state" => "OPEN",
        "isDraft" => false,
        "merged" => false,
        "mergedAt" => nil,
        "createdAt" => "2026-05-26T09:00:00Z",
        "updatedAt" => "2026-05-26T12:00:00Z",
        "headRefName" => "mac-1-fix-locale",
        "baseRefName" => "main",
        "author" => %{"login" => "codex-bot"},
        "commits" => %{
          "nodes" => [
            %{
              "commit" => %{
                "oid" => "abc123",
                "statusCheckRollup" => %{
                  "state" => "FAILURE",
                  "contexts" => %{
                    "nodes" => [
                      %{
                        "__typename" => "CheckRun",
                        "name" => "lint",
                        "status" => "COMPLETED",
                        "conclusion" => "SUCCESS",
                        "detailsUrl" => "https://github.com/acme/app/runs/1",
                        "startedAt" => "2026-05-26T09:05:00Z",
                        "completedAt" => "2026-05-26T09:06:00Z",
                        "checkSuite" => %{
                          "workflowRun" => %{
                            "url" => "https://github.com/acme/app/actions/runs/100",
                            "workflow" => %{"name" => "CI"}
                          }
                        }
                      },
                      %{
                        "__typename" => "CheckRun",
                        "name" => "unit",
                        "status" => "COMPLETED",
                        "conclusion" => "FAILURE",
                        "detailsUrl" => "https://github.com/acme/app/runs/2",
                        "startedAt" => "2026-05-26T09:05:00Z",
                        "completedAt" => "2026-05-26T09:08:00Z",
                        "checkSuite" => %{
                          "workflowRun" => %{
                            "url" => "https://github.com/acme/app/actions/runs/100",
                            "workflow" => %{"name" => "CI"}
                          }
                        }
                      },
                      %{
                        "__typename" => "StatusContext",
                        "context" => "vercel",
                        "state" => "SUCCESS",
                        "targetUrl" => "https://vercel.com/deploy/1",
                        "description" => "Deployment ready"
                      }
                    ]
                  }
                }
              }
            }
          ]
        },
        "comments" => %{
          "nodes" => [
            %{
              "author" => %{"login" => "codex-bot"},
              "body" => "Codex Workpad\n\n- [x] Done",
              "createdAt" => "2026-05-26T09:10:00Z"
            }
          ]
        },
        "reviews" => %{
          "nodes" => [
            %{
              "author" => %{"login" => "alice"},
              "body" => "Looks good",
              "state" => "APPROVED",
              "createdAt" => "2026-05-26T11:00:00Z"
            }
          ]
        }
      },
      overrides
    )
  end

  describe "parse_pr_node/1" do
    test "maps PR metadata, pipelines, statuses, and conversation" do
      result = PullRequests.parse_pr_node(pr_node(%{}))

      assert result.number == 503
      assert result.state == "open"
      assert result.head_ref == "mac-1-fix-locale"
      assert result.base_ref == "main"
      assert result.author == "codex-bot"
      assert result.checks_state == "FAILURE"

      assert [%{name: "CI", jobs: jobs, url: "https://github.com/acme/app/actions/runs/100"}] =
               result.pipelines

      assert Enum.map(jobs, & &1.name) |> Enum.sort() == ["lint", "unit"]

      assert [%{context: "vercel", state: "SUCCESS"}] = result.statuses

      assert Enum.map(result.conversation, & &1.kind) == ["comment", "review"]
      assert List.last(result.conversation).review_state == "APPROVED"
    end

    test "derives merged and draft states" do
      assert PullRequests.parse_pr_node(pr_node(%{"merged" => true})).state == "merged"

      assert PullRequests.parse_pr_node(pr_node(%{"isDraft" => true, "state" => "OPEN"})).state ==
               "draft"
    end

    test "groups orphan check runs under Checks" do
      node =
        pr_node(%{
          "commits" => %{
            "nodes" => [
              %{
                "commit" => %{
                  "statusCheckRollup" => %{
                    "state" => "PENDING",
                    "contexts" => %{
                      "nodes" => [
                        %{
                          "__typename" => "CheckRun",
                          "name" => "orphan",
                          "status" => "IN_PROGRESS",
                          "conclusion" => nil,
                          "checkSuite" => %{"workflowRun" => nil}
                        }
                      ]
                    }
                  }
                }
              }
            ]
          }
        })

      assert [%{name: "Checks", url: nil, jobs: [%{name: "orphan"}]}] =
               PullRequests.parse_pr_node(node).pipelines
    end

    test "exposes job_id from CheckRun databaseId" do
      node =
        pr_node(%{
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
                          "name" => "vitest / test",
                          "status" => "COMPLETED",
                          "conclusion" => "FAILURE",
                          "databaseId" => 78_427_907_850,
                          "detailsUrl" => "https://github.com/acme/app/actions/runs/1/job/78427907850",
                          "checkSuite" => %{"workflowRun" => %{"url" => "u", "workflow" => %{"name" => "CI"}}}
                        }
                      ]
                    }
                  }
                }
              }
            ]
          }
        })

      [%{jobs: [job]}] = PullRequests.parse_pr_node(node).pipelines
      assert job.job_id == 78_427_907_850
    end
  end

  describe "for_issue/3" do
    test "resolves PRs from closedByPullRequestsReferences" do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyTrackerIssuePullRequests"
        assert payload["variables"]["number"] == 42

        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "repository" => %{
                 "issue" => %{
                   "linkedBranches" => %{"nodes" => []},
                   "closedByPullRequestsReferences" => %{"nodes" => [pr_node(%{})]}
                 }
               }
             }
           }
         }}
      end

      assert {:ok, [%{number: 503}]} =
               PullRequests.for_issue("acme/app", "#42",
                 client_module: TestClient,
                 request_fun: request_fun
               )
    end

    test "falls back to branch lookup when no closing PRs" do
      request_fun = fn payload, _headers ->
        cond do
          payload["query"] =~ "SymphonyTrackerIssuePullRequests" ->
            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "repository" => %{
                     "issue" => %{
                       "linkedBranches" => %{
                         "nodes" => [%{"ref" => %{"name" => "mac-1-fix-locale"}}]
                       },
                       "closedByPullRequestsReferences" => %{"nodes" => []}
                     }
                   }
                 }
               }
             }}

          payload["query"] =~ "SymphonyTrackerBranchPullRequests" ->
            assert payload["variables"]["branch"] == "mac-1-fix-locale"

            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "repository" => %{
                     "pullRequests" => %{"nodes" => [pr_node(%{})]}
                   }
                 }
               }
             }}
        end
      end

      assert {:ok, [%{number: 503}]} =
               PullRequests.for_issue("acme/app", "42",
                 client_module: TestClient,
                 request_fun: request_fun
               )
    end

    test "falls back to same-repo cross-referenced PRs when no closing refs or branch match" do
      request_fun = fn payload, _headers ->
        cond do
          payload["query"] =~ "SymphonyTrackerIssuePullRequests" ->
            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "repository" => %{
                     "issue" => %{
                       "linkedBranches" => %{"nodes" => []},
                       "closedByPullRequestsReferences" => %{"nodes" => []},
                       "timelineItems" => %{
                         "nodes" => [
                           %{
                             "isCrossRepository" => false,
                             "source" => Map.put(pr_node(%{}), "__typename", "PullRequest")
                           }
                         ]
                       }
                     }
                   }
                 }
               }
             }}
        end
      end

      assert {:ok, [%{number: 503}]} =
               PullRequests.for_issue("acme/app", "508",
                 client_module: TestClient,
                 request_fun: request_fun
               )
    end

    test "ignores cross-repository cross-references and dedups by number" do
      request_fun = fn payload, _headers ->
        cond do
          payload["query"] =~ "SymphonyTrackerIssuePullRequests" ->
            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "repository" => %{
                     "issue" => %{
                       "linkedBranches" => %{"nodes" => []},
                       "closedByPullRequestsReferences" => %{"nodes" => []},
                       "timelineItems" => %{
                         "nodes" => [
                           %{
                             "isCrossRepository" => true,
                             "source" =>
                               Map.merge(pr_node(%{}), %{
                                 "__typename" => "PullRequest",
                                 "number" => 999
                               })
                           },
                           %{
                             "isCrossRepository" => false,
                             "source" => Map.put(pr_node(%{}), "__typename", "PullRequest")
                           },
                           %{
                             "isCrossRepository" => false,
                             "source" => Map.put(pr_node(%{}), "__typename", "PullRequest")
                           }
                         ]
                       }
                     }
                   }
                 }
               }
             }}
        end
      end

      assert {:ok, [%{number: 503}]} =
               PullRequests.for_issue("acme/app", "508",
                 client_module: TestClient,
                 request_fun: request_fun
               )
    end

    test "returns empty list when issue is missing" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"data" => %{"repository" => %{"issue" => nil}}}}}
      end

      assert {:ok, []} =
               PullRequests.for_issue("acme/app", "999",
                 client_module: TestClient,
                 request_fun: request_fun
               )
    end

    test "rejects invalid identifiers" do
      assert {:error, {:invalid_issue_identifier, "abc"}} =
               PullRequests.for_issue("acme/app", "abc", client_module: TestClient)
    end
  end

  describe "resolve_repo/1" do
    test "returns repo for github projects" do
      project = %Project{tracker_kind: "github", tracker_config: %{"repo" => "acme/app"}}
      assert {:ok, "acme/app"} = PullRequests.resolve_repo(project)
    end

    test "rejects non-github projects" do
      project = %Project{tracker_kind: "linear", tracker_config: %{}}
      assert {:error, {:unsupported_tracker_kind, "linear"}} = PullRequests.resolve_repo(project)
    end

    test "rejects github projects without repo" do
      project = %Project{tracker_kind: "github", tracker_config: %{}}
      assert {:error, :missing_github_repo} = PullRequests.resolve_repo(project)
    end
  end

  describe "annotate_branch_status/3" do
    test "sets base_behind_by for an open PR and leaves merged PRs nil" do
      open_pr = %{number: 1, state: "open", base_ref: "homolog", head_ref: "feat/508", base_behind_by: nil}
      merged_pr = %{number: 2, state: "merged", base_ref: "homolog", head_ref: "old", base_behind_by: nil}

      rest_fun = fn "/repos/acme/app/compare/homolog...feat/508", _h ->
        {:ok, %{status: 200, body: %{"behind_by" => 3}}}
      end

      assert [%{number: 1, base_behind_by: 3}, %{number: 2, base_behind_by: nil}] =
               PullRequests.annotate_branch_status([open_pr, merged_pr], "acme/app",
                 client_module: BranchTestClient,
                 branch_status_request_fun: rest_fun
               )
    end

    test "swallows compare errors as nil" do
      open_pr = %{number: 1, state: "open", base_ref: "main", head_ref: "feat/x", base_behind_by: nil}
      rest_fun = fn _path, _h -> {:error, {:github_api_status, 404}} end

      assert [%{number: 1, base_behind_by: nil}] =
               PullRequests.annotate_branch_status([open_pr], "acme/app",
                 client_module: BranchTestClient,
                 branch_status_request_fun: rest_fun
               )
    end

    test "skips annotation when the client has no rest_get/2" do
      open_pr = %{number: 1, state: "open", base_ref: "main", head_ref: "feat/x", base_behind_by: nil}

      assert [%{number: 1, base_behind_by: nil}] =
               PullRequests.annotate_branch_status([open_pr], "acme/app", client_module: TestClient)
    end
  end
end
