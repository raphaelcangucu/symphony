#!/usr/bin/env mix run
# Creates the "Macro Markets" GitHub Project v2 on clouapp/front via GraphQL.
# Requires GITHUB_TOKEN with repo + project scopes.
#
# Usage (from elixir/):
#   mise exec -- mix run scripts/bootstrap_macro_markets.exs

alias SymphonyElixir.GitHub.Client

repo = "clouapp/front"
project_title = "Macro Markets"
status_field = "Symphony State"
states = [
  "Todo",
  "In Progress",
  "Merging",
  "Rework",
  "Done",
  "Cancelled"
]

owner_query = """
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { owner { id } }
}
"""

create_project = """
mutation($ownerId: ID!, $title: String!) {
  createProjectV2(input: { ownerId: $ownerId, title: $title }) {
    projectV2 { id number url }
  }
}
"""

create_field = """
mutation($projectId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
  createProjectV2Field(input: {
    projectId: $projectId
    dataType: SINGLE_SELECT
    name: $name
    singleSelectOptions: $options
  }) {
    projectV2Field {
      ... on ProjectV2SingleSelectField {
        id name
        options { id name }
      }
    }
  }
}
"""

viewer_query = """
query { viewer { login } }
"""

[owner, name] = String.split(repo, "/", parts: 2)

with {:ok, %{"data" => %{"repository" => %{"owner" => %{"id" => owner_id}}}}} <-
       Client.graphql(owner_query, %{"owner" => owner, "name" => name}),
     {:ok, %{"data" => %{"createProjectV2" => %{"projectV2" => project}}}} <-
       Client.graphql(create_project, %{"ownerId" => owner_id, "title" => project_title}),
     options =
       Enum.map(states, fn state ->
         %{"name" => state, "color" => "GRAY", "description" => state}
       end),
     {:ok,
      %{
        "data" => %{
          "createProjectV2Field" => %{"projectV2Field" => %{"id" => field_id, "options" => opts}}
        }
      }} <-
       Client.graphql(create_field, %{
         "projectId" => project["id"],
         "name" => status_field,
         "options" => options
       }),
     {:ok, %{"data" => %{"viewer" => %{"login" => viewer_login}}}} <-
       Client.graphql(viewer_query, %{}) do
  state_options =
    Enum.reduce(opts, %{}, fn %{"name" => n, "id" => id}, acc -> Map.put(acc, n, id) end)

  metadata = %{
    "project_id" => project["id"],
    "project_number" => project["number"],
    "project_url" => project["url"],
    "status_field_id" => field_id,
    "status_field_name" => status_field,
    "state_options" => state_options,
    "viewer_login" => viewer_login,
    "bootstrapped_at" => DateTime.utc_now() |> DateTime.to_iso8601()
  }

  IO.puts(Jason.encode!(metadata, pretty: true))
  IO.puts(:stderr, "\nProject URL: #{project["url"]}")
  IO.puts(:stderr, "Set github.project.id to #{project["id"]} in WORKFLOW.macromarkets.example.md")
else
  {:error, reason} ->
    IO.puts(:stderr, "Bootstrap failed: #{inspect(reason)}")
    System.halt(1)
end
