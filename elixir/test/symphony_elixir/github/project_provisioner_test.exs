defmodule SymphonyElixir.GitHub.ProjectProvisionerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.ProjectProvisioner

  test "provision reconciles the built-in Status field options via GraphQL" do
    client = fn query, variables, _opts ->
      cond do
        String.contains?(query, "SymphonyGitHubResolveOwner") ->
          {:ok, %{"data" => %{"repository" => %{"owner" => %{"id" => "OWNER_ID"}}}}}

        String.contains?(query, "SymphonyGitHubCreateProject") ->
          assert variables == %{"ownerId" => "OWNER_ID", "title" => "Distribution Machine"}

          {:ok,
           %{
             "data" => %{
               "createProjectV2" => %{
                 "projectV2" => %{
                   "id" => "PVT_test",
                   "number" => 9,
                   "url" => "https://github.com/orgs/clouapp/projects/9"
                 }
               }
             }
           }}

        String.contains?(query, "SymphonyGitHubReadStatusField") ->
          assert variables == %{"projectId" => "PVT_test", "name" => "Status"}

          {:ok,
           %{
             "data" => %{
               "node" => %{
                 "field" => %{
                   "id" => "FIELD_ID",
                   "name" => "Status",
                   "options" => [%{"id" => "OPT_DEFAULT_TODO", "name" => "Todo"}]
                 }
               }
             }
           }}

        String.contains?(query, "SymphonyGitHubUpdateStatusField") ->
          input = variables["input"]
          assert input["fieldId"] == "FIELD_ID"
          options = input["singleSelectOptions"]
          assert length(options) == 2

          todo = Enum.find(options, &(&1["name"] == "Todo"))
          done = Enum.find(options, &(&1["name"] == "Done"))
          assert todo["id"] == "OPT_DEFAULT_TODO"
          refute Map.has_key?(done, "id")

          {:ok,
           %{
             "data" => %{
               "updateProjectV2Field" => %{
                 "projectV2Field" => %{
                   "id" => "FIELD_ID",
                   "name" => "Status",
                   "options" => [
                     %{"id" => "OPT_DEFAULT_TODO", "name" => "Todo"},
                     %{"id" => "OPT_NEW_DONE", "name" => "Done"}
                   ]
                 }
               }
             }
           }}

        true ->
          flunk("unexpected query: #{query}")
      end
    end

    assert {:ok, result} =
             ProjectProvisioner.provision(
               %{
                 repo: "clouapp/distributionmachine",
                 title: "Distribution Machine",
                 states: ["Todo", "Done"]
               },
               client: client
             )

    assert result.project_id == "PVT_test"
    assert result.status_field_name == "Status"
    assert result.state_options == %{"Todo" => "OPT_DEFAULT_TODO", "Done" => "OPT_NEW_DONE"}
  end

  test "provision creates a custom status field when it does not exist yet" do
    client = fn query, variables, _opts ->
      cond do
        String.contains?(query, "SymphonyGitHubResolveOwner") ->
          {:ok, %{"data" => %{"repository" => %{"owner" => %{"id" => "OWNER_ID"}}}}}

        String.contains?(query, "SymphonyGitHubCreateProject") ->
          {:ok,
           %{
             "data" => %{
               "createProjectV2" => %{
                 "projectV2" => %{"id" => "PVT_test", "number" => 9, "url" => "https://example.test"}
               }
             }
           }}

        String.contains?(query, "SymphonyGitHubReadStatusField") ->
          assert variables == %{"projectId" => "PVT_test", "name" => "Custom State"}
          {:ok, %{"data" => %{"node" => %{"field" => nil}}}}

        String.contains?(query, "SymphonyGitHubCreateStatusField") ->
          assert variables["name"] == "Custom State"
          assert length(variables["options"]) == 2

          {:ok,
           %{
             "data" => %{
               "createProjectV2Field" => %{
                 "projectV2Field" => %{
                   "id" => "FIELD_ID",
                   "name" => "Custom State",
                   "options" => [%{"id" => "OPT_1", "name" => "Todo"}, %{"id" => "OPT_2", "name" => "Done"}]
                 }
               }
             }
           }}

        true ->
          flunk("unexpected query: #{query}")
      end
    end

    assert {:ok, result} =
             ProjectProvisioner.provision(
               %{
                 repo: "clouapp/distributionmachine",
                 title: "Distribution Machine",
                 states: ["Todo", "Done"],
                 status_field: "Custom State"
               },
               client: client
             )

    assert result.status_field_name == "Custom State"
    assert result.state_options == %{"Todo" => "OPT_1", "Done" => "OPT_2"}
  end
end
