defmodule SymphonyElixir.Assistant.ToolExecutor do
  @moduledoc """
  Server-side tool boundary for the tracker project assistant.
  """

  alias SymphonyElixir.AgentExecution
  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Tracker.IssueAdapter
  alias SymphonyElixirWeb.TrackerPresenter

  @supported_tools ~w(list_issues create_issue create_draft_issue update_issue move_issue add_comment get_agent_executions dispatch_codex)
  @issue_bound_mutable_tools ~w(update_issue move_issue add_comment dispatch_codex)
  @issue_bound_supported_tools ~w(list_issues update_issue move_issue add_comment get_agent_executions dispatch_codex)
  @in_progress_state "In Progress"

  @type result :: %{
          required(:tool) => String.t(),
          required(:message) => String.t(),
          required(:data) => map()
        }

  @spec supported_tools() :: [String.t()]
  def supported_tools, do: @supported_tools

  @spec tool_specs() :: [map()]
  def tool_specs do
    [
      tool_spec("list_issues", "List tracker issues in the current project.", %{
        "type" => "object",
        "additionalProperties" => false,
        "properties" => %{
          "search" => string_schema("Optional full-text search query."),
          "assignee" => string_schema("Optional assignee filter."),
          "creator" => string_schema("Optional creator filter.")
        }
      }),
      tool_spec("create_issue", "Create a tracker issue in the current project.", %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["title"],
        "properties" => %{
          "title" => string_schema("Issue title."),
          "description" => string_schema("Optional issue description."),
          "status" => string_schema("Optional workflow status. Defaults to Todo."),
          "priority" => %{"type" => ["integer", "null"], "description" => "Optional numeric priority."}
        }
      }),
      tool_spec("create_draft_issue", "Create a draft tracker issue (non-actionable status) to anchor the authoring chat.", %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["title"],
        "properties" => %{
          "title" => string_schema("Issue title."),
          "description" => string_schema("Optional short description.")
        }
      }),
      tool_spec("update_issue", "Update mutable fields on an existing tracker issue.", %{
        "type" => "object",
        "additionalProperties" => true,
        "required" => ["identifier"],
        "properties" => %{
          "identifier" => string_schema("Issue identifier, for example MAC-1."),
          "title" => string_schema("Optional new title."),
          "description" => string_schema("Optional new description."),
          "status" => string_schema("Optional workflow status.")
        }
      }),
      tool_spec("move_issue", "Move an issue to a workflow status.", %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["identifier", "status"],
        "properties" => %{
          "identifier" => string_schema("Issue identifier, for example MAC-1."),
          "status" => string_schema("Target workflow status.")
        }
      }),
      tool_spec("add_comment", "Add a comment to a tracker issue.", %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["identifier", "body"],
        "properties" => %{
          "identifier" => string_schema("Issue identifier, for example MAC-1."),
          "body" => string_schema("Comment body."),
          "author" => string_schema("Optional comment author. Defaults to assistant.")
        }
      }),
      tool_spec("get_agent_executions", "List active or retrying coding-agent executions for this project.", %{
        "type" => "object",
        "additionalProperties" => false,
        "properties" => %{}
      }),
      tool_spec("dispatch_codex", "Request Codex coding work through the existing issue workflow.", %{
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["identifier", "instructions"],
        "properties" => %{
          "identifier" => string_schema("Issue identifier to dispatch, for example MAC-1."),
          "instructions" => string_schema("Concrete coding instructions for Codex.")
        }
      })
    ]
  end

  @spec issue_bound_tool_specs(String.t()) :: [map()]
  def issue_bound_tool_specs(issue_identifier) when is_binary(issue_identifier) do
    identifier = normalize_issue_identifier!(issue_identifier)

    tool_specs()
    |> Enum.filter(&(Map.get(&1, "name") in @issue_bound_supported_tools))
    |> Enum.map(&bind_tool_spec_identifier(&1, identifier))
  end

  @spec codex_tool_executor(String.t(), keyword()) :: (String.t() | nil, term() -> map())
  def codex_tool_executor(project_slug, opts \\ []) when is_binary(project_slug) and is_list(opts) do
    fn tool, arguments -> execute_for_codex(project_slug, tool, arguments, opts) end
  end

  @spec issue_bound_codex_tool_executor(String.t(), String.t(), keyword()) :: (String.t() | nil, term() -> map())
  def issue_bound_codex_tool_executor(project_slug, issue_identifier, opts \\ [])
      when is_binary(project_slug) and is_binary(issue_identifier) and is_list(opts) do
    identifier = normalize_issue_identifier!(issue_identifier)

    fn tool, arguments ->
      tool_name = to_string(tool)
      arguments = if is_map(arguments), do: stringify_keys(arguments), else: %{}

      case bind_issue_tool_arguments(tool_name, arguments, identifier) do
        {:ok, bound_arguments} -> execute_for_codex(project_slug, tool_name, bound_arguments, opts)
        {:error, reason} -> codex_failure_response(reason)
      end
    end
  end

  @spec execute_for_codex(String.t(), String.t() | nil, term(), keyword()) :: map()
  def execute_for_codex(project_slug, tool, arguments, opts \\ []) do
    arguments = if is_map(arguments), do: stringify_keys(arguments), else: %{}

    case execute(project_slug, to_string(tool), arguments, opts) do
      {:ok, result} -> codex_success_response(result)
      {:error, reason} -> codex_failure_response(reason)
    end
  end

  @spec execute(String.t(), String.t(), map()) :: {:ok, result()} | {:error, term()}
  def execute(project_slug, tool, arguments), do: execute(project_slug, tool, arguments, [])

  @spec execute(String.t(), String.t(), map(), keyword()) :: {:ok, result()} | {:error, term()}
  def execute(project_slug, tool, arguments, opts)
      when is_binary(project_slug) and is_binary(tool) and is_map(arguments) do
    with {:ok, project_slug} <- normalize_required_string(project_slug, :project_slug),
         {:ok, project} <- Context.get_project(project_slug) do
      do_execute(project, tool, arguments, opts)
    end
  end

  def execute(_project_slug, _tool, _arguments, _opts), do: {:error, :invalid_arguments}

  defp do_execute(project, "list_issues", arguments, _opts) do
    filters =
      []
      |> maybe_put_filter(:search, Map.get(arguments, "search"))
      |> maybe_put_filter(:assignee, Map.get(arguments, "assignee"))
      |> maybe_put_filter(:creator, Map.get(arguments, "creator"))

    with {:ok, issues} <- IssueAdapter.dispatch(project, :list_issues, [filters]) do
      presented = Enum.map(issues, &TrackerPresenter.issue/1)

      {:ok,
       %{
         tool: "list_issues",
         message: "Found #{length(presented)} issue(s).",
         data: %{issues: presented}
       }}
    end
  end

  defp do_execute(project, "create_issue", arguments, _opts) do
    with {:ok, title} <- normalize_required_string(Map.get(arguments, "title"), :title),
         attrs <- build_create_attrs(arguments, title),
         {:ok, issue} <- IssueAdapter.dispatch(project, :create_issue, [attrs]) do
      presented = TrackerPresenter.issue(issue)

      {:ok,
       %{
         tool: "create_issue",
         message: "Created issue #{presented.identifier}: #{presented.title}",
         data: presented
       }}
    end
  end

  defp do_execute(project, "create_draft_issue", arguments, _opts) do
    with {:ok, title} <- normalize_required_string(Map.get(arguments, "title"), :title),
         attrs <- build_draft_attrs(arguments, title),
         {:ok, issue} <- IssueAdapter.dispatch(project, :create_issue, [attrs]) do
      presented = TrackerPresenter.issue(issue)

      {:ok,
       %{
         tool: "create_draft_issue",
         message: "Created draft #{presented.identifier}: #{presented.title}",
         data: presented
       }}
    end
  end

  defp do_execute(project, "update_issue", arguments, _opts) do
    with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
         attrs <- Map.drop(arguments, ["identifier"]),
         {:ok, issue} <- IssueAdapter.dispatch(project, :update_issue, [identifier, attrs]) do
      presented = TrackerPresenter.issue(issue)

      {:ok,
       %{
         tool: "update_issue",
         message: "Updated issue #{presented.identifier}.",
         data: presented
       }}
    end
  end

  defp do_execute(project, "move_issue", arguments, _opts) do
    with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
         {:ok, status} <- normalize_required_string(Map.get(arguments, "status"), :status),
         {:ok, issue} <- IssueAdapter.dispatch(project, :move_issue, [identifier, %{"status" => status}]) do
      presented = TrackerPresenter.issue(issue)

      {:ok,
       %{
         tool: "move_issue",
         message: "Moved issue #{presented.identifier} to #{status}.",
         data: presented
       }}
    end
  end

  defp do_execute(project, "add_comment", arguments, _opts) do
    with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
         {:ok, body} <- normalize_required_string(Map.get(arguments, "body"), :body),
         {:ok, comment} <- IssueAdapter.dispatch(project, :add_comment, [identifier, body, comment_attrs(arguments)]) do
      presented = TrackerPresenter.comment(comment)

      {:ok,
       %{
         tool: "add_comment",
         message: "Added comment to #{identifier}.",
         data: %{comment: presented}
       }}
    end
  end

  defp do_execute(project, "get_agent_executions", _arguments, opts) do
    with {:ok, issues} <- IssueAdapter.dispatch(project, :list_issues, [[]]) do
      issue_ids = issues |> Enum.map(&to_string(&1.id)) |> MapSet.new()
      issue_identifiers = issues |> Enum.map(& &1.identifier) |> MapSet.new()
      list_agent_executions = Keyword.get(opts, :agent_execution_list, &AgentExecution.list/0)

      executions =
        list_agent_executions.()
        |> Enum.filter(&project_execution?(&1, issue_ids, issue_identifiers))
        |> Enum.map(&TrackerPresenter.agent_execution/1)

      {:ok,
       %{
         tool: "get_agent_executions",
         message: "Found #{length(executions)} agent execution(s).",
         data: %{agent_executions: executions}
       }}
    end
  end

  defp do_execute(project, "dispatch_codex", arguments, _opts) do
    with {:ok, identifier} <- normalize_required_string(Map.get(arguments, "identifier"), :identifier),
         {:ok, instructions} <- normalize_required_string(Map.get(arguments, "instructions"), :instructions),
         :ok <- ensure_status_available(project, @in_progress_state),
         {:ok, _comment} <- IssueAdapter.dispatch(project, :add_comment, [identifier, codex_comment(instructions), %{"author" => "assistant"}]),
         {:ok, issue} <- IssueAdapter.dispatch(project, :move_issue, [identifier, %{"status" => @in_progress_state}]) do
      presented = TrackerPresenter.issue(issue)

      {:ok,
       %{
         tool: "dispatch_codex",
         message: "Requested Codex work on #{presented.identifier}",
         data: presented
       }}
    end
  end

  defp do_execute(_project, tool, _arguments, _opts), do: {:error, {:unsupported_tool, tool}}

  defp bind_tool_spec_identifier(%{"name" => tool_name, "inputSchema" => schema} = spec, identifier)
       when tool_name in @issue_bound_mutable_tools do
    identifier_schema = %{
      "type" => "string",
      "const" => identifier,
      "description" => "Bound issue identifier. Must be #{identifier}."
    }

    schema =
      update_in(schema, ["properties"], fn properties ->
        Map.put(properties || %{}, "identifier", identifier_schema)
      end)

    %{spec | "inputSchema" => schema}
  end

  defp bind_tool_spec_identifier(spec, _identifier), do: spec

  defp bind_issue_tool_arguments(tool_name, _arguments, _identifier) when tool_name not in @issue_bound_supported_tools do
    {:error, {:unsupported_issue_bound_tool, tool_name}}
  end

  defp bind_issue_tool_arguments(tool_name, arguments, identifier) when tool_name in @issue_bound_mutable_tools do
    case normalize_optional_string(Map.get(arguments, "identifier")) do
      nil ->
        {:ok, Map.put(arguments, "identifier", identifier)}

      ^identifier ->
        {:ok, Map.put(arguments, "identifier", identifier)}

      actual ->
        {:error, {:issue_identifier_mismatch, identifier, actual}}
    end
  end

  defp bind_issue_tool_arguments(_tool_name, arguments, _identifier), do: {:ok, arguments}

  defp tool_spec(name, description, input_schema) do
    %{"name" => name, "description" => description, "inputSchema" => input_schema}
  end

  defp string_schema(description), do: %{"type" => ["string", "null"], "description" => description}

  defp codex_success_response(result) do
    payload = stringify_keys(%{tool: result.tool, message: result.message, data: result.data})

    %{
      "success" => true,
      "contentItems" => [%{"type" => "inputText", "text" => encode_payload(payload)}],
      "toolResult" => payload
    }
  end

  defp codex_failure_response({:unsupported_tool, tool}) do
    codex_failure_response("Unsupported assistant tool: #{tool}.")
  end

  defp codex_failure_response({:missing_required_field, field}) do
    codex_failure_response("Missing required field: #{field}.")
  end

  defp codex_failure_response(reason) do
    payload = %{"error" => %{"message" => "Assistant tool execution failed.", "reason" => inspect(reason)}}

    if is_binary(reason) do
      failure_response(%{"error" => %{"message" => reason}})
    else
      failure_response(payload)
    end
  end

  defp failure_response(payload) do
    %{
      "success" => false,
      "contentItems" => [%{"type" => "inputText", "text" => encode_payload(payload)}]
    }
  end

  defp encode_payload(payload), do: Jason.encode!(payload, pretty: true)

  defp stringify_keys(value) when is_map(value) do
    Map.new(value, fn {key, nested_value} -> {to_string(key), stringify_keys(nested_value)} end)
  end

  defp stringify_keys(value) when is_list(value), do: Enum.map(value, &stringify_keys/1)
  defp stringify_keys(value), do: value

  defp project_execution?(execution, issue_ids, issue_identifiers) do
    case Map.get(execution, :issue_id) do
      issue_id when is_binary(issue_id) -> MapSet.member?(issue_ids, issue_id)
      issue_id when not is_nil(issue_id) -> MapSet.member?(issue_ids, to_string(issue_id))
      nil -> MapSet.member?(issue_identifiers, Map.get(execution, :issue_identifier))
    end
  end

  defp ensure_status_available(project, status_name) do
    with {:ok, statuses} <- IssueAdapter.dispatch(project, :list_statuses, []) do
      if Enum.any?(statuses, &(Map.get(&1, :name) == status_name or Map.get(&1, "name") == status_name)) do
        :ok
      else
        {:error, :status_not_found}
      end
    end
  end

  defp build_create_attrs(arguments, title) do
    %{
      "title" => title,
      "description" => Map.get(arguments, "description"),
      "status" => normalize_optional_string(Map.get(arguments, "status")) || "Todo"
    }
    |> maybe_put_attr("priority", Map.get(arguments, "priority"))
    |> maybe_put_attr("agent", normalize_optional_string(Map.get(arguments, "agent")))
    |> maybe_put_attr("label_ids", normalize_string_list(Map.get(arguments, "label_ids")))
    |> maybe_put_attr("assignee_ids", normalize_string_list(Map.get(arguments, "assignee_ids")))
  end

  defp build_draft_attrs(arguments, title) do
    %{
      "title" => title,
      "description" => normalize_optional_string(Map.get(arguments, "description")),
      "status" => Config.assistant_draft_status()
    }
  end

  defp comment_attrs(arguments) do
    %{}
    |> maybe_put_attr("author", normalize_optional_string(Map.get(arguments, "author")) || "assistant")
    |> maybe_put_attr("kind", normalize_optional_string(Map.get(arguments, "kind")) || "comment")
  end

  defp codex_comment(instructions) do
    "## Codex work requested from tracker assistant\n\n" <> instructions
  end

  defp normalize_required_string(value, field) when is_binary(value) do
    case String.trim(value) do
      "" -> {:error, {:missing_required_field, field}}
      trimmed -> {:ok, trimmed}
    end
  end

  defp normalize_required_string(_value, field), do: {:error, {:missing_required_field, field}}

  defp normalize_issue_identifier!(issue_identifier) do
    case normalize_required_string(issue_identifier, :issue_identifier) do
      {:ok, identifier} -> identifier
      {:error, reason} -> raise ArgumentError, "invalid issue identifier: #{inspect(reason)}"
    end
  end

  defp normalize_optional_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_optional_string(_value), do: nil

  defp normalize_string_list(value) when is_list(value) do
    value
    |> Enum.filter(&is_binary/1)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  defp normalize_string_list(_value), do: []

  defp maybe_put_filter(filters, _key, nil), do: filters
  defp maybe_put_filter(filters, _key, ""), do: filters
  defp maybe_put_filter(filters, key, value) when is_binary(value), do: Keyword.put(filters, key, String.trim(value))
  defp maybe_put_filter(filters, _key, _value), do: filters

  defp maybe_put_attr(attrs, _key, nil), do: attrs
  defp maybe_put_attr(attrs, _key, []), do: attrs
  defp maybe_put_attr(attrs, key, value), do: Map.put(attrs, key, value)
end
