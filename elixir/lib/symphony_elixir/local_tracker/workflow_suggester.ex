defmodule SymphonyElixir.LocalTracker.WorkflowSuggester do
  @moduledoc "Deterministic setup suggestions for workspace project creation."

  @workflow_statuses [
    %{name: "Backlog", category: "backlog", position: 0, is_terminal: false},
    %{name: "Todo", category: "active", position: 1, is_terminal: false},
    %{name: "In Progress", category: "active", position: 2, is_terminal: false},
    %{name: "Human Review", category: "wait", position: 3, is_terminal: false},
    %{name: "Rework", category: "active", position: 4, is_terminal: false},
    %{name: "Merging", category: "active", position: 5, is_terminal: false},
    %{name: "Done", category: "terminal", position: 6, is_terminal: true},
    %{name: "Cancelled", category: "terminal", position: 7, is_terminal: true},
    %{name: "Duplicate", category: "terminal", position: 8, is_terminal: true}
  ]

  @workflow_front_matter %{
    "tracker" => %{
      "field_states" => ["Backlog", "Todo", "In Progress", "Human Review", "Rework", "Merging", "Done", "Cancelled", "Duplicate"],
      "active_states" => ["Todo", "In Progress", "Rework", "Merging"],
      "wait_states" => ["Human Review"],
      "terminal_states" => ["Done", "Cancelled", "Duplicate"]
    }
  }

  @spec suggest(map()) :: {:ok, map()} | {:error, term()}
  def suggest(attrs) when is_map(attrs) do
    repositories = attr(attrs, :repositories, [])
    scans = attr(attrs, :scans, [])
    validation_commands = scans |> Enum.flat_map(&scan_validation_commands/1) |> Enum.uniq()

    {:ok,
     %{
       workflow_statuses: @workflow_statuses,
       workflow_markdown: workflow_markdown(repositories),
       validation_commands: validation_commands,
       after_create_hook: after_create_hook(repositories),
       scan_summary: scan_summary(repositories, scans)
     }}
  end

  defp workflow_markdown(repositories) do
    SymphonyElixir.Workflow.to_markdown(@workflow_front_matter, prompt_template(repositories))
  end

  defp after_create_hook(repositories) do
    Enum.map_join(repositories, "\n", fn repository ->
      clone_url = attr(repository, :clone_url)
      branch = attr(repository, :selected_branch) || attr(repository, :default_branch) || "main"
      workspace_path = attr(repository, :workspace_path)

      "git clone --branch #{branch} #{clone_url} #{workspace_path}"
    end)
  end

  defp prompt_template(repositories) do
    repo_lines =
      Enum.map_join(repositories, "\n", fn repository ->
        role = attr(repository, :role)
        full_name = attr(repository, :github_full_name)
        workspace_path = attr(repository, :workspace_path)
        "- #{role}: #{full_name} at `#{workspace_path}/`"
      end)

    "You are working in a multi-repository Symphony workspace.\n\nRepositories:\n#{repo_lines}"
  end

  defp scan_summary(repositories, scans) do
    %{
      repository_count: length(repositories),
      stacks: scans |> Enum.flat_map(&Map.get(&1, :stack, [])) |> Enum.uniq()
    }
  end

  defp scan_validation_commands(scan) when is_map(scan) do
    Map.get(scan, :validation_commands, Map.get(scan, "validation_commands", []))
  end

  defp attr(attrs, key, default \\ nil), do: Map.get(attrs, key, Map.get(attrs, Atom.to_string(key), default))
end
