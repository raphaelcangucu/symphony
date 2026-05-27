#!/usr/bin/env mix run
# Creates labeled issues on clouapp/front and adds them to the Macro Markets project.
#
# Usage:
#   mix run scripts/seed_macro_markets_issues.exs -- \
#     "Todo|First smoke task" \
#     "In Progress|Assignee filter check"
#
# Requires .symphony/github-project.json (from bootstrap_macro_markets.exs) or
# GITHUB_TOKEN + WORKFLOW with github.project.id set.

alias SymphonyElixir.GitHub.{Client, ProjectMetadata}

repo = "clouapp/front"
admission_label = "symphony"

create_issue = """
mutation($repoId: ID!, $title: String!) {
  createIssue(input: { repositoryId: $repoId, title: $title }) {
    issue { id number }
  }
}
"""

repo_id_query = """
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { id }
}
"""

add_item = """
mutation($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
    item { id }
  }
}
"""

set_state = """
mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId
    itemId: $itemId
    fieldId: $fieldId
    value: { singleSelectOptionId: $optionId }
  }) { projectV2Item { id } }
}
"""

label_issue = """
mutation($issueId: ID!, $labelIds: [ID!]!) {
  addLabelsToLabelable(input: { labelableId: $issueId, labelIds: $labelIds }) {
    labelable { ... on Issue { id } }
  }
}
"""

labels_query = """
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
  labels(first: 100) { nodes { id name } }
  }
}
"""

tasks =
  System.argv()
  |> Enum.map(fn arg ->
    case String.split(arg, "|", parts: 2) do
      [state, title] -> {String.trim(state), String.trim(title)}
      _ -> System.halt("Each arg must be STATE|Title, got: #{inspect(arg)}")
    end
  end)

if tasks == [], do: System.halt("Provide at least one STATE|Title argument")

with {:ok, metadata} <- ProjectMetadata.read(),
     project_id = metadata["project_id"],
     field_id = metadata["status_field_id"],
     state_options = metadata["state_options"],
     [owner, name] <- String.split(repo, "/", parts: 2),
     {:ok, %{"data" => %{"repository" => %{"id" => repo_id}}}} <-
       Client.graphql(repo_id_query, %{"owner" => owner, "name" => name}),
     {:ok, %{"data" => %{"repository" => %{"labels" => %{"nodes" => label_nodes}}}}} <-
       Client.graphql(labels_query, %{"owner" => owner, "name" => name}) do
  symphony_label_id =
    label_nodes
    |> Enum.find_value(fn %{"name" => n, "id" => id} ->
      if String.downcase(n) == admission_label, do: id
    end)

  if is_nil(symphony_label_id) do
    IO.puts(:stderr, "Label #{admission_label} not found on #{repo} — create it on GitHub first")
    System.halt(1)
  end

  Enum.each(tasks, fn {state, title} ->
    option_id = Map.get(state_options, state)

    if is_nil(option_id) do
      IO.puts(:stderr, "Unknown state #{inspect(state)} — not in project metadata")
    else
      with {:ok, %{"data" => %{"createIssue" => %{"issue" => issue}}}} <-
             Client.graphql(create_issue, %{"repoId" => repo_id, "title" => title}),
           {:ok, %{"data" => %{"addProjectV2ItemById" => %{"item" => %{"id" => item_id}}}}} <-
             Client.graphql(add_item, %{"projectId" => project_id, "contentId" => issue["id"]}),
           {:ok, _} <-
             Client.graphql(set_state, %{
               "projectId" => project_id,
               "itemId" => item_id,
               "fieldId" => field_id,
               "optionId" => option_id
             }),
           {:ok, _} <-
             Client.graphql(label_issue, %{
               "issueId" => issue["id"],
               "labelIds" => [symphony_label_id]
             }) do
        IO.puts("Created #{repo}##{issue["number"]} [#{state}] #{title}")
      else
        {:error, reason} -> IO.puts(:stderr, "Failed #{title}: #{inspect(reason)}")
      end
    end
  end)
else
  {:error, reason} ->
    IO.puts(:stderr, "Seed failed: #{inspect(reason)}")
    System.halt(1)
end
