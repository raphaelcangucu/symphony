defmodule SymphonyElixir.GitHub.ProjectProvisionerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.ProjectProvisioner

  test "provision creates project and status field via GraphQL" do
    client = fn query, variables, _opts ->
      cond do
        String.contains?(query, "SymphonyGitHubResolveOwner") ->
          {:ok, %{"data" => %{"repository" => %{"owner" => %{"id" => "OWNER_ID"}}}}}

        String.contains?(query, "SymphonyGitHubCreateProject") ->
          assert variables == %{"ownerId" => "OWNER_ID", "title" => "Distribution Machine"}
          {:ok, %{"data" => %{"createProjectV2" => %{"projectV2" => %{"id" => "PVT_test", "number" => 9, "url" => "https://github.com/orgs/clouapp/projects/9"}}}}}

        String.contains?(query, "SymphonyGitHubCreateStatusField") ->
          assert variables["projectId"] == "PVT_test"
          assert length(variables["options"]) == 2

          {:ok,
           %{
             "data" => %{
               "createProjectV2Field" => %{
                 "projectV2Field" => %{
                   "id" => "FIELD_ID",
                   "name" => "Symphony State",
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
                 states: ["Todo", "Done"]
               },
               client: client
             )

    assert result.project_id == "PVT_test"
    assert result.state_options == %{"Todo" => "OPT_1", "Done" => "OPT_2"}
  end
end
