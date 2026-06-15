defmodule SymphonyElixir.Codex.DynamicTool do
  @moduledoc """
  Executes client-side tool calls requested by Codex app-server turns.
  """

  alias SymphonyElixir.GitHub.Client, as: GitHubClient
  alias SymphonyElixir.Issue
  alias SymphonyElixir.Linear.Client, as: LinearClient
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter

  @linear_graphql_tool "linear_graphql"
  @github_graphql_tool "github_graphql"
  @set_issue_status_tool "set_issue_status"
  @add_comment_tool "add_comment"
  @list_comments_tool "list_comments"
  @update_comment_tool "update_comment"

  @graphql_input_schema %{
    "type" => "object",
    "additionalProperties" => false,
    "required" => ["query"],
    "properties" => %{
      "query" => %{
        "type" => "string",
        "description" => "GraphQL query or mutation document to execute."
      },
      "variables" => %{
        "type" => ["object", "null"],
        "description" => "Optional GraphQL variables object.",
        "additionalProperties" => true
      }
    }
  }

  @linear_graphql_description """
  Execute a raw GraphQL query or mutation against Linear using Symphony's configured auth.
  """

  @github_graphql_description """
  Execute a raw GraphQL query or mutation against GitHub using Symphony's configured GITHUB_TOKEN.
  """

  @set_issue_status_input_schema %{
    "type" => "object",
    "additionalProperties" => false,
    "required" => ["status"],
    "properties" => %{
      "status" => %{
        "type" => "string",
        "description" => "Target workflow status for the issue you are working on (for example \"In Progress\" or \"Human Review\"). Must match a status configured on this project's board."
      }
    }
  }

  @set_issue_status_description """
  Move the issue you are currently working on to a workflow status on Symphony's local-first board.

  The change is written to Symphony's local tracker immediately and synced to GitHub/Linear in the background, so it never blocks on their API rate limits. Use this to follow the workflow instructions, e.g. move from "Todo" to "In Progress" when you start work, or to "Human Review" when a PR is ready.
  """

  @add_comment_input_schema %{
    "type" => "object",
    "additionalProperties" => false,
    "required" => ["body"],
    "properties" => %{
      "body" => %{
        "type" => "string",
        "description" => "Comment body (markdown). For the Symphony workpad, the body must start with \"## Codex Workpad\"."
      }
    }
  }

  @list_comments_input_schema %{
    "type" => "object",
    "additionalProperties" => false,
    "properties" => %{}
  }

  @update_comment_input_schema %{
    "type" => "object",
    "additionalProperties" => false,
    "required" => ["comment_id", "body"],
    "properties" => %{
      "comment_id" => %{
        "type" => ["string", "integer"],
        "description" => "Id of the comment to edit, as returned by `list_comments` / `add_comment`."
      },
      "body" => %{
        "type" => "string",
        "description" => "Replacement comment body (markdown)."
      }
    }
  }

  @add_comment_description """
  Add a comment to the issue you are currently working on, on Symphony's local-first board.

  The comment is written to Symphony's local tracker immediately and synced to the project's tracker (Jira/Linear/GitHub) in the background, so it never blocks on their API rate limits. Use this — NOT `linear_graphql` — to create the `## Codex Workpad` comment, regardless of which tracker backs the project. The response includes the new comment `id`; keep it to edit the workpad in place later with `update_comment`.
  """

  @list_comments_description """
  List the existing comments on the issue you are currently working on (Symphony's local-first board).

  Use this to find the `id` of an existing `## Codex Workpad` comment before editing it in place with `update_comment`, so you never post a duplicate workpad.
  """

  @update_comment_description """
  Edit an existing comment (by `id`) on the issue you are currently working on, on Symphony's local-first board.

  The edit is written locally immediately and synced to the project's tracker in the background. Use this to keep a single `## Codex Workpad` comment updated in place instead of posting duplicates.
  """

  @spec execute(String.t() | nil, term(), keyword()) :: map()
  def execute(tool, arguments, opts \\ []) do
    case tool do
      @linear_graphql_tool ->
        execute_linear_graphql(arguments, opts)

      @github_graphql_tool ->
        execute_github_graphql(arguments, opts)

      @set_issue_status_tool ->
        execute_set_issue_status(arguments, opts)

      @add_comment_tool ->
        execute_add_comment(arguments, opts)

      @list_comments_tool ->
        execute_list_comments(opts)

      @update_comment_tool ->
        execute_update_comment(arguments, opts)

      other ->
        failure_response(%{
          "error" => %{
            "message" => "Unsupported dynamic tool: #{inspect(other)}.",
            "supportedTools" => supported_tool_names()
          }
        })
    end
  end

  @spec tool_specs() :: [map()]
  def tool_specs do
    [
      %{
        "name" => @linear_graphql_tool,
        "description" => @linear_graphql_description,
        "inputSchema" => @graphql_input_schema
      },
      %{
        "name" => @github_graphql_tool,
        "description" => @github_graphql_description,
        "inputSchema" => @graphql_input_schema
      }
    ]
  end

  @doc """
  Tools advertised to the autonomous coding agent. Extends `tool_specs/0` with
  issue-bound tools (such as `set_issue_status`) that require the agent's current
  issue context and therefore are not exposed to the project chat assistant.
  """
  @spec coding_agent_tool_specs() :: [map()]
  def coding_agent_tool_specs do
    tool_specs() ++
      [
        %{
          "name" => @set_issue_status_tool,
          "description" => @set_issue_status_description,
          "inputSchema" => @set_issue_status_input_schema
        },
        %{
          "name" => @add_comment_tool,
          "description" => @add_comment_description,
          "inputSchema" => @add_comment_input_schema
        },
        %{
          "name" => @list_comments_tool,
          "description" => @list_comments_description,
          "inputSchema" => @list_comments_input_schema
        },
        %{
          "name" => @update_comment_tool,
          "description" => @update_comment_description,
          "inputSchema" => @update_comment_input_schema
        }
      ]
  end

  defp execute_linear_graphql(arguments, opts) do
    linear_client = Keyword.get(opts, :linear_client, &LinearClient.graphql/3)

    with {:ok, query, variables} <- normalize_graphql_arguments(arguments),
         {:ok, response} <- linear_client.(query, variables, []) do
      graphql_response(response)
    else
      {:error, reason} ->
        failure_response(linear_tool_error_payload(reason))
    end
  end

  defp execute_github_graphql(arguments, opts) do
    github_client = Keyword.get(opts, :github_client, &GitHubClient.graphql/3)

    with {:ok, query, variables} <- normalize_graphql_arguments(arguments),
         {:ok, response} <- github_client.(query, variables, []) do
      graphql_response(response)
    else
      {:error, reason} ->
        failure_response(github_tool_error_payload(reason))
    end
  end

  defp execute_set_issue_status(arguments, opts) do
    with {:ok, issue} <- fetch_bound_issue(opts),
         {:ok, status} <- normalize_status(arguments),
         {:ok, project} <- Context.get_project(issue.project_slug),
         {:ok, _moved} <-
           IssueAdapter.dispatch(project, :move_issue, [issue.identifier, %{"status" => status}]) do
      set_issue_status_success(issue.identifier, status)
    else
      {:error, reason} -> failure_response(set_issue_status_error_payload(reason, opts))
    end
  end

  defp execute_add_comment(arguments, opts) do
    with {:ok, issue} <- fetch_bound_issue(opts),
         {:ok, body} <- normalize_comment_body(arguments),
         {:ok, project} <- Context.get_project(issue.project_slug),
         {:ok, comment} <-
           IssueAdapter.dispatch(project, :add_comment, [issue.identifier, body, %{"author" => "agent"}]) do
      comment_success(@add_comment_tool, issue.identifier, present_comment(comment))
    else
      {:error, reason} -> failure_response(comment_tool_error_payload(reason))
    end
  end

  defp execute_list_comments(opts) do
    with {:ok, issue} <- fetch_bound_issue(opts),
         {:ok, project} <- Context.get_project(issue.project_slug),
         {:ok, comments} <- IssueAdapter.dispatch(project, :list_comments, [issue.identifier]) do
      list_comments_success(issue.identifier, Enum.map(comments, &present_comment/1))
    else
      {:error, reason} -> failure_response(comment_tool_error_payload(reason))
    end
  end

  defp execute_update_comment(arguments, opts) do
    with {:ok, issue} <- fetch_bound_issue(opts),
         {:ok, comment_id} <- normalize_comment_id(arguments),
         {:ok, body} <- normalize_comment_body(arguments),
         {:ok, project} <- Context.get_project(issue.project_slug),
         {:ok, comment} <-
           IssueAdapter.dispatch(project, :update_comment, [issue.identifier, comment_id, body]) do
      comment_success(@update_comment_tool, issue.identifier, present_comment(comment))
    else
      {:error, reason} -> failure_response(comment_tool_error_payload(reason))
    end
  end

  defp fetch_bound_issue(opts) do
    case Keyword.get(opts, :issue) do
      %Issue{project_slug: slug, identifier: identifier} = issue
      when is_binary(slug) and is_binary(identifier) ->
        {:ok, issue}

      _ ->
        {:error, :no_bound_issue}
    end
  end

  defp normalize_comment_body(arguments) when is_map(arguments) do
    case Map.get(arguments, "body") || Map.get(arguments, :body) do
      body when is_binary(body) ->
        if String.trim(body) == "", do: {:error, :missing_body}, else: {:ok, body}

      _ ->
        {:error, :missing_body}
    end
  end

  defp normalize_comment_body(_arguments), do: {:error, :missing_body}

  defp normalize_comment_id(arguments) when is_map(arguments) do
    case Map.get(arguments, "comment_id") || Map.get(arguments, :comment_id) do
      id when is_integer(id) ->
        {:ok, id}

      id when is_binary(id) ->
        case String.trim(id) do
          "" -> {:error, :missing_comment_id}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, :missing_comment_id}
    end
  end

  defp normalize_comment_id(_arguments), do: {:error, :missing_comment_id}

  # Flatten a local `Comment` struct or a remote comment map into a JSON-safe map
  # (never encode an Ecto struct directly — its `__meta__` field breaks Jason).
  defp present_comment(comment) when is_map(comment) do
    %{
      "id" => Map.get(comment, :id),
      "remoteId" => Map.get(comment, :remote_id),
      "kind" => Map.get(comment, :kind),
      "author" => Map.get(comment, :author),
      "syncStatus" => Map.get(comment, :sync_status),
      "body" => Map.get(comment, :body)
    }
  end

  defp comment_success(tool, identifier, comment) do
    %{
      "success" => true,
      "contentItems" => [
        %{
          "type" => "inputText",
          "text" =>
            encode_payload(%{
              "status" => "ok",
              "tool" => tool,
              "identifier" => identifier,
              "comment" => comment
            })
        }
      ]
    }
  end

  defp list_comments_success(identifier, comments) do
    %{
      "success" => true,
      "contentItems" => [
        %{
          "type" => "inputText",
          "text" =>
            encode_payload(%{
              "status" => "ok",
              "tool" => @list_comments_tool,
              "identifier" => identifier,
              "comments" => comments
            })
        }
      ]
    }
  end

  defp normalize_status(arguments) when is_map(arguments) do
    case Map.get(arguments, "status") || Map.get(arguments, :status) do
      status when is_binary(status) ->
        case String.trim(status) do
          "" -> {:error, :missing_status}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, :missing_status}
    end
  end

  defp normalize_status(_arguments), do: {:error, :missing_status}

  defp set_issue_status_success(identifier, status) do
    %{
      "success" => true,
      "contentItems" => [
        %{
          "type" => "inputText",
          "text" =>
            encode_payload(%{
              "status" => "ok",
              "identifier" => identifier,
              "movedTo" => status
            })
        }
      ]
    }
  end

  defp normalize_graphql_arguments(arguments) when is_binary(arguments) do
    case String.trim(arguments) do
      "" -> {:error, :missing_query}
      query -> {:ok, query, %{}}
    end
  end

  defp normalize_graphql_arguments(arguments) when is_map(arguments) do
    case normalize_query(arguments) do
      {:ok, query} ->
        case normalize_variables(arguments) do
          {:ok, variables} -> {:ok, query, variables}
          {:error, reason} -> {:error, reason}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp normalize_graphql_arguments(_arguments), do: {:error, :invalid_arguments}

  defp normalize_query(arguments) do
    case Map.get(arguments, "query") || Map.get(arguments, :query) do
      query when is_binary(query) ->
        case String.trim(query) do
          "" -> {:error, :missing_query}
          trimmed -> {:ok, trimmed}
        end

      _ ->
        {:error, :missing_query}
    end
  end

  defp normalize_variables(arguments) do
    case Map.get(arguments, "variables") || Map.get(arguments, :variables) || %{} do
      variables when is_map(variables) -> {:ok, variables}
      _ -> {:error, :invalid_variables}
    end
  end

  defp graphql_response(response) do
    success =
      case response do
        %{"errors" => errors} when is_list(errors) and errors != [] -> false
        %{errors: errors} when is_list(errors) and errors != [] -> false
        _ -> true
      end

    %{
      "success" => success,
      "contentItems" => [
        %{
          "type" => "inputText",
          "text" => encode_payload(response)
        }
      ]
    }
  end

  defp failure_response(payload) do
    %{
      "success" => false,
      "contentItems" => [
        %{
          "type" => "inputText",
          "text" => encode_payload(payload)
        }
      ]
    }
  end

  defp encode_payload(payload) when is_map(payload) or is_list(payload) do
    Jason.encode!(payload, pretty: true)
  end

  defp encode_payload(payload), do: inspect(payload)

  defp linear_tool_error_payload(:missing_query) do
    %{
      "error" => %{
        "message" => "`linear_graphql` requires a non-empty `query` string."
      }
    }
  end

  defp linear_tool_error_payload(:invalid_arguments) do
    %{
      "error" => %{
        "message" => "`linear_graphql` expects either a GraphQL query string or an object with `query` and optional `variables`."
      }
    }
  end

  defp linear_tool_error_payload(:invalid_variables) do
    %{
      "error" => %{
        "message" => "`linear_graphql.variables` must be a JSON object when provided."
      }
    }
  end

  defp linear_tool_error_payload(:missing_linear_api_token) do
    %{
      "error" => %{
        "message" => "Symphony is missing Linear auth. Set `linear.api_key` in `WORKFLOW.md` or export `LINEAR_API_KEY`."
      }
    }
  end

  defp linear_tool_error_payload({:linear_api_status, status}) do
    %{
      "error" => %{
        "message" => "Linear GraphQL request failed with HTTP #{status}.",
        "status" => status
      }
    }
  end

  defp linear_tool_error_payload({:linear_api_request, reason}) do
    %{
      "error" => %{
        "message" => "Linear GraphQL request failed before receiving a successful response.",
        "reason" => inspect(reason)
      }
    }
  end

  defp linear_tool_error_payload(reason) do
    %{
      "error" => %{
        "message" => "Linear GraphQL tool execution failed.",
        "reason" => inspect(reason)
      }
    }
  end

  defp github_tool_error_payload(:missing_query) do
    %{
      "error" => %{
        "message" => "`github_graphql` requires a non-empty `query` string."
      }
    }
  end

  defp github_tool_error_payload(:invalid_arguments) do
    %{
      "error" => %{
        "message" => "`github_graphql` expects either a GraphQL query string or an object with `query` and optional `variables`."
      }
    }
  end

  defp github_tool_error_payload(:invalid_variables) do
    %{
      "error" => %{
        "message" => "`github_graphql.variables` must be a JSON object when provided."
      }
    }
  end

  defp github_tool_error_payload(:missing_github_token) do
    %{
      "error" => %{
        "message" => "Symphony is missing GitHub auth. Set GITHUB_TOKEN with repo and project scopes."
      }
    }
  end

  defp github_tool_error_payload({:github_api_status, status}) do
    %{
      "error" => %{
        "message" => "GitHub GraphQL request failed with HTTP #{status}.",
        "status" => status
      }
    }
  end

  defp github_tool_error_payload({:github_api_request, reason}) do
    %{
      "error" => %{
        "message" => "GitHub GraphQL request failed before receiving a successful response.",
        "reason" => inspect(reason)
      }
    }
  end

  defp github_tool_error_payload(reason) do
    %{
      "error" => %{
        "message" => "GitHub GraphQL tool execution failed.",
        "reason" => inspect(reason)
      }
    }
  end

  defp set_issue_status_error_payload(:no_bound_issue, _opts) do
    %{
      "error" => %{
        "message" => "`set_issue_status` can only move the issue you are currently working on, but no issue is bound to this session."
      }
    }
  end

  defp set_issue_status_error_payload(:missing_status, _opts) do
    %{
      "error" => %{
        "message" => "`set_issue_status` requires a non-empty `status` string."
      }
    }
  end

  defp set_issue_status_error_payload(:project_not_found, _opts) do
    %{
      "error" => %{
        "message" => "The project for the current issue could not be found in the local tracker."
      }
    }
  end

  defp set_issue_status_error_payload(reason, opts) do
    base = %{
      "message" => "Failed to move the issue to the requested status.",
      "reason" => inspect(reason)
    }

    error =
      case available_status_names(opts) do
        [] -> base
        names -> Map.put(base, "validStatuses", names)
      end

    %{"error" => error}
  end

  defp available_status_names(opts) do
    with %Issue{project_slug: slug} when is_binary(slug) <- Keyword.get(opts, :issue),
         {:ok, project} <- Context.get_project(slug),
         {:ok, statuses} <- IssueAdapter.dispatch(project, :list_statuses, []) do
      statuses
      |> Enum.map(&status_name/1)
      |> Enum.reject(&is_nil/1)
    else
      _ -> []
    end
  end

  defp status_name(status) when is_map(status) do
    Map.get(status, :name) || Map.get(status, "name")
  end

  defp status_name(_status), do: nil

  defp comment_tool_error_payload(:no_bound_issue) do
    %{
      "error" => %{
        "message" => "The comment tools can only act on the issue you are currently working on, but no issue is bound to this session."
      }
    }
  end

  defp comment_tool_error_payload(:missing_body) do
    %{"error" => %{"message" => "A non-empty `body` string is required."}}
  end

  defp comment_tool_error_payload(:missing_comment_id) do
    %{
      "error" => %{
        "message" => "`update_comment` requires a `comment_id`. Call `list_comments` first to find the existing workpad comment id."
      }
    }
  end

  defp comment_tool_error_payload(:project_not_found) do
    %{
      "error" => %{
        "message" => "The project for the current issue could not be found in the local tracker."
      }
    }
  end

  defp comment_tool_error_payload(:comment_not_found) do
    %{
      "error" => %{
        "message" => "No comment with that id exists on this issue. Call `list_comments` to find the current workpad comment id."
      }
    }
  end

  defp comment_tool_error_payload(:not_supported_on_remote) do
    %{
      "error" => %{
        "message" => "This project's tracker does not support comment writes through Symphony."
      }
    }
  end

  defp comment_tool_error_payload(reason) do
    %{
      "error" => %{
        "message" => "Tracker comment tool execution failed.",
        "reason" => inspect(reason)
      }
    }
  end

  defp supported_tool_names do
    Enum.map(coding_agent_tool_specs(), & &1["name"])
  end
end
