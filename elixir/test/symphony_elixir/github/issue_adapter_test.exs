defmodule SymphonyElixir.GitHub.IssueAdapterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.GitHub.IssueAdapter
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueDTO

  defmodule ListClientStub do
    def graphql(_query, _vars, _opts) do
      {:ok,
       %{
         "data" => %{
           "node" => %{
             "items" => %{
               "nodes" => [
                 %{
                   "id" => "PVTI_1",
                   "content" => %{
                     "__typename" => "Issue",
                     "id" => "I_1",
                     "number" => 7,
                     "title" => "Remote",
                     "body" => nil,
                     "url" => "https://x/7",
                     "assignees" => %{"nodes" => []},
                     "labels" => %{"nodes" => []},
                     "createdAt" => "2026-05-28T00:00:00Z",
                     "updatedAt" => "2026-05-28T00:00:00Z"
                   },
                   "fieldValues" => %{
                     "nodes" => [
                       %{
                         "__typename" => "ProjectV2ItemFieldSingleSelectValue",
                         "name" => "Todo",
                         "field" => %{"name" => "Symphony State"}
                       }
                     ]
                   }
                 }
               ],
               "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
             }
           }
         }
       }}
    end
  end

  defmodule PaginatedClientStub do
    def graphql(_query, %{"after" => nil}, _opts), do: page("PVTI_1", "I_1", 7, true, "CURSOR_1")
    def graphql(_query, %{"after" => "CURSOR_1"}, _opts), do: page("PVTI_2", "I_2", 8, false, nil)

    defp page(item_id, issue_id, number, has_next, cursor) do
      {:ok,
       %{
         "data" => %{
           "node" => %{
             "items" => %{
               "nodes" => [
                 %{
                   "id" => item_id,
                   "content" => %{
                     "__typename" => "Issue",
                     "id" => issue_id,
                     "number" => number,
                     "title" => "Issue #{number}",
                     "body" => nil,
                     "url" => "https://x/#{number}",
                     "assignees" => %{"nodes" => []},
                     "labels" => %{"nodes" => []},
                     "createdAt" => "2026-05-28T00:00:00Z",
                     "updatedAt" => "2026-05-28T00:00:00Z"
                   },
                   "fieldValues" => %{
                     "nodes" => [
                       %{
                         "__typename" => "ProjectV2ItemFieldSingleSelectValue",
                         "name" => "Todo",
                         "field" => %{"name" => "Symphony State"}
                       }
                     ]
                   }
                 }
               ],
               "pageInfo" => %{"hasNextPage" => has_next, "endCursor" => cursor}
             }
           }
         }
       }}
    end
  end

  defmodule UnauthorizedClientStub do
    def graphql(_query, _vars, _opts), do: {:error, {:github_api_status, 401}}
  end

  defmodule RateLimitedClientStub do
    def graphql(_query, _vars, _opts) do
      {:error, {:rate_limited, %{reset_at: ~U[2026-05-31 12:00:00Z]}}}
    end
  end

  setup do
    Application.put_env(:symphony_elixir, :github_client_module, ListClientStub)
    on_exit(fn -> Application.delete_env(:symphony_elixir, :github_client_module) end)
    :ok
  end

  defp project do
    %Project{
      slug: "remote",
      tracker_kind: "github",
      tracker_config: %{"repo" => "o/r", "project_id" => "PVT_1", "status_field" => "Symphony State"}
    }
  end

  test "kind/0 is :github" do
    assert IssueAdapter.kind() == :github
  end

  test "list_issues returns DTOs from the board" do
    assert {:ok, [%IssueDTO{identifier: "7", title: "Remote", status: %{name: "Todo"}}]} =
             IssueAdapter.list_issues(project(), [])
  end

  test "list_issues follows pageInfo cursors across pages" do
    Application.put_env(:symphony_elixir, :github_client_module, PaginatedClientStub)

    assert {:ok, issues} = IssueAdapter.list_issues(project(), [])
    assert Enum.map(issues, & &1.identifier) == ["7", "8"]
  end

  test "maps 401 to :remote_unauthorized" do
    Application.put_env(:symphony_elixir, :github_client_module, UnauthorizedClientStub)
    assert {:error, :remote_unauthorized} = IssueAdapter.list_issues(project(), [])
  end

  test "preserves {:rate_limited, info} so the UI can render a 429 with the reset time" do
    Application.put_env(:symphony_elixir, :github_client_module, RateLimitedClientStub)

    assert {:error, {:rate_limited, %{reset_at: %DateTime{}}}} =
             IssueAdapter.list_issues(project(), [])
  end

  defmodule MoveClientStub do
    def graphql(query, _vars, _opts) do
      cond do
        String.contains?(query, "fields(first") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "fields" => %{
                   "nodes" => [
                     %{
                       "__typename" => "ProjectV2SingleSelectField",
                       "id" => "FIELD_1",
                       "name" => "Symphony State",
                       "options" => [%{"id" => "OPT_DONE", "name" => "Done"}]
                     }
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "updateProjectV2ItemFieldValue") ->
          {:ok, %{"data" => %{"updateProjectV2ItemFieldValue" => %{"projectV2Item" => %{"id" => "PVTI_1"}}}}}

        true ->
          {:ok, %{"data" => %{}}}
      end
    end
  end

  test "move_issue resolves option id and posts the mutation" do
    Application.put_env(:symphony_elixir, :github_client_module, MoveClientStub)

    assert {:ok, %{status: %{name: "Done"}}} =
             IssueAdapter.move_issue(
               %{project() | tracker_config: Map.put(project().tracker_config, "status_field", "Symphony State")},
               "PVTI_1",
               %{"status" => "Done", "item_id" => "PVTI_1"}
             )
  end

  defmodule MoveByIdentifierClientStub do
    def graphql(query, _vars, _opts) do
      cond do
        String.contains?(query, "SymphonyUiIssueNodeId") ->
          {:ok, %{"data" => %{"repository" => %{"issue" => %{"id" => "I_508"}}}}}

        String.contains?(query, "SymphonyUiResolveProjectItem") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "projectItems" => %{
                   "nodes" => [%{"id" => "PVTI_508", "project" => %{"id" => "PVT_1"}}]
                 }
               }
             }
           }}

        String.contains?(query, "fields(first") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "fields" => %{
                   "nodes" => [
                     %{
                       "__typename" => "ProjectV2SingleSelectField",
                       "id" => "FIELD_1",
                       "name" => "Symphony State",
                       "options" => [%{"id" => "OPT_REWORK", "name" => "Rework"}]
                     }
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "updateProjectV2ItemFieldValue") ->
          {:ok, %{"data" => %{"updateProjectV2ItemFieldValue" => %{"projectV2Item" => %{"id" => "PVTI_508"}}}}}

        true ->
          {:ok, %{"data" => %{}}}
      end
    end
  end

  test "move_issue resolves project item id from issue identifier" do
    Application.put_env(:symphony_elixir, :github_client_module, MoveByIdentifierClientStub)

    assert {:ok, %{status: %{name: "Rework"}}} =
             IssueAdapter.move_issue(
               %{project() | tracker_config: Map.put(project().tracker_config, "status_field", "Symphony State")},
               "508",
               %{"status" => "Rework"}
             )
  end

  defmodule MoveViaRemoteIdClientStub do
    def graphql(query, vars, _opts) do
      cond do
        String.contains?(query, "SymphonyUiIssueNodeId") ->
          flunk("should not resolve issue by configured repo when remote_id is provided")

        String.contains?(query, "SymphonyUiResolveProjectItem") ->
          assert vars["issueId"] == "I_BACKEND_3984"

          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "projectItems" => %{
                   "nodes" => [%{"id" => "PVTI_3984", "project" => %{"id" => "PVT_1"}}]
                 }
               }
             }
           }}

        String.contains?(query, "fields(first") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "fields" => %{
                   "nodes" => [
                     %{
                       "__typename" => "ProjectV2SingleSelectField",
                       "id" => "FIELD_1",
                       "name" => "Symphony State",
                       "options" => [%{"id" => "OPT_IN_PROGRESS", "name" => "In Progress"}]
                     }
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "updateProjectV2ItemFieldValue") ->
          {:ok, %{"data" => %{"updateProjectV2ItemFieldValue" => %{"projectV2Item" => %{"id" => "PVTI_3984"}}}}}

        true ->
          {:ok, %{"data" => %{}}}
      end
    end
  end

  test "move_issue resolves project item via remote_id without querying configured repo" do
    Application.put_env(:symphony_elixir, :github_client_module, MoveViaRemoteIdClientStub)

    assert {:ok, %{status: %{name: "In Progress"}}} =
             IssueAdapter.move_issue(
               %{project() | tracker_config: Map.put(project().tracker_config, "status_field", "Symphony State")},
               "3984",
               %{"status" => "In Progress", "remote_id" => "I_BACKEND_3984"}
             )
  end

  defmodule MultiRepoMoveClientStub do
    def graphql(query, vars, _opts) do
      cond do
        String.contains?(query, "SymphonyUiIssueNodeId") ->
          case vars do
            %{"owner" => "GambaLabs", "name" => "frontend", "number" => 3984} ->
              {:ok, %{"data" => %{"repository" => %{"issue" => nil}}}}

            %{"owner" => "GambaLabs", "name" => "backend", "number" => 3984} ->
              {:ok, %{"data" => %{"repository" => %{"issue" => %{"id" => "I_BACKEND_3984"}}}}}

            other ->
              flunk("unexpected issue lookup: #{inspect(other)}")
          end

        String.contains?(query, "SymphonyUiResolveProjectItem") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "projectItems" => %{
                   "nodes" => [%{"id" => "PVTI_3984", "project" => %{"id" => "PVT_1"}}]
                 }
               }
             }
           }}

        String.contains?(query, "fields(first") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "fields" => %{
                   "nodes" => [
                     %{
                       "__typename" => "ProjectV2SingleSelectField",
                       "id" => "FIELD_1",
                       "name" => "Symphony State",
                       "options" => [%{"id" => "OPT_IN_PROGRESS", "name" => "In Progress"}]
                     }
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "updateProjectV2ItemFieldValue") ->
          {:ok, %{"data" => %{"updateProjectV2ItemFieldValue" => %{"projectV2Item" => %{"id" => "PVTI_3984"}}}}}

        true ->
          {:ok, %{"data" => %{}}}
      end
    end
  end

  test "move_issue tries configured repositories when issue is not in tracker_config repo" do
    Application.put_env(:symphony_elixir, :github_client_module, MultiRepoMoveClientStub)

    project =
      %{
        project()
        | slug: "gamba",
          tracker_config: %{
            "repo" => "GambaLabs/frontend",
            "project_id" => "PVT_1",
            "status_field" => "Symphony State"
          }
      }

    migrate_repo()
    clean_repo()

    {:ok, project_record} = SymphonyElixir.LocalTracker.Context.ensure_project(%{name: "Gamba", slug: "gamba"})

    {:ok, _} =
      SymphonyElixir.LocalTracker.Context.replace_repositories("gamba", [
        %{"github_full_name" => "GambaLabs/frontend", "workspace_path" => "frontend", "role" => "primary"},
        %{"github_full_name" => "GambaLabs/backend", "workspace_path" => "backend", "role" => "backend"}
      ])

    {:ok, _issue} =
      SymphonyElixir.Tracker.Sync.LocalStore.upsert_remote_issue(project_record, %{
        remote_id: "I_BACKEND_3984",
        remote_number: 3984,
        identifier: "3984",
        title: "Welcome XP Wheel Adjustment",
        description: nil,
        state: "Todo",
        priority: nil,
        assignee_id: nil,
        branch_name: nil,
        remote_url: "https://github.com/GambaLabs/backend/issues/3984",
        creator: nil,
        position: 0,
        remote_updated_at: DateTime.utc_now(),
        labels: [],
        comments: []
      })

    assert {:ok, %{status: %{name: "In Progress"}}} =
             IssueAdapter.move_issue(project, "3984", %{"status" => "In Progress"})
  end

  defmodule DispatchClientStub do
    def graphql(query, vars, _opts) do
      cond do
        String.contains?(query, "SymphonyUiIssueNodeId") ->
          {:ok, %{"data" => %{"repository" => %{"issue" => %{"id" => "I_510"}}}}}

        String.contains?(query, "SymphonyUiResolveProjectItem") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "projectItems" => %{
                   "nodes" => [%{"id" => "PVTI_510", "project" => %{"id" => "PVT_1"}}]
                 }
               }
             }
           }}

        String.contains?(query, "fields(first") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "fields" => %{
                   "nodes" => [
                     %{
                       "__typename" => "ProjectV2SingleSelectField",
                       "id" => "FIELD_1",
                       "name" => "Symphony State",
                       "options" => [%{"id" => "OPT_IN_PROGRESS", "name" => "In Progress"}]
                     }
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "updateProjectV2ItemFieldValue") ->
          {:ok, %{"data" => %{"updateProjectV2ItemFieldValue" => %{"projectV2Item" => %{"id" => "PVTI_510"}}}}}

        String.contains?(query, "SymphonyUiRepoMetadata") ->
          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "id" => "REPO_1",
                 "labels" => %{
                   "nodes" => [
                     %{"id" => "LBL_CODEX", "name" => "symphony:codex", "color" => "ededed"}
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "addLabelsToLabelable") ->
          send(self(), {:add_labels, vars})
          {:ok, %{"data" => %{"addLabelsToLabelable" => %{"labelable" => %{"__typename" => "Issue"}}}}}

        true ->
          {:ok, %{"data" => %{}}}
      end
    end
  end

  test "move_issue applies the symphony:<agent> routing label when an agent is dispatched" do
    Application.put_env(:symphony_elixir, :github_client_module, DispatchClientStub)

    assert {:ok, %{status: %{name: "In Progress"}}} =
             IssueAdapter.move_issue(
               %{project() | tracker_config: Map.put(project().tracker_config, "status_field", "Symphony State")},
               "510",
               %{"status" => "In Progress", "agent" => "codex"}
             )

    assert_received {:add_labels, %{"labelableId" => "I_510", "labelIds" => ["LBL_CODEX"]}}
  end

  defmodule DispatchMissingLabelClientStub do
    def graphql(query, _vars, _opts) do
      cond do
        String.contains?(query, "SymphonyUiIssueNodeId") ->
          {:ok, %{"data" => %{"repository" => %{"issue" => %{"id" => "I_511"}}}}}

        String.contains?(query, "SymphonyUiResolveProjectItem") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "projectItems" => %{
                   "nodes" => [%{"id" => "PVTI_511", "project" => %{"id" => "PVT_1"}}]
                 }
               }
             }
           }}

        String.contains?(query, "fields(first") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "fields" => %{
                   "nodes" => [
                     %{
                       "__typename" => "ProjectV2SingleSelectField",
                       "id" => "FIELD_1",
                       "name" => "Symphony State",
                       "options" => [%{"id" => "OPT_IN_PROGRESS", "name" => "In Progress"}]
                     }
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "updateProjectV2ItemFieldValue") ->
          {:ok, %{"data" => %{"updateProjectV2ItemFieldValue" => %{"projectV2Item" => %{"id" => "PVTI_511"}}}}}

        String.contains?(query, "SymphonyUiRepoMetadata") ->
          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "id" => "REPO_1",
                 "labels" => %{"nodes" => []}
               }
             }
           }}

        true ->
          {:ok, %{"data" => %{}}}
      end
    end
  end

  test "move_issue surfaces a validation error when the agent routing label is missing" do
    Application.put_env(:symphony_elixir, :github_client_module, DispatchMissingLabelClientStub)

    assert {:error, {:remote_validation, %{agent_label: [message]}}} =
             IssueAdapter.move_issue(
               %{project() | tracker_config: Map.put(project().tracker_config, "status_field", "Symphony State")},
               "511",
               %{"status" => "In Progress", "agent" => "codex"}
             )

    assert message =~ "symphony:codex"
  end

  defmodule UpdateClientStub do
    def graphql(query, vars, _opts) do
      cond do
        String.contains?(query, "SymphonyUiIssueNodeId") ->
          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "issue" => %{
                   "id" => "I_10",
                   "title" => "Old",
                   "body" => "Old body",
                   "labels" => %{
                     "nodes" => [
                       %{"id" => "AGC", "name" => "symphony:codex"},
                       %{"id" => "OLD", "name" => "stale"}
                     ]
                   }
                 }
               }
             }
           }}

        String.contains?(query, "SymphonyUiRepoMetadata") ->
          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "id" => "REPO_1",
                 "labels" => %{
                   "nodes" => [
                     %{"id" => "L1", "name" => "bug", "color" => "ff0000"},
                     %{"id" => "AGC", "name" => "symphony:codex", "color" => nil},
                    %{"id" => "AGCL", "name" => "symphony:claude", "color" => nil},
                     %{"id" => "P2", "name" => "priority:2", "color" => nil}
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "SymphonyUiAssignableUsers") ->
          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "assignableUsers" => %{
                   "nodes" => [%{"id" => "U1", "login" => "alice", "name" => "Alice", "avatarUrl" => nil}]
                 }
               }
             }
           }}

        String.contains?(query, "SymphonyUiUpdateIssue") ->
          send(self(), {:update_input, vars["input"]})

          {:ok,
           %{
             "data" => %{
               "updateIssue" => %{
                 "issue" => %{"id" => "I_10", "number" => 10, "title" => "Updated title", "body" => "Updated body"}
               }
             }
           }}

        String.contains?(query, "SymphonyUiListItems") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "items" => %{
                   "nodes" => [
                     %{
                       "id" => "PVTI_10",
                       "content" => %{
                         "__typename" => "Issue",
                         "id" => "I_10",
                         "number" => 10,
                         "title" => "Remote",
                         "body" => nil,
                         "url" => "https://x/10",
                         "assignees" => %{"nodes" => []},
                         "labels" => %{"nodes" => [%{"name" => "bug"}]},
                         "createdAt" => "2026-05-28T00:00:00Z",
                         "updatedAt" => "2026-05-28T00:00:00Z"
                       },
                       "fieldValues" => %{
                         "nodes" => [
                           %{
                             "__typename" => "ProjectV2ItemFieldSingleSelectValue",
                             "name" => "Todo",
                             "field" => %{"name" => "Status"}
                           }
                         ]
                       }
                     }
                   ],
                   "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
                 }
               }
             }
           }}

        true ->
          {:ok, %{"data" => %{}}}
      end
    end
  end

  defmodule CreateClientStub do
    def graphql(query, vars, _opts) do
      cond do
        String.contains?(query, "SymphonyUiRepoMetadata") ->
          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "id" => "REPO_1",
                 "labels" => %{
                   "nodes" => [
                     %{"id" => "L1", "name" => "bug", "color" => "ff0000"},
                     %{"id" => "AGC", "name" => "symphony:codex", "color" => nil}
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "SymphonyUiAssignableUsers") ->
          {:ok,
           %{
             "data" => %{
               "repository" => %{
                 "assignableUsers" => %{
                   "nodes" => [%{"id" => "U1", "login" => "alice", "name" => "Alice", "avatarUrl" => nil}]
                 }
               }
             }
           }}

        String.contains?(query, "SymphonyUiStatusOptions") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "fields" => %{
                   "nodes" => [
                     %{
                       "__typename" => "ProjectV2SingleSelectField",
                       "id" => "FIELD_1",
                       "name" => "Symphony State",
                       "options" => [%{"id" => "OPT_TODO", "name" => "Todo"}]
                     }
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "SymphonyUiCreateIssue") ->
          send(self(), {:create_input, vars["input"]})

          {:ok,
           %{
             "data" => %{
               "createIssue" => %{
                 "issue" => %{"id" => "I_10", "number" => 10, "url" => "https://x/10", "title" => "New"}
               }
             }
           }}

        String.contains?(query, "SymphonyUiAddProjectItem") ->
          {:ok, %{"data" => %{"addProjectV2ItemById" => %{"item" => %{"id" => "PVTI_10"}}}}}

        String.contains?(query, "SymphonyUiSetStatus") ->
          {:ok, %{"data" => %{"updateProjectV2ItemFieldValue" => %{"projectV2Item" => %{"id" => "PVTI_10"}}}}}

        true ->
          {:ok, %{"data" => %{}}}
      end
    end
  end

  describe "create_issue" do
    setup do
      Application.put_env(:symphony_elixir, :github_client_module, CreateClientStub)
      :ok
    end

    test "creates issue, resolves agent label, adds to board, sets status" do
      attrs = %{
        "title" => "New",
        "status" => "Todo",
        "label_ids" => ["L1"],
        "assignee_ids" => ["U1"],
        "agent" => "codex"
      }

      assert {:ok, %IssueDTO{identifier: "10", title: "New", url: "https://x/10", labels: labels}} =
               IssueAdapter.create_issue(project(), attrs)

      assert "bug" in labels
      assert "symphony:codex" in labels

      assert_received {:create_input, input}
      assert input["repositoryId"] == "REPO_1"
      assert input["assigneeIds"] == ["U1"]
      assert "L1" in input["labelIds"]
      assert "AGC" in input["labelIds"]
    end

    test "returns validation error when title is blank" do
      assert {:error, {:remote_validation, %{title: ["is required"]}}} =
               IssueAdapter.create_issue(project(), %{"title" => "  ", "status" => "Todo"})
    end
  end

  describe "update_issue" do
    setup do
      Application.put_env(:symphony_elixir, :github_client_module, UpdateClientStub)
      :ok
    end

    test "updates title, description, and labels while preserving symphony labels" do
      attrs = %{
        "title" => "Updated title",
        "description" => "Updated body",
        "label_ids" => ["bug"]
      }

      assert {:ok, %IssueDTO{identifier: "10", title: "Remote"}} =
               IssueAdapter.update_issue(project(), "10", attrs)

      assert_received {:update_input, %{"id" => "I_10", "title" => "Updated title", "body" => "Updated body"}}
      assert_received {:update_input, %{"id" => "I_10", "labelIds" => label_ids}}
      assert "L1" in label_ids
      assert "AGC" in label_ids
    end

    test "updates assignee and priority" do
      attrs = %{"assignee_ids" => ["alice"], "priority" => 2}

      assert {:ok, %IssueDTO{identifier: "10"}} = IssueAdapter.update_issue(project(), "10", attrs)

      assert_received {:update_input, %{"id" => "I_10", "assigneeIds" => ["U1"]}}
      assert_received {:update_input, %{"id" => "I_10", "labelIds" => label_ids}}
      assert "P2" in label_ids
      assert "AGC" in label_ids
    end

    test "updates agent routing label without preserving the previous agent" do
      assert {:ok, %IssueDTO{identifier: "10"}} = IssueAdapter.update_issue(project(), "10", %{"agent" => "claude"})

      assert_received {:update_input, %{"id" => "I_10", "labelIds" => label_ids}}
      assert "AGCL" in label_ids
      refute "AGC" in label_ids
    end
  end

  describe "list_labels / list_assignable_users" do
    setup do
      Application.put_env(:symphony_elixir, :github_client_module, CreateClientStub)
      :ok
    end

    test "list_labels returns repo labels" do
      assert {:ok, labels} = IssueAdapter.list_labels(project())
      assert Enum.any?(labels, &(&1.name == "bug" and &1.id == "L1"))
    end

    test "list_assignable_users returns assignable users" do
      assert {:ok, [%{login: "alice", id: "U1"}]} = IssueAdapter.list_assignable_users(project())
    end
  end

  defp migrate_repo do
    alias SymphonyElixir.Repo

    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    alias SymphonyElixir.Repo

    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
