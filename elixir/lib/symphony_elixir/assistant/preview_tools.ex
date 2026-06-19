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

  # `start`/`restart` only wait this long for the dev server to report `ready`
  # before returning. The instance keeps booting asynchronously regardless, so a
  # slow or crashing preview can never block the agent turn for minutes — the
  # tool returns promptly with the in-flight status and non-blocking guidance.
  @start_ready_timeout_ms 30_000

  # Runtime/transient start failures we convert into a structured, non-blocking
  # result (instead of a bare error) so the agent keeps making progress. Config
  # errors (:disabled, :workspace_missing, :no_serve_step) still surface as
  # errors so their setup hints reach the caller unchanged.
  @recoverable_start_errors [:crashed, :no_free_port, :lock_unavailable]

  @starting_next_steps "Poll `manage_preview` with `status` until servers report `ready`. Meanwhile keep writing tests and run the unit suite — do not block on the preview or retry it in a tight loop."
  @not_ready_next_steps "Preview is not ready. Do not block the run: write/run tests, record the blocker in your `## Codex Workpad`, then retry `manage_preview` `restart`/`status` later or proceed without UI e2e."
  @lock_next_steps "A preview start is already in progress for this issue. Poll `manage_preview status` shortly and keep working meanwhile — do not block."

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
    start_for_issue = Keyword.get(opts, :start_for_issue, &Manager.start_for_issue/3)
    run_preview_start("Started", start_for_issue, project_slug, identifier, issue_targets, list_serve_steps)
  end

  defp execute_action(project_slug, identifier, :stop, issue_targets, list_serve_steps, opts) do
    stop_for_issue = Keyword.get(opts, :stop_for_issue, &Manager.stop_for_issue/2)
    :ok = stop_for_issue.(project_slug, identifier)

    {:ok, action_result("Stopped preview for #{identifier}.", project_slug, identifier, issue_targets, list_serve_steps)}
  end

  defp execute_action(project_slug, identifier, :restart, issue_targets, list_serve_steps, opts) do
    restart_for_issue = Keyword.get(opts, :restart_for_issue, &Manager.restart_for_issue/3)
    run_preview_start("Restarted", restart_for_issue, project_slug, identifier, issue_targets, list_serve_steps)
  end

  defp run_preview_start(verb, start_fun, project_slug, identifier, issue_targets, list_serve_steps) do
    case start_fun.(project_slug, identifier, ready_timeout_ms: @start_ready_timeout_ms) do
      {:ok, _pids} ->
        with_preview_view(project_slug, identifier, issue_targets, list_serve_steps, fn data ->
          outcome = start_outcome(Map.get(data, :servers, []))

          %{
            tool: @tool,
            message: start_message(verb, identifier, outcome),
            data: apply_start_next_steps(data, outcome)
          }
        end)

      {:error, reason} when reason in @recoverable_start_errors ->
        with_preview_view(project_slug, identifier, issue_targets, list_serve_steps, fn data ->
          %{
            tool: @tool,
            message: failed_start_message(reason, identifier),
            data: apply_failed_next_steps(data, reason)
          }
        end)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp with_preview_view(project_slug, identifier, issue_targets, list_serve_steps, build) do
    case issue_targets.(project_slug, identifier) do
      {:ok, view} -> {:ok, build.(enrich_view(project_slug, view, list_serve_steps))}
      {:error, reason} -> {:error, reason}
    end
  end

  defp start_outcome(servers) when is_list(servers) do
    statuses = Enum.map(servers, &server_status/1)

    cond do
      statuses != [] and Enum.all?(statuses, &(&1 == "ready")) -> :ready
      Enum.any?(statuses, &(&1 == "crashed")) -> :crashed
      true -> :starting
    end
  end

  defp start_outcome(_servers), do: :starting

  defp server_status(server) when is_map(server) do
    to_string(Map.get(server, :status) || Map.get(server, "status") || "unknown")
  end

  defp server_status(_server), do: "unknown"

  defp start_message(verb, identifier, :ready),
    do: "#{verb} preview for #{identifier} — all servers are ready."

  defp start_message(verb, identifier, :starting),
    do:
      "#{verb} preview for #{identifier}; servers are still booting. This call is non-blocking — " <>
        "poll `manage_preview` with `status` to confirm readiness, and keep making progress " <>
        "(write tests, run the unit suite) instead of waiting on the preview."

  defp start_message(verb, identifier, :crashed),
    do:
      "#{verb} preview for #{identifier}, but a server crashed before it became ready. Do not block the run: " <>
        "continue writing/running tests, record the preview blocker in your `## Codex Workpad`, and retry " <>
        "`manage_preview` `restart`/`status` later or proceed without UI e2e."

  defp failed_start_message(:lock_unavailable, identifier),
    do:
      "A preview start is already in progress for #{identifier}. Poll `manage_preview status` shortly; " <>
        "meanwhile keep working — this does not block the run."

  defp failed_start_message(:no_free_port, identifier),
    do:
      "Could not start preview for #{identifier}: no free port is available. Do not block — continue " <>
        "writing/running tests, note the blocker in your `## Codex Workpad`, and retry later."

  defp failed_start_message(_reason, identifier),
    do:
      "Preview for #{identifier} failed to start (the dev server crashed). Do not block the run: continue " <>
        "writing/running tests, record the blocker in your `## Codex Workpad`, and retry `manage_preview` " <>
        "`restart`/`status` later or proceed without UI e2e."

  defp apply_start_next_steps(data, :ready), do: data
  defp apply_start_next_steps(data, :starting), do: Map.put(data, :next_steps, @starting_next_steps)
  defp apply_start_next_steps(data, :crashed), do: Map.put(data, :next_steps, @not_ready_next_steps)

  defp apply_failed_next_steps(data, :lock_unavailable), do: Map.put(data, :next_steps, @lock_next_steps)
  defp apply_failed_next_steps(data, _reason), do: Map.put(data, :next_steps, @not_ready_next_steps)

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
    |> Map.put(:servers, enrich_servers(Map.get(view, :servers, [])))
  end

  defp enrich_servers(servers) when is_list(servers) do
    Enum.map(servers, &enrich_server/1)
  end

  defp enrich_servers(_), do: []

  defp enrich_server(server) when is_map(server) do
    port = Map.get(server, :port) || Map.get(server, "port")
    slug = to_string(Map.get(server, :slug) || Map.get(server, "slug") || "")

    local_url =
      if is_integer(port) and port > 0 do
        path = if String.contains?(slug, "admin"), do: "/", else: "/api/health"
        "http://127.0.0.1:#{port}#{path}"
      else
        nil
      end

    Map.put(server, :local_url, local_url)
  end

  defp enrich_server(server), do: server

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
