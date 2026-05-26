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
      end
    end

    defp self_pid, do: Process.get(:bootstrap_test_pid)
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
                     %{"id" => "opt-done", "name" => "Done"}
                   ]
                 }
               }
             }
           }}
      end
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
        "status_field_id" => "PVTSSF_existing",
        "state_options" => %{"Todo" => "opt-1"},
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
end
