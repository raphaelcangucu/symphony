defmodule SymphonyElixir.Assistant.PreviewTools do
  @moduledoc false

  alias SymphonyElixir.Assistant.HandoffTools
  alias SymphonyElixir.DevServer
  alias SymphonyElixir.DevServer.Manager
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.DevEnv

  @tool "manage_preview"

  @description """
  Inspect or control the issue dev-server preview (status, start, stop, restart).
  When preview is unavailable, read `next_steps` and configure serve steps via manage_dev_env first.
  """

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    tool_spec(@description, %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["identifier", "action"],
      "properties" => %{
        "identifier" => %{
          "type" => "string",
          "description" => "Issue identifier, for example MAC-1."
        },
        "action" => preview_action_schema()
      }
    })
  end

  @spec issue_bound_tool_spec() :: map()
  def issue_bound_tool_spec do
    tool_spec(@description, %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["action"],
      "properties" => %{
        "action" => preview_action_schema()
      }
    })
  end

  @spec tool_specs() :: [map()]
  def tool_specs, do: [assistant_tool_spec(), issue_bound_tool_spec()]

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, arguments, opts \\ [])

  def execute(project_slug, arguments, opts) when is_binary(project_slug) and is_map(arguments) do
    issue_targets = Keyword.get(opts, :issue_targets, &DevServer.issue_targets/2)
    list_serve_steps = Keyword.get(opts, :list_serve_steps, &DevEnv.list_serve_steps/1)

    with {:ok, identifier} <- resolve_identifier(project_slug, arguments, opts),
         {:ok, action} <- normalize_preview_action(Map.get(arguments, "action")) do
      execute_action(project_slug, identifier, action, issue_targets, list_serve_steps, opts)
    end
  end

  defp execute_action(project_slug, identifier, :status, issue_targets, list_serve_steps, _opts) do
    with {:ok, view} <- issue_targets.(project_slug, identifier) do
      {:ok,
       %{
         tool: @tool,
         message: "Preview status for #{identifier}.",
         data: enrich_view(project_slug, view, list_serve_steps)
       }}
    end
  end

  defp execute_action(project_slug, identifier, :start, issue_targets, list_serve_steps, opts) do
    start_for_issue = Keyword.get(opts, :start_for_issue, &Manager.start_for_issue/2)

    case start_for_issue.(project_slug, identifier) do
      {:ok, _} ->
        {:ok, action_result("Started preview for #{identifier}.", project_slug, identifier, issue_targets, list_serve_steps)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp execute_action(project_slug, identifier, :stop, issue_targets, list_serve_steps, opts) do
    stop_for_issue = Keyword.get(opts, :stop_for_issue, &Manager.stop_for_issue/2)
    :ok = stop_for_issue.(project_slug, identifier)

    {:ok, action_result("Stopped preview for #{identifier}.", project_slug, identifier, issue_targets, list_serve_steps)}
  end

  defp execute_action(project_slug, identifier, :restart, issue_targets, list_serve_steps, opts) do
    restart_for_issue = Keyword.get(opts, :restart_for_issue, &Manager.restart_for_issue/2)

    case restart_for_issue.(project_slug, identifier) do
      {:ok, _} ->
        {:ok, action_result("Restarted preview for #{identifier}.", project_slug, identifier, issue_targets, list_serve_steps)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp action_result(message, project_slug, identifier, issue_targets, list_serve_steps) do
    {:ok, view} = issue_targets.(project_slug, identifier)

    %{
      tool: @tool,
      message: message,
      data: enrich_view(project_slug, view, list_serve_steps)
    }
  end

  @spec enrich_view(String.t(), map(), (String.t() -> list())) :: map()
  def enrich_view(project_slug, view, list_serve_steps \\ &DevEnv.list_serve_steps/1) when is_map(view) do
    serve_steps_configured = list_serve_steps.(project_slug) != []
    reason = Map.get(view, :reason)

    view
    |> Map.put(:serve_steps_configured, serve_steps_configured)
    |> Map.put(:reason, present_reason(reason))
    |> Map.put(:next_steps, next_steps_hint(reason, serve_steps_configured))
  end

  defp present_reason(nil), do: nil
  defp present_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp present_reason(reason) when is_binary(reason), do: reason

  defp next_steps_hint(:no_serve_step, false),
    do: "Run manage_dev_env with action propose_steps, save serve-category steps, then manage_preview start."

  defp next_steps_hint(:workspace_missing, _configured),
    do: "Create or open the issue workspace before starting preview."

  defp next_steps_hint(:disabled, _configured),
    do: "Enable dev_server in the project workflow markdown, then configure serve steps."

  defp next_steps_hint(_reason, _configured), do: nil

  defp resolve_identifier(project_slug, arguments, opts) do
    case Keyword.get(opts, :issue) do
      %Issue{identifier: identifier} when is_binary(identifier) ->
        {:ok, identifier}

      _ ->
        with {:ok, %Issue{identifier: identifier}} <- HandoffTools.resolve_issue(project_slug, arguments, []) do
          {:ok, identifier}
        end
    end
  end

  defp normalize_preview_action(action) when is_binary(action) do
    case String.trim(action) |> String.downcase() do
      "status" -> {:ok, :status}
      "start" -> {:ok, :start}
      "stop" -> {:ok, :stop}
      "restart" -> {:ok, :restart}
      other -> {:error, {:invalid_preview_action, other}}
    end
  end

  defp normalize_preview_action(action), do: {:error, {:invalid_preview_action, action}}

  defp preview_action_schema do
    %{
      "type" => "string",
      "enum" => ["status", "start", "stop", "restart"],
      "description" => "Preview action."
    }
  end

  defp tool_spec(description, input_schema) do
    %{"name" => @tool, "description" => String.trim(description), "inputSchema" => input_schema}
  end
end
