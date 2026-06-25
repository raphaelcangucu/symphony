defmodule SymphonyElixir.GitHub.StateReconciliationTest do
  use SymphonyElixir.TestSupport, async: false

  alias SymphonyElixir.GitHub.{ProjectMetadata, StateReconciliation}
  alias SymphonyElixir.Workflow

  @metadata %{
    "project_id" => "PVT_test",
    "project_url" => "https://github.com/orgs/clouapp/projects/1",
    "status_field_id" => "FIELD_1",
    "status_field_name" => "Status",
    "state_options" => %{"Todo" => "opt_todo", "Done" => "opt_done"}
  }

  defmodule AddStateMock do
    def graphql(query, variables, _opts) do
      cond do
        String.contains?(query, "SymphonyGitHubItemsUsage") ->
          {:ok, empty_items_page()}

        String.contains?(query, "SymphonyGitHubUpdateField") ->
          assert get_in(variables, ["input", "fieldId"]) == "FIELD_1"
          options = get_in(variables, ["input", "singleSelectOptions"])
          names = Enum.map(options, & &1["name"])
          assert "In Progress" in names

          {:ok,
           %{
             "data" => %{
               "updateProjectV2Field" => %{
                 "projectV2Field" => %{
                   "options" => [
                     %{"id" => "opt_todo", "name" => "Todo"},
                     %{"id" => "opt_done", "name" => "Done"},
                     %{"id" => "opt_ip", "name" => "In Progress"}
                   ]
                 }
               }
             }
           }}

        true ->
          raise "unexpected query: #{query}"
      end
    end

    defp empty_items_page do
      %{
        "data" => %{
          "node" => %{
            "items" => %{
              "nodes" => [],
              "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
            }
          }
        }
      }
    end
  end

  defmodule InUseMock do
    def graphql(query, _variables, _opts) do
      if String.contains?(query, "SymphonyGitHubItemsUsage") do
        {:ok, items_page_with_state("Legacy")}
      else
        raise "should not update field when state in use"
      end
    end

    defp items_page_with_state(state_name) do
      %{
        "data" => %{
          "node" => %{
            "items" => %{
              "nodes" => [
                %{
                  "fieldValues" => %{
                    "nodes" => [
                      %{
                        "__typename" => "ProjectV2ItemFieldSingleSelectValue",
                        "name" => state_name,
                        "field" => %{"id" => "FIELD_1", "name" => "Status"}
                      }
                    ]
                  }
                }
              ],
              "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
            }
          }
        }
      }
    end
  end

  defmodule NoOpReconcileMock do
    def graphql(query, _, _) do
      if String.contains?(query, "SymphonyGitHubItemsUsage"),
        do: {:ok, empty_items_page()},
        else: raise("unexpected #{query}")
    end

    defp empty_items_page do
      %{
        "data" => %{
          "node" => %{
            "items" => %{
              "nodes" => [],
              "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}
            }
          }
        }
      }
    end
  end

  defmodule UpdateFailMock do
    def graphql(query, _variables, _opts) do
      cond do
        String.contains?(query, "SymphonyGitHubItemsUsage") ->
          {:ok, empty_items_page()}

        String.contains?(query, "SymphonyGitHubUpdateField") ->
          {:error, {:github_api_status, 502}}

        true ->
          raise query
      end
    end

    defp empty_items_page do
      %{
        "data" => %{
          "node" => %{
            "items" => %{"nodes" => [], "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}}
          }
        }
      }
    end
  end

  setup do
    tmp = System.tmp_dir!() |> Path.join("symphony-reconcile-#{:erlang.unique_integer()}")
    File.mkdir_p!(tmp)
    on_exit(fn -> File.rm_rf!(tmp) end)

    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "github",
      tracker_repo: "clouapp/front",
      tracker_active_states: ["Todo", "In Progress"],
      tracker_terminal_states: ["Done"]
    )

    %{dir: tmp}
  end

  test "reconcile adds missing WORKFLOW states via updateProjectV2Field", %{dir: dir} do
    log =
      capture_log(fn ->
        assert :ok = StateReconciliation.reconcile(dir, @metadata, client_module: AddStateMock)
      end)

    assert log =~ "Added Status option(s)"
  end

  test "reconcile is no-op when WORKFLOW states already match cache", %{dir: dir} do
    metadata =
      Map.merge(@metadata, %{
        "state_options" => %{"Todo" => "opt_todo", "In Progress" => "opt_ip", "Done" => "opt_done"}
      })

    assert :ok = StateReconciliation.reconcile(dir, metadata, client_module: NoOpReconcileMock)
  end

  test "reconcile surfaces updateProjectV2Field failures", %{dir: dir} do
    assert {:error, message} = StateReconciliation.reconcile(dir, @metadata, client_module: UpdateFailMock)
    assert message =~ "updateProjectV2Field failed"
  end

  test "reconcile refreshes metadata when options are added", %{dir: dir} do
    assert :ok = StateReconciliation.reconcile(dir, @metadata, client_module: AddStateMock)
    assert {:ok, metadata} = ProjectMetadata.read(dir)
    assert metadata["state_options"]["In Progress"] == "opt_ip"
  end

  test "reconcile halts when removed state is still in use", %{dir: dir} do
    metadata = Map.put(@metadata, "state_options", Map.put(@metadata["state_options"], "Legacy", "opt_legacy"))

    assert {:error, message} = StateReconciliation.reconcile(dir, metadata, client_module: InUseMock)
    assert message =~ "Legacy"
    assert message =~ "project item"
    assert message =~ "Project Status"
    assert message =~ "Move them to another state"
  end

  defmodule AddBacklogMock do
    def graphql(query, variables, _opts) do
      cond do
        String.contains?(query, "SymphonyGitHubItemsUsage") ->
          {:ok, empty_items_page()}

        String.contains?(query, "SymphonyGitHubUpdateField") ->
          names = get_in(variables, ["input", "singleSelectOptions"]) |> Enum.map(& &1["name"])
          assert "Backlog" in names

          {:ok,
           %{
             "data" => %{
               "updateProjectV2Field" => %{
                 "projectV2Field" => %{
                   "options" => [
                     %{"id" => "opt_backlog", "name" => "Backlog"},
                     %{"id" => "opt_todo", "name" => "Todo"},
                     %{"id" => "opt_done", "name" => "Done"}
                   ]
                 }
               }
             }
           }}

        true ->
          raise "unexpected query: #{query}"
      end
    end

    defp empty_items_page do
      %{
        "data" => %{
          "node" => %{
            "items" => %{"nodes" => [], "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}}
          }
        }
      }
    end
  end

  test "reconcile adds field_states such as Backlog that are not active or terminal", %{dir: dir} do
    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "github",
      tracker_repo: "clouapp/front",
      tracker_field_states: ["Backlog", "Todo", "Done"],
      tracker_active_states: ["Todo"],
      tracker_terminal_states: ["Done"]
    )

    assert :ok = StateReconciliation.reconcile(dir, @metadata, client_module: AddBacklogMock)
  end

  defmodule ReconcileProjectMock do
    def graphql(query, variables, _opts) do
      cond do
        String.contains?(query, "SymphonyGitHubReadStatusField") ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "url" => "https://github.com/orgs/clouapp/projects/2",
                 "field" => %{
                   "id" => "FIELD_1",
                   "name" => "Status",
                   "options" => [
                     %{"id" => "opt_backlog", "name" => "Backlog"},
                     %{"id" => "opt_todo", "name" => "Todo"}
                   ]
                 }
               }
             }
           }}

        String.contains?(query, "SymphonyGitHubItemsUsage") ->
          {:ok, empty_items_page()}

        String.contains?(query, "SymphonyGitHubUpdateField") ->
          names = get_in(variables, ["input", "singleSelectOptions"]) |> Enum.map(& &1["name"])
          assert "Planning" in names
          assert Enum.at(names, 1) == "Planning"

          {:ok,
           %{
             "data" => %{
               "updateProjectV2Field" => %{
                 "projectV2Field" => %{
                   "options" => [
                     %{"id" => "opt_backlog", "name" => "Backlog"},
                     %{"id" => "opt_planning", "name" => "Planning"},
                     %{"id" => "opt_todo", "name" => "Todo"}
                   ]
                 }
               }
             }
           }}

        true ->
          raise "unexpected query: #{query}"
      end
    end

    defp empty_items_page do
      %{
        "data" => %{
          "node" => %{
            "items" => %{"nodes" => [], "pageInfo" => %{"hasNextPage" => false, "endCursor" => nil}}
          }
        }
      }
    end
  end

  test "reconcile_project adds missing local workflow statuses to GitHub", %{dir: _dir} do
    project = %SymphonyElixir.LocalTracker.Project{
      tracker_kind: "github",
      slug: "macro-markets",
      tracker_config: %{
        "project_id" => "PVT_test",
        "repo" => "clouapp/front",
        "status_field" => "Status"
      }
    }

    log =
      capture_log(fn ->
        assert :ok =
                 StateReconciliation.reconcile_project(project,
                   client_module: ReconcileProjectMock,
                   desired_states: ["Backlog", "Planning", "Todo"]
                 )
      end)

    assert log =~ "Planning"
  end
end
