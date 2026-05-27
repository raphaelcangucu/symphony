#!/usr/bin/env mix run
# Creates labeled issues on clouapp/front and adds them to the Macro Markets project.
#
# Usage:
#   mix run scripts/seed_macro_markets_issues.exs -- \
#     "Todo|First smoke task" \
#     "Todo|codex|Explicit codex task" \
#     "Todo|claude|Explicit claude task"
#
# Optional middle segment: codex | claude (omit for base `symphony` → default Codex).
#
# Requires .symphony/github-project.json (from bootstrap_macro_markets.exs).

alias SymphonyElixir.{AgentRouting, GitHub.Client, GitHub.ProjectMetadata}

{:ok, _} = Application.ensure_all_started(:req)

repo = "clouapp/front"

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

parse_task = fn arg ->
  case String.split(arg, "|") do
    [state, title] ->
      {String.trim(state), :default, String.trim(title)}

    [state, agent, title] ->
      {String.trim(state), String.trim(agent) |> String.downcase() |> String.to_atom(), String.trim(title)}

    _ ->
      System.halt("Each arg must be STATE|Title or STATE|codex|Title or STATE|claude|Title, got: #{inspect(arg)}")
  end
end

routing_label = fn
  :default -> AgentRouting.symphony_label()
  :codex -> "symphony:codex"
  :claude -> "symphony:claude"
  other -> System.halt("Unknown agent #{inspect(other)} — use codex, claude, or omit")
end

tasks = System.argv() |> Enum.map(parse_task)

if tasks == [], do: System.halt("Provide at least one task argument")

with {:ok, metadata} <- ProjectMetadata.read(),
     project_id = metadata["project_id"],
     field_id = metadata["status_field_id"],
     state_options = metadata["state_options"],
     [owner, name] <- String.split(repo, "/", parts: 2),
     {:ok, %{"data" => %{"repository" => %{"id" => repo_id}}}} <-
       Client.graphql(repo_id_query, %{"owner" => owner, "name" => name}),
     {:ok, %{"data" => %{"repository" => %{"labels" => %{"nodes" => label_nodes}}}}} <-
       Client.graphql(labels_query, %{"owner" => owner, "name" => name}) do
  label_id_by_name =
    Map.new(label_nodes, fn %{"name" => n, "id" => id} -> {String.downcase(n), id} end)

  Enum.each(tasks, fn {state, agent, title} ->
    label_name = routing_label.(agent) |> String.downcase()
    label_id = Map.get(label_id_by_name, label_name)
    option_id = Map.get(state_options, state)

    cond do
      is_nil(label_id) ->
        IO.puts(:stderr, "Label #{label_name} not found on #{repo} — create it on GitHub first")
        System.halt(1)

      is_nil(option_id) ->
        IO.puts(:stderr, "Unknown state #{inspect(state)} — not in project metadata")

      true ->
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
                 "labelIds" => [label_id]
               }) do
          IO.puts("Created #{repo}##{issue["number"]} [#{state}] [#{label_name}] #{title}")
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
