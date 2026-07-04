defmodule SymphonyElixir.ContextResolvers do
  @moduledoc "Builds markdown snapshots for contexts attached to composer scopes."

  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueAdapter

  @comment_limit 20

  @type resolved_context :: %{
          required(:title) => String.t(),
          required(:content_md) => String.t(),
          optional(:metadata) => map()
        }

  @spec resolve(Project.t(), String.t(), String.t(), map()) ::
          {:ok, resolved_context()} | {:error, term()}
  def resolve(%Project{} = project, "board_issue", ref_key, _metadata) when is_binary(ref_key) do
    with {:ok, issue} <- IssueAdapter.dispatch(project, :get_issue, [ref_key]),
         {:ok, comments} <- IssueAdapter.dispatch(project, :list_comments, [issue.identifier]) do
      {:ok,
       %{
         title: "#{issue.identifier} #{issue.title}",
         content_md: board_issue_markdown(issue, comments),
         metadata: %{"identifier" => issue.identifier}
       }}
    end
  end

  def resolve(%Project{}, kind, _ref_key, _metadata) when is_binary(kind) do
    {:error, {:unsupported_kind, kind}}
  end

  defp board_issue_markdown(issue, comments) do
    [
      "### Board issue #{issue.identifier}",
      "",
      "- Title: #{issue.title}",
      "- Status: #{status_name(issue.status)}",
      optional_line("- Priority: ", issue.priority),
      optional_line("- Assignee: ", issue.assignee),
      optional_line("- Creator: ", issue.creator),
      "",
      "#### Description",
      "",
      blank_to_placeholder(issue.description),
      "",
      "#### Recent comments",
      "",
      comments_markdown(comments)
    ]
    |> Enum.reject(&is_nil/1)
    |> Enum.join("\n")
  end

  defp comments_markdown([]), do: "_No comments._"

  defp comments_markdown(comments) do
    comments
    |> Enum.take(@comment_limit)
    |> Enum.map_join("\n\n", fn comment ->
      author = Map.get(comment, :author) || Map.get(comment, "author") || "unknown"
      body = Map.get(comment, :body) || Map.get(comment, "body") || ""

      "- **#{author}**: #{String.trim(body)}"
    end)
  end

  defp status_name(%{name: name}) when is_binary(name), do: name
  defp status_name(%{"name" => name}) when is_binary(name), do: name
  defp status_name(name) when is_binary(name), do: name
  defp status_name(_status), do: "Unknown"

  defp optional_line(_prefix, nil), do: nil
  defp optional_line(_prefix, ""), do: nil
  defp optional_line(prefix, value), do: prefix <> to_string(value)

  defp blank_to_placeholder(value) when is_binary(value) do
    case String.trim(value) do
      "" -> "_No description._"
      trimmed -> trimmed
    end
  end

  defp blank_to_placeholder(_value), do: "_No description._"
end
