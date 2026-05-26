defmodule SymphonyElixir.GitHub.ClientTest do
  use SymphonyElixir.TestSupport

  alias SymphonyElixir.GitHub.Client
  alias SymphonyElixir.GitHub.ProjectMetadata
  alias SymphonyElixir.Workflow

  setup do
    prev_token = System.get_env("GITHUB_TOKEN")
    System.put_env("GITHUB_TOKEN", "test-gh-token")

    on_exit(fn ->
      restore_env("GITHUB_TOKEN", prev_token)
    end)

    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "github",
      tracker_repo: "owner/repo",
      tracker_label_prefix: "sym",
      tracker_active_states: ["Todo", "In Progress"],
      tracker_terminal_states: ["Done"]
    )

    :ok
  end

  describe "fetch_candidate_issues/1 (GraphQL)" do
    setup do
      tmp = System.tmp_dir!() |> Path.join("sym-gh-poll-#{:erlang.unique_integer()}")
      File.mkdir_p!(tmp)
      on_exit(fn -> File.rm_rf!(tmp) end)

      ProjectMetadata.write!(tmp, %{
        "project_id" => "PVT_abc",
        "project_number" => 1,
        "project_url" => "https://github.com/owner/repo/projects/1",
        "status_field_id" => "PVTSSF_x",
        "status_field_name" => "Symphony State",
        "state_options" => %{
          "Todo" => "opt-todo",
          "In Progress" => "opt-inprog",
          "Done" => "opt-done"
        },
        "bootstrapped_at" => "2026-05-24T00:00:00Z"
      })

      %{base_dir: tmp}
    end

    test "returns issues whose Symphony State is in active_states", %{base_dir: base_dir} do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyGitHubPollItems"
        assert payload["variables"]["projectId"] == "PVT_abc"
        assert payload["variables"]["first"] == 50

        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "node" => %{
                 "items" => %{
                   "nodes" => [
                     build_project_item_fixture(%{
                       item_id: "PVTI_1",
                       issue_node_id: "I_1",
                       number: 11,
                       title: "Active todo",
                       repo: "owner/repo",
                       state_name: "Todo"
                     }),
                     build_project_item_fixture(%{
                       item_id: "PVTI_2",
                       issue_node_id: "I_2",
                       number: 22,
                       title: "Done issue",
                       repo: "owner/repo",
                       state_name: "Done"
                     }),
                     build_project_item_fixture(%{
                       item_id: "PVTI_3",
                       issue_node_id: "I_3",
                       number: 33,
                       title: "In progress",
                       repo: "owner/repo",
                       state_name: "In Progress"
                     })
                   ],
                   "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
                 }
               }
             }
           }
         }}
      end

      assert {:ok, issues} =
               Client.fetch_candidate_issues(base_dir: base_dir, request_fun: request_fun)

      assert length(issues) == 2

      [todo_issue, in_progress_issue] = issues
      assert todo_issue.id == "I_1"
      assert todo_issue.identifier == "11"
      assert todo_issue.title == "Active todo"
      assert todo_issue.state == "Todo"
      assert todo_issue.url == "https://github.com/owner/repo/issues/11"
      assert todo_issue.assigned_to_worker == true
      assert todo_issue.blocked_by == []
      assert todo_issue.branch_name == nil

      assert in_progress_issue.id == "I_3"
      assert in_progress_issue.state == "In Progress"
    end

    test "excludes items from other repos", %{base_dir: base_dir} do
      request_fun = fn _payload, _headers ->
        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "node" => %{
                 "items" => %{
                   "nodes" => [
                     build_project_item_fixture(%{
                       item_id: "PVTI_1",
                       issue_node_id: "I_1",
                       number: 1,
                       title: "Other repo",
                       repo: "other/repo",
                       state_name: "Todo"
                     })
                   ],
                   "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
                 }
               }
             }
           }
         }}
      end

      assert {:ok, []} =
               Client.fetch_candidate_issues(base_dir: base_dir, request_fun: request_fun)
    end

    test "skips non-Issue content (DraftIssue, PullRequest)", %{base_dir: base_dir} do
      request_fun = fn _payload, _headers ->
        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "node" => %{
                 "items" => %{
                   "nodes" => [
                     %{
                       "id" => "PVTI_dr",
                       "content" => %{"__typename" => "DraftIssue"},
                       "fieldValues" => %{"nodes" => []}
                     },
                     build_project_item_fixture(%{
                       item_id: "PVTI_pr",
                       issue_node_id: "PR_1",
                       number: 5,
                       title: "Pull",
                       repo: "owner/repo",
                       state_name: "Todo",
                       content_typename: "PullRequest"
                     })
                   ],
                   "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
                 }
               }
             }
           }
         }}
      end

      assert {:ok, []} =
               Client.fetch_candidate_issues(base_dir: base_dir, request_fun: request_fun)
    end

    test "skips items whose Symphony State field value is absent", %{base_dir: base_dir} do
      request_fun = fn _payload, _headers ->
        item =
          build_project_item_fixture(%{
            item_id: "PVTI_nostate",
            issue_node_id: "I_nostate",
            number: 7,
            title: "Stateless",
            repo: "owner/repo",
            state_name: "Todo"
          })

        item_without_state = Map.put(item, "fieldValues", %{"nodes" => []})

        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "node" => %{
                 "items" => %{
                   "nodes" => [item_without_state],
                   "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
                 }
               }
             }
           }
         }}
      end

      assert {:ok, []} =
               Client.fetch_candidate_issues(base_dir: base_dir, request_fun: request_fun)
    end

    test "paginates through multiple pages", %{base_dir: base_dir} do
      counter = :counters.new(1, [])

      request_fun = fn payload, _headers ->
        :counters.add(counter, 1, 1)
        page = :counters.get(counter, 1)

        case page do
          1 ->
            assert is_nil(payload["variables"]["after"])

            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "node" => %{
                     "items" => %{
                       "nodes" => [
                         build_project_item_fixture(%{
                           item_id: "PVTI_p1",
                           issue_node_id: "I_p1",
                           number: 1,
                           title: "Page1",
                           repo: "owner/repo",
                           state_name: "Todo"
                         })
                       ],
                       "pageInfo" => %{"hasNextPage" => true, "endCursor" => "cursor-1"}
                     }
                   }
                 }
               }
             }}

          2 ->
            assert payload["variables"]["after"] == "cursor-1"

            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "node" => %{
                     "items" => %{
                       "nodes" => [
                         build_project_item_fixture(%{
                           item_id: "PVTI_p2",
                           issue_node_id: "I_p2",
                           number: 2,
                           title: "Page2",
                           repo: "owner/repo",
                           state_name: "In Progress"
                         })
                       ],
                       "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
                     }
                   }
                 }
               }
             }}
        end
      end

      assert {:ok, issues} =
               Client.fetch_candidate_issues(base_dir: base_dir, request_fun: request_fun)

      assert length(issues) == 2
      assert Enum.map(issues, & &1.identifier) == ["1", "2"]
    end

    test "normalizes labels excluding priority and admission_label", %{base_dir: base_dir} do
      request_fun = fn _payload, _headers ->
        item =
          build_project_item_fixture(%{
            item_id: "PVTI_lbl",
            issue_node_id: "I_lbl",
            number: 99,
            title: "Labeled",
            repo: "owner/repo",
            state_name: "Todo",
            labels: [
              %{"name" => "Bug"},
              %{"name" => "priority:2"},
              %{"name" => "symphony"}
            ]
          })

        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "node" => %{
                 "items" => %{
                   "nodes" => [item],
                   "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
                 }
               }
             }
           }
         }}
      end

      assert {:ok, [issue]} =
               Client.fetch_candidate_issues(base_dir: base_dir, request_fun: request_fun)

      assert issue.priority == 2
      assert issue.labels == ["bug"]
    end

    test "returns :github_missing_end_cursor when hasNextPage is true but cursor is nil", %{base_dir: base_dir} do
      request_fun = fn _payload, _headers ->
        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "node" => %{
                 "items" => %{
                   "nodes" => [
                     build_project_item_fixture(%{
                       item_id: "PVTI_1",
                       issue_node_id: "I_1",
                       number: 1,
                       title: "Stuck",
                       repo: "owner/repo",
                       state_name: "Todo"
                     })
                   ],
                   "pageInfo" => %{"hasNextPage" => true, "endCursor" => nil}
                 }
               }
             }
           }
         }}
      end

      assert {:error, :github_missing_end_cursor} =
               Client.fetch_candidate_issues(base_dir: base_dir, request_fun: request_fun)
    end

    test "returns :missing_project_metadata when cache absent" do
      other_tmp = System.tmp_dir!() |> Path.join("sym-gh-empty-#{:erlang.unique_integer()}")
      File.mkdir_p!(other_tmp)
      on_exit(fn -> File.rm_rf!(other_tmp) end)

      assert {:error, :missing_project_metadata} =
               Client.fetch_candidate_issues(
                 base_dir: other_tmp,
                 request_fun: fn _, _ -> flunk("GraphQL should not be invoked when cache missing") end
               )
    end

    test "returns error when token missing", %{base_dir: base_dir} do
      System.delete_env("GITHUB_TOKEN")

      assert {:error, :missing_github_token} =
               Client.fetch_candidate_issues(
                 base_dir: base_dir,
                 request_fun: fn _, _ -> flunk("GraphQL should not be invoked without token") end
               )
    end
  end

  describe "fetch_issues_by_states/2 (GraphQL)" do
    setup do
      tmp = System.tmp_dir!() |> Path.join("sym-gh-states-#{:erlang.unique_integer()}")
      File.mkdir_p!(tmp)
      on_exit(fn -> File.rm_rf!(tmp) end)

      ProjectMetadata.write!(tmp, %{
        "project_id" => "PVT_abc",
        "project_number" => 1,
        "project_url" => "https://github.com/owner/repo/projects/1",
        "status_field_id" => "PVTSSF_x",
        "status_field_name" => "Symphony State",
        "state_options" => %{
          "Todo" => "opt-todo",
          "In Progress" => "opt-inprog",
          "Done" => "opt-done"
        },
        "bootstrapped_at" => "2026-05-24T00:00:00Z"
      })

      %{base_dir: tmp}
    end

    test "returns empty list for empty states" do
      assert {:ok, []} = Client.fetch_issues_by_states([])
    end

    test "filters items by the provided state list", %{base_dir: base_dir} do
      request_fun = fn _payload, _headers ->
        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "node" => %{
                 "items" => %{
                   "nodes" => [
                     build_project_item_fixture(%{
                       item_id: "PVTI_done",
                       issue_node_id: "I_done",
                       number: 1,
                       title: "Done",
                       repo: "owner/repo",
                       state_name: "Done"
                     }),
                     build_project_item_fixture(%{
                       item_id: "PVTI_todo",
                       issue_node_id: "I_todo",
                       number: 2,
                       title: "Todo",
                       repo: "owner/repo",
                       state_name: "Todo"
                     })
                   ],
                   "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
                 }
               }
             }
           }
         }}
      end

      assert {:ok, [issue]} =
               Client.fetch_issues_by_states(["Done"],
                 base_dir: base_dir,
                 request_fun: request_fun
               )

      assert issue.id == "I_done"
      assert issue.state == "Done"
    end
  end

  describe "fetch_issue_states_by_ids/2 (GraphQL)" do
    setup do
      tmp = System.tmp_dir!() |> Path.join("sym-gh-by-ids-#{:erlang.unique_integer()}")
      File.mkdir_p!(tmp)
      on_exit(fn -> File.rm_rf!(tmp) end)

      ProjectMetadata.write!(tmp, %{
        "project_id" => "PVT_abc",
        "project_number" => 1,
        "project_url" => "https://github.com/owner/repo/projects/1",
        "status_field_id" => "PVTSSF_x",
        "status_field_name" => "Symphony State",
        "state_options" => %{"Todo" => "opt-todo", "Done" => "opt-done"},
        "bootstrapped_at" => "2026-05-24T00:00:00Z"
      })

      %{base_dir: tmp}
    end

    test "returns empty list for empty ids" do
      assert {:ok, []} = Client.fetch_issue_states_by_ids([])
    end

    test "extracts Symphony State scoped to project from projectItems", %{base_dir: base_dir} do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyGitHubIssuesByIds"
        assert payload["variables"]["ids"] == ["I_42"]

        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "nodes" => [
                 %{
                   "__typename" => "Issue",
                   "id" => "I_42",
                   "number" => 42,
                   "title" => "Track me",
                   "body" => "desc",
                   "url" => "https://github.com/owner/repo/issues/42",
                   "state" => "OPEN",
                   "repository" => %{"nameWithOwner" => "owner/repo"},
                   "assignees" => %{"nodes" => [%{"login" => "dev1"}]},
                   "labels" => %{"nodes" => []},
                   "createdAt" => "2026-01-01T00:00:00Z",
                   "updatedAt" => "2026-01-02T00:00:00Z",
                   "projectItems" => %{
                     "nodes" => [
                       %{
                         "id" => "PVTI_other",
                         "project" => %{"id" => "PVT_other"},
                         "fieldValues" => %{
                           "nodes" => [
                             %{
                               "__typename" => "ProjectV2ItemFieldSingleSelectValue",
                               "name" => "Backlog",
                               "field" => %{
                                 "id" => "PVTSSF_other",
                                 "name" => "Symphony State"
                               }
                             }
                           ]
                         }
                       },
                       %{
                         "id" => "PVTI_ours",
                         "project" => %{"id" => "PVT_abc"},
                         "fieldValues" => %{
                           "nodes" => [
                             %{
                               "__typename" => "ProjectV2ItemFieldSingleSelectValue",
                               "name" => "In Progress",
                               "field" => %{
                                 "id" => "PVTSSF_x",
                                 "name" => "Symphony State"
                               }
                             }
                           ]
                         }
                       }
                     ]
                   }
                 }
               ]
             }
           }
         }}
      end

      assert {:ok, [issue]} =
               Client.fetch_issue_states_by_ids(["I_42"],
                 base_dir: base_dir,
                 request_fun: request_fun
               )

      assert issue.id == "I_42"
      assert issue.identifier == "42"
      assert issue.state == "In Progress"
      assert issue.assignee_id == "dev1"
    end

    test "skips nodes outside the configured repo", %{base_dir: base_dir} do
      request_fun = fn _payload, _headers ->
        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "nodes" => [
                 %{
                   "__typename" => "Issue",
                   "id" => "I_other",
                   "number" => 1,
                   "title" => "Foreign",
                   "body" => "",
                   "url" => "https://github.com/other/repo/issues/1",
                   "state" => "OPEN",
                   "repository" => %{"nameWithOwner" => "other/repo"},
                   "assignees" => %{"nodes" => []},
                   "labels" => %{"nodes" => []},
                   "createdAt" => "2026-01-01T00:00:00Z",
                   "updatedAt" => "2026-01-01T00:00:00Z",
                   "projectItems" => %{"nodes" => []}
                 }
               ]
             }
           }
         }}
      end

      assert {:ok, []} =
               Client.fetch_issue_states_by_ids(["I_other"],
                 base_dir: base_dir,
                 request_fun: request_fun
               )
    end
  end

  describe "create_comment/3 (GraphQL)" do
    test "posts addComment mutation with issue node id and body" do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyGitHubAddComment"
        assert payload["variables"] == %{"subjectId" => "I_kw_42", "body" => "Hello"}

        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "addComment" => %{"commentEdge" => %{"node" => %{"id" => "IC_1"}}}
             }
           }
         }}
      end

      assert :ok =
               Client.create_comment("I_kw_42", "Hello", request_fun: request_fun)
    end

    test "returns error tuple on graphql failure" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 401, body: %{"message" => "Bad credentials"}}}
      end

      assert {:error, {:github_api_status, 401}} =
               Client.create_comment("I_kw_42", "Hello", request_fun: request_fun)
    end

    test "returns error tuple when graphql payload reports errors" do
      request_fun = fn _payload, _headers ->
        {:ok,
         %{
           status: 200,
           body: %{"errors" => [%{"message" => "Issue not found"}]}
         }}
      end

      assert {:error, {:github_graphql_errors, [%{"message" => "Issue not found"}]}} =
               Client.create_comment("I_kw_missing", "Hello", request_fun: request_fun)
    end
  end

  describe "update_issue_state/3 (GraphQL)" do
    setup do
      tmp = System.tmp_dir!() |> Path.join("sym-gh-update-#{:erlang.unique_integer()}")
      File.mkdir_p!(tmp)
      on_exit(fn -> File.rm_rf!(tmp) end)

      ProjectMetadata.write!(tmp, %{
        "project_id" => "PVT_abc",
        "project_number" => 1,
        "status_field_id" => "PVTSSF_x",
        "status_field_name" => "Symphony State",
        "state_options" => %{
          "Todo" => "opt-todo",
          "In Progress" => "opt-inprog",
          "Done" => "opt-done",
          "Cancelled" => "opt-cancel"
        },
        "bootstrapped_at" => "2026-05-24T00:00:00Z"
      })

      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "github",
        tracker_repo: "owner/repo",
        tracker_active_states: ["Todo", "In Progress"],
        tracker_terminal_states: ["Done", "Cancelled"]
      )

      %{base_dir: tmp}
    end

    test "updates Symphony State and reopens for active states", %{base_dir: base_dir} do
      seq = :counters.new(1, [])

      request_fun = fn payload, _headers ->
        :counters.add(seq, 1, 1)

        cond do
          payload["query"] =~ "SymphonyGitHubResolveItem" ->
            assert payload["variables"]["issueId"] == "I_kw_99"

            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "node" => %{
                     "id" => "I_kw_99",
                     "state" => "CLOSED",
                     "projectItems" => %{
                       "nodes" => [
                         %{"id" => "PVTI_99", "project" => %{"id" => "PVT_abc"}}
                       ]
                     }
                   }
                 }
               }
             }}

          payload["query"] =~ "SymphonyGitHubSetState" ->
            vars = payload["variables"]
            assert vars["projectId"] == "PVT_abc"
            assert vars["itemId"] == "PVTI_99"
            assert vars["fieldId"] == "PVTSSF_x"
            assert vars["optionId"] == "opt-inprog"

            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "updateProjectV2ItemFieldValue" => %{
                     "projectV2Item" => %{"id" => "PVTI_99"}
                   }
                 }
               }
             }}

          payload["query"] =~ "SymphonyGitHubReopenIssue" ->
            assert payload["variables"]["issueId"] == "I_kw_99"

            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "reopenIssue" => %{"issue" => %{"id" => "I_kw_99", "state" => "OPEN"}}
                 }
               }
             }}
        end
      end

      assert :ok =
               Client.update_issue_state("I_kw_99", "In Progress",
                 base_dir: base_dir,
                 request_fun: request_fun
               )

      assert :counters.get(seq, 1) == 3
    end

    test "closes issue for terminal states", %{base_dir: base_dir} do
      seq = :counters.new(1, [])

      request_fun = fn payload, _headers ->
        :counters.add(seq, 1, 1)

        cond do
          payload["query"] =~ "SymphonyGitHubResolveItem" ->
            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "node" => %{
                     "id" => "I_kw_77",
                     "state" => "OPEN",
                     "projectItems" => %{
                       "nodes" => [
                         %{"id" => "PVTI_77", "project" => %{"id" => "PVT_abc"}}
                       ]
                     }
                   }
                 }
               }
             }}

          payload["query"] =~ "SymphonyGitHubSetState" ->
            assert payload["variables"]["optionId"] == "opt-done"

            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "updateProjectV2ItemFieldValue" => %{
                     "projectV2Item" => %{"id" => "PVTI_77"}
                   }
                 }
               }
             }}

          payload["query"] =~ "SymphonyGitHubCloseIssue" ->
            assert payload["variables"]["issueId"] == "I_kw_77"
            assert payload["query"] =~ "stateReason: COMPLETED"

            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "closeIssue" => %{"issue" => %{"id" => "I_kw_77", "state" => "CLOSED"}}
                 }
               }
             }}
        end
      end

      assert :ok =
               Client.update_issue_state("I_kw_77", "Done",
                 base_dir: base_dir,
                 request_fun: request_fun
               )

      assert :counters.get(seq, 1) == 3
    end

    test "returns error for unknown state", %{base_dir: base_dir} do
      assert {:error, {:unknown_state, "Limbo"}} =
               Client.update_issue_state("I_kw_99", "Limbo",
                 base_dir: base_dir,
                 request_fun: fn _, _ -> flunk("unreachable") end
               )
    end

    test "returns error when issue not in project", %{base_dir: base_dir} do
      request_fun = fn payload, _headers ->
        assert payload["query"] =~ "SymphonyGitHubResolveItem"

        {:ok,
         %{
           status: 200,
           body: %{
             "data" => %{
               "node" => %{
                 "id" => "I_kw_42",
                 "state" => "OPEN",
                 "projectItems" => %{
                   "nodes" => [
                     %{"id" => "PVTI_other", "project" => %{"id" => "PVT_other"}}
                   ]
                 }
               }
             }
           }
         }}
      end

      assert {:error, {:issue_not_in_project, "I_kw_42"}} =
               Client.update_issue_state("I_kw_42", "Todo",
                 base_dir: base_dir,
                 request_fun: request_fun
               )
    end

    test "returns :missing_project_metadata when cache absent" do
      empty_dir = System.tmp_dir!() |> Path.join("sym-update-empty-#{:erlang.unique_integer()}")
      File.mkdir_p!(empty_dir)
      on_exit(fn -> File.rm_rf!(empty_dir) end)

      assert {:error, :missing_project_metadata} =
               Client.update_issue_state("I_kw_99", "Todo",
                 base_dir: empty_dir,
                 request_fun: fn _, _ -> flunk("unreachable") end
               )
    end

    test "skips reopenIssue when issue already open and transitioning to active", %{
      base_dir: base_dir
    } do
      request_fun = fn payload, _headers ->
        cond do
          payload["query"] =~ "SymphonyGitHubResolveItem" ->
            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "node" => %{
                     "id" => "I_kw_55",
                     "state" => "OPEN",
                     "projectItems" => %{
                       "nodes" => [%{"id" => "PVTI_55", "project" => %{"id" => "PVT_abc"}}]
                     }
                   }
                 }
               }
             }}

          payload["query"] =~ "SymphonyGitHubSetState" ->
            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "updateProjectV2ItemFieldValue" => %{"projectV2Item" => %{"id" => "PVTI_55"}}
                 }
               }
             }}

          payload["query"] =~ "SymphonyGitHub" ->
            flunk("must not call close/reopen for already-open active transition: #{payload["query"]}")
        end
      end

      assert :ok =
               Client.update_issue_state("I_kw_55", "In Progress",
                 base_dir: base_dir,
                 request_fun: request_fun
               )
    end

    test "skips closeIssue when issue already closed and transitioning to terminal", %{
      base_dir: base_dir
    } do
      request_fun = fn payload, _headers ->
        cond do
          payload["query"] =~ "SymphonyGitHubResolveItem" ->
            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "node" => %{
                     "id" => "I_kw_55",
                     "state" => "CLOSED",
                     "projectItems" => %{
                       "nodes" => [%{"id" => "PVTI_55", "project" => %{"id" => "PVT_abc"}}]
                     }
                   }
                 }
               }
             }}

          payload["query"] =~ "SymphonyGitHubSetState" ->
            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "updateProjectV2ItemFieldValue" => %{"projectV2Item" => %{"id" => "PVTI_55"}}
                 }
               }
             }}

          payload["query"] =~ "SymphonyGitHub" ->
            flunk("must not call close/reopen for already-closed terminal transition")
        end
      end

      assert :ok =
               Client.update_issue_state("I_kw_55", "Done",
                 base_dir: base_dir,
                 request_fun: request_fun
               )
    end

    test "propagates graphql error from set state", %{base_dir: base_dir} do
      request_fun = fn payload, _headers ->
        cond do
          payload["query"] =~ "SymphonyGitHubResolveItem" ->
            {:ok,
             %{
               status: 200,
               body: %{
                 "data" => %{
                   "node" => %{
                     "id" => "I_kw_99",
                     "state" => "OPEN",
                     "projectItems" => %{
                       "nodes" => [%{"id" => "PVTI_99", "project" => %{"id" => "PVT_abc"}}]
                     }
                   }
                 }
               }
             }}

          payload["query"] =~ "SymphonyGitHubSetState" ->
            {:ok, %{status: 200, body: %{"errors" => [%{"message" => "field locked"}]}}}
        end
      end

      assert {:error, {:github_graphql_errors, [%{"message" => "field locked"}]}} =
               Client.update_issue_state("I_kw_99", "In Progress",
                 base_dir: base_dir,
                 request_fun: request_fun
               )
    end
  end

  describe "graphql/3" do
    test "returns body on HTTP 200 with no errors" do
      request_fun = fn payload, headers ->
        assert payload["query"] =~ "viewer"
        assert payload["variables"] == %{}
        assert {"Authorization", "Bearer test-gh-token"} in headers
        assert {"Content-Type", "application/json"} in headers
        assert {"X-GitHub-Api-Version", "2022-11-28"} in headers

        {:ok, %{status: 200, body: %{"data" => %{"viewer" => %{"login" => "octocat"}}}}}
      end

      assert {:ok, body} =
               Client.graphql("query { viewer { login } }", %{}, request_fun: request_fun)

      assert get_in(body, ["data", "viewer", "login"]) == "octocat"
    end

    test "passes variables through" do
      request_fun = fn payload, _headers ->
        assert payload["variables"] == %{"id" => "X_1"}
        {:ok, %{status: 200, body: %{"data" => %{}}}}
      end

      assert {:ok, _} =
               Client.graphql(
                 "query($id: ID!) { node(id: $id) { id } }",
                 %{"id" => "X_1"},
                 request_fun: request_fun
               )
    end

    test "sets operationName when provided" do
      request_fun = fn payload, _headers ->
        assert payload["operationName"] == "GetViewer"
        {:ok, %{status: 200, body: %{"data" => %{}}}}
      end

      assert {:ok, _} =
               Client.graphql(
                 "query GetViewer { viewer { login } }",
                 %{},
                 request_fun: request_fun,
                 operation_name: "GetViewer"
               )
    end

    test "returns :github_graphql_errors when response has top-level errors" do
      request_fun = fn _payload, _headers ->
        {:ok,
         %{
           status: 200,
           body: %{"errors" => [%{"message" => "field unknown"}]}
         }}
      end

      assert {:error, {:github_graphql_errors, [%{"message" => "field unknown"}]}} =
               Client.graphql("query { viewer { login } }", %{}, request_fun: request_fun)
    end

    test "returns :github_api_status on non-200 HTTP" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 401, body: %{"message" => "Bad credentials"}}}
      end

      assert {:error, {:github_api_status, 401}} =
               Client.graphql("query { viewer { login } }", %{}, request_fun: request_fun)
    end

    test "returns :github_api_request on transport error" do
      request_fun = fn _payload, _headers ->
        {:error, :nxdomain}
      end

      assert {:error, {:github_api_request, :nxdomain}} =
               Client.graphql("query { viewer { login } }", %{}, request_fun: request_fun)
    end

    test "returns :missing_github_token when token absent" do
      prev = System.get_env("GITHUB_TOKEN")
      System.delete_env("GITHUB_TOKEN")

      on_exit(fn -> restore_env("GITHUB_TOKEN", prev) end)

      assert {:error, :missing_github_token} =
               Client.graphql("query { viewer { login } }", %{}, request_fun: fn _, _ -> flunk("unreachable") end)
    end

    test "treats empty errors list as success" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: %{"data" => %{"viewer" => %{"login" => "octocat"}}, "errors" => []}}}
      end

      assert {:ok, body} =
               Client.graphql("query { viewer { login } }", %{}, request_fun: request_fun)

      assert get_in(body, ["data", "viewer", "login"]) == "octocat"
    end

    test "returns :github_unknown_payload when body is not a map" do
      request_fun = fn _payload, _headers ->
        {:ok, %{status: 200, body: "unexpected string body"}}
      end

      assert {:error, :github_unknown_payload} =
               Client.graphql("query { viewer { login } }", %{}, request_fun: request_fun)
    end
  end

  defp build_project_item_fixture(opts) do
    content_typename = Map.get(opts, :content_typename, "Issue")

    content =
      if content_typename == "Issue" do
        %{
          "__typename" => "Issue",
          "id" => opts.issue_node_id,
          "number" => opts.number,
          "title" => opts.title,
          "body" => Map.get(opts, :body, ""),
          "url" => "https://github.com/#{opts.repo}/issues/#{opts.number}",
          "state" => "OPEN",
          "repository" => %{"nameWithOwner" => opts.repo},
          "assignees" => %{"nodes" => Map.get(opts, :assignees, [])},
          "labels" => %{"nodes" => Map.get(opts, :labels, [])},
          "createdAt" => "2026-01-01T00:00:00Z",
          "updatedAt" => "2026-01-02T00:00:00Z"
        }
      else
        %{"__typename" => content_typename}
      end

    %{
      "id" => opts.item_id,
      "content" => content,
      "fieldValues" => %{
        "nodes" => [
          %{
            "__typename" => "ProjectV2ItemFieldSingleSelectValue",
            "name" => opts.state_name,
            "field" => %{"id" => "PVTSSF_x", "name" => "Symphony State"}
          }
        ]
      }
    }
  end
end
