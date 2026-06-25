defmodule SymphonyElixir.Assistant.PullRequestTools do
  @moduledoc false

  alias SymphonyElixir.Assistant.HandoffTools
  alias SymphonyElixir.GitHub.PullRequestUrl
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.Sync.LocalStore

  @tool "link_pull_request"

  @description """
  Link a GitHub pull request URL to a tracker issue (origin "manual").
  Use after opening a PR so the issue shows the association on the board and the publish gate can see it.
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    tool_spec(@description, %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["identifier", "url"],
      "properties" => %{
        "identifier" => %{"type" => "string", "description" => "Issue identifier, for example MAC-1."},
        "url" => %{"type" => "string", "description" => "GitHub pull request URL."}
      }
    })
  end

  @spec issue_bound_tool_spec() :: map()
  def issue_bound_tool_spec do
    tool_spec(@description, %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["url"],
      "properties" => %{
        "url" => %{"type" => "string", "description" => "GitHub pull request URL."}
      }
    })
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec(), issue_bound_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    link_fun = Keyword.get(opts, :link_pull_request, &LocalStore.link_manual_pull_request/3)

    with {:ok, issue} <- HandoffTools.resolve_issue(project_slug, arguments, opts),
         {:ok, url} <- required_url(arguments),
         {:ok, parsed} <- PullRequestUrl.parse(url),
         {:ok, project} <- Context.get_project(project_slug),
         {:ok, record} <-
           link_fun.(project.id, issue.identifier, %{url: url, repo: parsed.repo, number: parsed.number}) do
      {:ok,
       %{
         tool: @tool,
         message: "Linked #{parsed.repo}##{parsed.number} to #{issue.identifier}.",
         data: %{pull_request: present(record)}
       }}
    end
  end

  defp present(record) do
    %{
      url: record.url,
      repo: record.repo,
      number: record.number,
      state: record.state,
      origin: record.origin
    }
  end

  defp required_url(arguments) do
    case Map.get(arguments, "url") do
      url when is_binary(url) ->
        case String.trim(url) do
          "" -> {:error, :missing_url}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, :missing_url}
    end
  end

  defp tool_spec(description, input_schema) do
    %{"name" => @tool, "description" => String.trim(description), "inputSchema" => input_schema}
  end
end
