defmodule SymphonyElixir.GitHub.BootstrapTest do
  use SymphonyElixir.TestSupport, async: false

  alias SymphonyElixir.GitHub.{Bootstrap, ProjectMetadata}
  alias SymphonyElixir.Workflow

  setup do
    tmp = System.tmp_dir!() |> Path.join("symphony-bootstrap-#{:erlang.unique_integer()}")
    File.mkdir_p!(tmp)
    on_exit(fn -> File.rm_rf!(tmp) end)

    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "github",
      tracker_repo: "raphaelcangucu/symphony",
      tracker_active_states: ["Todo", "In Progress"],
      tracker_terminal_states: ["Done", "Cancelled"],
      github_project_mode: "auto",
      github_project_title: "Symphony"
    )

    %{base_dir: tmp}
  end

  defmodule AutoMock do
    def graphql(query, variables, opts \\ []) do
      send(self_pid(), {:graphql, query, variables, opts})

      cond do
        query =~ "SymphonyGitHubResolveOwner" ->
          {:ok, %{"data" => %{"repository" => %{"owner" => %{"id" => "MDQ6VXNlcjE="}}}}}

        query =~ "SymphonyGitHubCreateProject" ->
          {:ok,
           %{
             "data" => %{
               "createProjectV2" => %{
                 "projectV2" => %{
                   "id" => "PVT_abc",
                   "number" => 7,
                   "url" => "https://github.com/users/raphaelcangucu/projects/7"
                 }
               }
             }
           }}

        query =~ "SymphonyGitHubCreateField" ->
          {:ok,
           %{
             "data" => %{
               "createProjectV2Field" => %{
                 "projectV2Field" => %{
                   "id" => "PVTSSF_xyz",
                   "name" => "Symphony State",
                   "options" => [
                     %{"id" => "opt-todo", "name" => "Todo"},
                     %{"id" => "opt-inprog", "name" => "In Progress"},
                     %{"id" => "opt-done", "name" => "Done"},
                     %{"id" => "opt-cancel", "name" => "Cancelled"}
                   ]
                 }
               }
             }
           }}

        query =~ "SymphonyGitHubItemsUsage" ->
          {:ok, empty_items_page()}

        query =~ "SymphonyGitHubViewer" ->
          {:ok, %{"data" => %{"viewer" => %{"login" => "bootstrap-tester"}}}}
      end
    end

    defp self_pid, do: Process.get(:bootstrap_test_pid)

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

  defmodule NoCallMock do
    def graphql(_query, _variables, _opts \\ []) do
      raise "Bootstrap should not call client when cache present"
    end
  end

  defmodule ExistingMock do
    def graphql(query, _variables, _opts \\ []) do
      cond do
        query =~ "SymphonyGitHubReadProject" ->
          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "id" => "PVT_existing",
                 "number" => 3,
                 "url" => "https://github.com/users/raphaelcangucu/projects/3",
                 "field" => %{
                   "id" => "PVTSSF_existing",
                   "name" => "Symphony State",
                   "options" => [
                     %{"id" => "opt-todo", "name" => "Todo"},
                     %{"id" => "opt-inprog", "name" => "In Progress"},
                     %{"id" => "opt-done", "name" => "Done"},
                     %{"id" => "opt-cancel", "name" => "Cancelled"}
                   ]
                 }
               }
             }
           }}

        query =~ "SymphonyGitHubItemsUsage" ->
          {:ok, empty_items_page()}

        query =~ "SymphonyGitHubViewer" ->
          {:ok, %{"data" => %{"viewer" => %{"login" => "existing-user"}}}}

        query =~ "SymphonyGitHubUpdateField" ->
          {:ok,
           %{
             "data" => %{
               "updateProjectV2Field" => %{
                 "projectV2Field" => %{
                   "options" => [
                     %{"id" => "opt-todo", "name" => "Todo"},
                     %{"id" => "opt-inprog", "name" => "In Progress"},
                     %{"id" => "opt-done", "name" => "Done"},
                     %{"id" => "opt-cancel", "name" => "Cancelled"}
                   ]
                 }
               }
             }
           }}

        true ->
          {:error, {:unexpected_query, query}}
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

  defmodule UnusedMock do
    def graphql(_query, _variables, _opts \\ []) do
      raise "should not call client"
    end
  end

  defmodule FailMock do
    def graphql(_query, _variables, _opts \\ []) do
      {:error, {:github_api_status, 401}}
    end
  end

  defmodule GraphQLErrorMock do
    def graphql(query, _variables, _opts \\ []) do
      cond do
        query =~ "SymphonyGitHubResolveOwner" ->
          {:error, {:github_graphql_errors, [%{"message" => "rate limited"}, %{"message" => "try again"}]}}
      end
    end
  end

  defmodule GraphQLEmptyMessageMock do
    def graphql(query, _variables, _opts \\ []) do
      cond do
        query =~ "SymphonyGitHubResolveOwner" ->
          {:error, {:github_graphql_errors, [%{"code" => "rate_limit"}]}}
      end
    end
  end

  defmodule ApiStatusMock do
    def graphql(query, _variables, _opts \\ []) do
      cond do
        query =~ "SymphonyGitHubResolveOwner" ->
          {:error, {:github_api_status, 500}}
      end
    end
  end

  defmodule ApiRequestMock do
    def graphql(query, _variables, _opts \\ []) do
      cond do
        query =~ "SymphonyGitHubResolveOwner" ->
          {:error, {:github_api_request, :nxdomain}}
      end
    end
  end

  defmodule OwnerNilMock do
    def graphql(query, _variables, _opts \\ []) do
      cond do
        query =~ "SymphonyGitHubResolveOwner" ->
          {:ok, %{"data" => %{"repository" => nil}}}
      end
    end
  end

  defmodule WeirdOwnerMock do
    def graphql(query, _variables, _opts \\ []) do
      cond do
        query =~ "SymphonyGitHubResolveOwner" ->
          {:ok, %{"data" => %{"repository" => %{"owner" => %{}}}}}
      end
    end
  end

  defmodule BinaryErrorMock do
    def graphql(query, _variables, _opts \\ []) do
      cond do
        query =~ "SymphonyGitHubResolveOwner" ->
          {:error, "owner lookup boom"}
      end
    end
  end

  defmodule MalformedCreateMock do
    def graphql(query, _variables, _opts \\ []) do
      cond do
        query =~ "SymphonyGitHubResolveOwner" ->
          {:ok, %{"data" => %{"repository" => %{"owner" => %{"id" => "OWNER_Z"}}}}}

        query =~ "SymphonyGitHubCreateProject" ->
          {:ok, %{"data" => %{"createProjectV2" => %{"projectV2" => %{}}}}}
      end
    end
  end

  defmodule CreateProjectErrorMock do
    def graphql(query, _variables, _opts \\ []) do
      cond do
        query =~ "SymphonyGitHubResolveOwner" ->
          {:ok, %{"data" => %{"repository" => %{"owner" => %{"id" => "OWNER_A"}}}}}

        query =~ "SymphonyGitHubCreateProject" ->
          {:error, {:github_api_status, 403}}
      end
    end
  end

  defmodule CreateFieldUnexpectedMock do
    def graphql(query, _variables, _opts \\ []) do
      cond do
        query =~ "SymphonyGitHubResolveOwner" ->
          {:ok, %{"data" => %{"repository" => %{"owner" => %{"id" => "OWNER_X"}}}}}

        query =~ "SymphonyGitHubCreateProject" ->
          {:ok,
           %{
             "data" => %{
               "createProjectV2" => %{
                 "projectV2" => %{
                   "id" => "PVT_x",
                   "number" => 1,
                   "url" => "https://github.com/users/x/projects/1"
                 }
               }
             }
           }}

        query =~ "SymphonyGitHubCreateField" ->
          {:ok,
           %{
             "data" => %{
               "createProjectV2Field" => %{"projectV2Field" => %{"unexpected" => true}}
             }
           }}
      end
    end
  end

  defmodule MalformedOptionAutoMock do
    @moduledoc """
    Exercises the success path through `build_metadata/2` where the
    GraphQL field response contains an option entry with non-binary
    name/id values. The reducer must skip the malformed entry and keep
    well-formed entries in `state_options`.
    """

    def graphql(query, _variables, _opts \\ []) do
      cond do
        query =~ "SymphonyGitHubResolveOwner" ->
          {:ok, %{"data" => %{"repository" => %{"owner" => %{"id" => "OWNER_M"}}}}}

        query =~ "SymphonyGitHubCreateProject" ->
          {:ok,
           %{
             "data" => %{
               "createProjectV2" => %{
                 "projectV2" => %{
                   "id" => "PVT_m",
                   "number" => 4,
                   "url" => "https://github.com/users/m/projects/4"
                 }
               }
             }
           }}

        query =~ "SymphonyGitHubCreateField" ->
          {:ok,
           %{
             "data" => %{
               "createProjectV2Field" => %{
                 "projectV2Field" => %{
                   "id" => "PVTSSF_m",
                   "name" => "Symphony State",
                   "options" => [
                     %{"id" => "opt-todo", "name" => "Todo"},
                     %{"id" => nil, "name" => nil},
                     %{"id" => "opt-done", "name" => "Done"}
                   ]
                 }
               }
             }
           }}

        query =~ "SymphonyGitHubItemsUsage" ->
          {:ok, empty_items_page()}

        query =~ "SymphonyGitHubUpdateField" ->
          {:ok,
           %{
             "data" => %{
               "updateProjectV2Field" => %{
                 "projectV2Field" => %{
                   "options" => [
                     %{"id" => "opt-todo", "name" => "Todo"},
                     %{"id" => "opt-inprog", "name" => "In Progress"},
                     %{"id" => "opt-done", "name" => "Done"},
                     %{"id" => "opt-cancel", "name" => "Cancelled"}
                   ]
                 }
               }
             }
           }}

        query =~ "SymphonyGitHubViewer" ->
          {:ok, %{"data" => %{"viewer" => %{"login" => "malformed-test"}}}}
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

  defmodule ExistingFailMock do
    def graphql(query, _variables, _opts \\ []) do
      cond do
        query =~ "SymphonyGitHubReadProject" ->
          {:error, {:github_api_status, 502}}
      end
    end
  end

  defmodule ExistingMalformedMock do
    def graphql(query, _variables, _opts \\ []) do
      cond do
        query =~ "SymphonyGitHubReadProject" ->
          {:ok, %{"data" => %{"node" => %{"id" => "PVT_specified", "field" => nil}}}}
      end
    end
  end

  describe "ensure_project/1 with mode=auto and no cache" do
    test "creates project + field and writes metadata", %{base_dir: base_dir} do
      Process.put(:bootstrap_test_pid, self())

      assert :ok = Bootstrap.ensure_project(base_dir: base_dir, client_module: AutoMock)

      assert_received {:graphql, owner_query, %{"owner" => "raphaelcangucu", "name" => "symphony"}, _}

      assert owner_query =~ "SymphonyGitHubResolveOwner"

      assert_received {:graphql, project_query, %{"ownerId" => "MDQ6VXNlcjE=", "title" => "Symphony"}, _}

      assert project_query =~ "SymphonyGitHubCreateProject"

      assert_received {:graphql, field_query, %{"projectId" => "PVT_abc", "name" => "Symphony State"} = field_vars, _}

      assert field_query =~ "SymphonyGitHubCreateField"
      assert is_list(field_vars["options"])
      assert Enum.any?(field_vars["options"], &(&1["name"] == "In Progress"))
      assert Enum.any?(field_vars["options"], &(&1["name"] == "Cancelled"))

      assert {:ok, metadata} = ProjectMetadata.read(base_dir)
      assert metadata["project_id"] == "PVT_abc"
      assert metadata["project_number"] == 7
      assert metadata["status_field_id"] == "PVTSSF_xyz"
      assert metadata["state_options"]["Todo"] == "opt-todo"
      assert metadata["state_options"]["Cancelled"] == "opt-cancel"
      assert is_binary(metadata["bootstrapped_at"])
    end
  end

  describe "ensure_project/1 idempotency" do
    test "returns :ok and does not call client when cache is present", %{base_dir: base_dir} do
      ProjectMetadata.write!(base_dir, %{
        "project_id" => "PVT_existing",
        "project_number" => 1,
        "project_url" => "https://github.com/orgs/test/projects/1",
        "status_field_id" => "PVTSSF_existing",
        "status_field_name" => "Symphony State",
        "state_options" => %{
          "Todo" => "opt-1",
          "In Progress" => "opt-2",
          "Done" => "opt-3",
          "Cancelled" => "opt-4"
        },
        "viewer_login" => "cached-user",
        "bootstrapped_at" => "2026-01-01T00:00:00Z"
      })

      assert :ok = Bootstrap.ensure_project(base_dir: base_dir, client_module: NoCallMock)
    end
  end

  describe "ensure_project/1 with mode=existing" do
    setup do
      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "github",
        tracker_repo: "raphaelcangucu/symphony",
        github_project_mode: "existing",
        github_project_id: "PVT_existing"
      )

      :ok
    end

    test "reads existing project + writes cache", %{base_dir: base_dir} do
      assert :ok = Bootstrap.ensure_project(base_dir: base_dir, client_module: ExistingMock)

      assert {:ok, metadata} = ProjectMetadata.read(base_dir)
      assert metadata["project_id"] == "PVT_existing"
      assert metadata["state_options"]["Todo"] == "opt-todo"
    end

    test "fails when project_id missing", %{base_dir: base_dir} do
      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "github",
        tracker_repo: "raphaelcangucu/symphony",
        github_project_mode: "existing"
      )

      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: UnusedMock)

      assert message =~ "github.project.id"
    end
  end

  describe "ensure_project/1 error handling" do
    test "surfaces graphql errors", %{base_dir: base_dir} do
      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: FailMock)

      assert message =~ "GitHub project bootstrap failed"
    end

    test "surfaces invalid metadata file", %{base_dir: base_dir} do
      cache_path = ProjectMetadata.cache_path(base_dir)
      File.mkdir_p!(Path.dirname(cache_path))
      File.write!(cache_path, "{not json")

      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: UnusedMock)

      assert message =~ "Invalid GitHub project metadata"
    end

    test "leaves caller actionable when field creation fails after project creation", %{base_dir: base_dir} do
      defmodule OrphanMock do
        def graphql(query, _variables, _opts \\ []) do
          cond do
            query =~ "SymphonyGitHubResolveOwner" ->
              {:ok, %{"data" => %{"repository" => %{"owner" => %{"id" => "OWNER_ID"}}}}}

            query =~ "SymphonyGitHubCreateProject" ->
              {:ok,
               %{
                 "data" => %{
                   "createProjectV2" => %{
                     "projectV2" => %{
                       "id" => "PVT_orphan",
                       "number" => 9,
                       "url" => "https://github.com/users/raphaelcangucu/projects/9"
                     }
                   }
                 }
               }}

            query =~ "SymphonyGitHubCreateField" ->
              {:error, {:github_api_status, 422}}
          end
        end
      end

      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: OrphanMock)

      assert message =~ "https://github.com/users/raphaelcangucu/projects/9"
      assert message =~ "field creation failed"
      assert message =~ "github.project.mode=existing"

      refute match?({:ok, _}, ProjectMetadata.read(base_dir))
    end

    test "rejects unsupported project mode", %{base_dir: base_dir} do
      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "github",
        tracker_repo: "raphaelcangucu/symphony",
        github_project_mode: "manual"
      )

      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: UnusedMock)

      assert message =~ "Unsupported github.project.mode"
      assert message =~ "manual"
    end

    test "fails cleanly when existing project_id points to missing node", %{base_dir: base_dir} do
      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "github",
        tracker_repo: "raphaelcangucu/symphony",
        github_project_mode: "existing",
        github_project_id: "PVT_missing"
      )

      defmodule MissingNodeMock do
        def graphql(query, _variables, _opts \\ []) do
          cond do
            query =~ "SymphonyGitHubReadProject" ->
              {:ok, %{"data" => %{"node" => nil}}}
          end
        end
      end

      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: MissingNodeMock)

      assert message =~ "GitHub project bootstrap failed"
    end
  end

  describe "format_error/1 via end-to-end errors" do
    test "formats github_graphql_errors with concatenated messages", %{base_dir: base_dir} do
      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: GraphQLErrorMock)

      assert message =~ "GitHub GraphQL error: rate limited; try again"
    end

    test "formats github_graphql_errors with no messages by inspecting the list", %{base_dir: base_dir} do
      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: GraphQLEmptyMessageMock)

      assert message =~ "GitHub GraphQL error: ["
      assert message =~ "rate_limit"
    end

    test "formats github_api_status", %{base_dir: base_dir} do
      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: ApiStatusMock)

      assert message =~ "GitHub API status 500"
    end

    test "formats github_api_request", %{base_dir: base_dir} do
      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: ApiRequestMock)

      assert message =~ "GitHub API request failed: :nxdomain"
    end

    test "formats owner_lookup_unexpected as repository not found", %{base_dir: base_dir} do
      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: OwnerNilMock)

      assert message =~ "GitHub repository not found"
    end

    test "surfaces resolve_owner_id {:ok, body} via generic inspect", %{base_dir: base_dir} do
      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: WeirdOwnerMock)

      assert message =~ "GitHub project bootstrap failed"
      assert message =~ "owner_lookup_unexpected"
    end

    test "formats binary reason verbatim through bootstrap_auto", %{base_dir: base_dir} do
      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: BinaryErrorMock)

      assert message =~ "GitHub project bootstrap failed: owner lookup boom"
    end
  end

  describe "create_project failure paths" do
    test "surfaces create_project_unexpected when projectV2 is missing id", %{base_dir: base_dir} do
      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: MalformedCreateMock)

      assert message =~ "GitHub project bootstrap failed"
      assert message =~ "create_project_unexpected"
    end

    test "surfaces graphql {:error, reason} returned from create_project", %{base_dir: base_dir} do
      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: CreateProjectErrorMock)

      assert message =~ "GitHub project bootstrap failed"
      assert message =~ "GitHub API status 403"
    end
  end

  describe "create_status_field unexpected body" do
    test "formats create_field_unexpected with project url and inspected body", %{base_dir: base_dir} do
      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: CreateFieldUnexpectedMock)

      assert message =~ "https://github.com/users/x/projects/1"
      assert message =~ "Symphony State field response was unexpected"
    end
  end

  describe "build_metadata fallback" do
    test "skips malformed option entries and records well-formed states", %{base_dir: base_dir} do
      assert :ok =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: MalformedOptionAutoMock)

      assert {:ok, metadata} = ProjectMetadata.read(base_dir)
      assert metadata["state_options"]["Todo"] == "opt-todo"
      assert metadata["state_options"]["Done"] == "opt-done"
      refute Map.has_key?(metadata["state_options"], nil)
    end
  end

  describe "write_metadata rescue" do
    test "surfaces File.Error from ProjectMetadata.write! as a formatted error", %{base_dir: base_dir} do
      cache_dir = Path.join(base_dir, ".symphony")
      File.mkdir_p!(cache_dir)
      File.chmod!(cache_dir, 0o555)
      on_exit(fn -> File.chmod(cache_dir, 0o755) end)

      Process.put(:bootstrap_test_pid, self())

      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: AutoMock)

      assert message =~ "GitHub project bootstrap failed"
      assert message =~ "write_metadata"
      assert message =~ "permission denied"
    end
  end

  describe "bootstrap_existing error paths" do
    setup %{base_dir: base_dir} do
      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "github",
        tracker_repo: "raphaelcangucu/symphony",
        github_project_mode: "existing",
        github_project_id: "PVT_specified"
      )

      %{base_dir: base_dir}
    end

    test "surfaces graphql error during load_existing_project", %{base_dir: base_dir} do
      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: ExistingFailMock)

      assert message =~ "GitHub project bootstrap failed"
      assert message =~ "GitHub API status 502"
    end

    test "surfaces existing_project_unexpected when payload is malformed", %{base_dir: base_dir} do
      assert {:error, message} =
               Bootstrap.ensure_project(base_dir: base_dir, client_module: ExistingMalformedMock)

      assert message =~ "GitHub project bootstrap failed"
      assert message =~ "existing_project_unexpected"
    end
  end

  describe "client_module/1 application env fallback" do
    setup %{base_dir: base_dir} do
      previous = Application.get_env(:symphony_elixir, :github_client_module)
      Application.put_env(:symphony_elixir, :github_client_module, FailMock)

      on_exit(fn ->
        case previous do
          nil -> Application.delete_env(:symphony_elixir, :github_client_module)
          value -> Application.put_env(:symphony_elixir, :github_client_module, value)
        end
      end)

      %{base_dir: base_dir}
    end

    test "uses Application env when client_module opt is omitted", %{base_dir: base_dir} do
      assert {:error, message} = Bootstrap.ensure_project(base_dir: base_dir)
      assert message =~ "GitHub project bootstrap failed"
      assert message =~ "GitHub API status 401"
    end

    test "defaults base_dir to cwd when ensure_project/0 is called without opts",
         %{base_dir: base_dir} do
      File.cd!(base_dir, fn ->
        assert {:error, message} = Bootstrap.ensure_project()
        assert message =~ "GitHub project bootstrap failed"
        assert message =~ "GitHub API status 401"
      end)
    end
  end
end
