defmodule SymphonyElixir.Assistant.PreviewTools do
  @moduledoc false

  alias SymphonyElixir.Assistant.HandoffTools
  alias SymphonyElixir.DevServer
  alias SymphonyElixir.DevServer.Manager
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.DevEnv

  @tool "manage_preview"

  @tool_description """
  Inspect or control the issue Preview dock (preferred ports/URLs for this issue).
  Actions: status|start|stop|restart|output.
  Optional `server` (slug or id) scopes start/stop/restart/status/output to one process.
  Prefer these ports while Preview is healthy. On failure, read `reason`, `output_tail`, and `next_steps` to self-heal (fix code, manage_dev_env, restart); if Preview still cannot reach ready, fall back to a convenient project bring-up path (dock may lag).
  """

  @output_tail_max_lines 100

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
  @preferred_ports_next_steps "These ports/URLs match the Preview dock — prefer them while Preview is healthy. Before citing ports mid-turn, re-call manage_preview status."
  @not_ready_next_steps "Preview is not ready. Self-heal with manage_preview output/restart/status and manage_dev_env if needed. If it still cannot reach ready, fall back to a convenient project bring-up path, cite the ports actually in use, and note the dock may be stale. Do not block the run; retry later or proceed without UI e2e — do not tight-loop retries."
  @lock_next_steps "A preview start is already in progress for this issue. Poll `manage_preview status` shortly and keep working meanwhile — do not block."

  @spec assistant_tool_spec() :: map()
  def assistant_tool_spec do
    tool_spec(@tool_description, %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["identifier", "action"],
      "properties" => %{
        "identifier" => %{
          "type" => "string",
          "description" => "Issue identifier, for example MAC-1."
        },
        "action" => preview_action_schema(),
        "server" => server_schema()
      }
    })
  end

  @spec issue_bound_tool_spec() :: map()
  def issue_bound_tool_spec do
    tool_spec(@tool_description, %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["action"],
      "properties" => %{
        "action" => preview_action_schema(),
        "server" => server_schema()
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
      execute_action(project_slug, identifier, action, arguments, issue_targets, list_serve_steps, opts)
    end
  end

  defp execute_action(project_slug, identifier, :status, arguments, issue_targets, list_serve_steps, _opts) do
    with {:ok, view} <- issue_targets.(project_slug, identifier) do
      data =
        project_slug
        |> enrich_view(maybe_scope_view_to_server(view, server_argument(arguments)), list_serve_steps)

      {:ok,
       %{
         tool: @tool,
         message: "Preview status for #{identifier} (preferred Preview dock ports).",
         data: data
       }}
    end
  end

  defp execute_action(project_slug, identifier, :start, arguments, issue_targets, list_serve_steps, opts) do
    case scoped_action_fun(project_slug, identifier, arguments, issue_targets, opts, :start) do
      {:ok, start_fun} ->
        run_preview_start("Started", start_fun, project_slug, identifier, issue_targets, list_serve_steps, opts)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp execute_action(project_slug, identifier, :stop, arguments, issue_targets, list_serve_steps, opts) do
    case stop_preview(project_slug, identifier, arguments, issue_targets, opts) do
      :ok ->
        {:ok, action_result("Stopped preview for #{identifier}.", project_slug, identifier, issue_targets, list_serve_steps)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp execute_action(project_slug, identifier, :restart, arguments, issue_targets, list_serve_steps, opts) do
    case scoped_action_fun(project_slug, identifier, arguments, issue_targets, opts, :restart) do
      {:ok, restart_fun} ->
        run_preview_start("Restarted", restart_fun, project_slug, identifier, issue_targets, list_serve_steps, opts)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp execute_action(project_slug, identifier, :output, arguments, issue_targets, _list_serve_steps, opts) do
    capture_output = Keyword.get(opts, :capture_output, &Manager.capture_server_output/3)

    with {:ok, server_arg} <- required_server_argument(arguments),
         {:ok, view} <- issue_targets.(project_slug, identifier),
         {:ok, server} <- resolve_server(view, server_arg),
         {:ok, server_id} <- server_id(server) do
      case capture_output.(project_slug, identifier, server_id) do
        {:ok, %{output: output}} ->
          {:ok,
           %{
             tool: @tool,
             message: "Command output for #{server_field(server, :slug)} on #{identifier}.",
             data: %{
               available: Map.get(view, :available) || Map.get(view, "available"),
               reason: status_reason(server_status(server)),
               server: enrich_server(server, []),
               output_tail: tail_output(output),
               next_steps: output_next_steps(server_status(server))
             }
           }}

        {:error, :not_found} ->
          {:error, :server_not_found}

        {:error, message} when is_binary(message) ->
          {:ok,
           %{
             tool: @tool,
             message: "Could not read output for #{server_field(server, :slug)}.",
             data: %{
               ok: false,
               reason: "output_unavailable",
               server: enrich_server(server, []),
               output_tail: nil,
               next_steps: "Retry manage_preview output, or inspect the Preview dock logs. Error: #{message}"
             }
           }}
      end
    end
  end

  defp run_preview_start(verb, start_fun, project_slug, identifier, issue_targets, list_serve_steps, opts) do
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
          data =
            data
            |> apply_failed_next_steps(reason)
            |> maybe_attach_crashed_output(project_slug, identifier, opts)

          %{
            tool: @tool,
            message: failed_start_message(reason, identifier),
            data: data
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

  defp scoped_action_fun(project_slug, identifier, arguments, issue_targets, opts, action) do
    case server_argument(arguments) do
      nil ->
        {:ok, issue_action_fun(opts, action)}

      server_arg ->
        with {:ok, view} <- issue_targets.(project_slug, identifier),
             {:ok, server} <- resolve_server(view, server_arg),
             {:ok, id} <- server_id(server) do
          {:ok, instance_action_fun(opts, action, id)}
        end
    end
  end

  defp issue_action_fun(opts, :start), do: Keyword.get(opts, :start_for_issue, &Manager.start_for_issue/3)
  defp issue_action_fun(opts, :restart), do: Keyword.get(opts, :restart_for_issue, &Manager.restart_for_issue/3)

  defp instance_action_fun(opts, :start, server_id) do
    start_instance = Keyword.get(opts, :start_instance, &Manager.start_instance_for_server/3)
    fn project_slug, identifier, _opts -> start_instance.(project_slug, identifier, server_id) end
  end

  defp instance_action_fun(opts, :restart, server_id) do
    restart_instance = Keyword.get(opts, :restart_instance, &Manager.restart_instance_for_server/3)
    fn project_slug, identifier, _opts -> restart_instance.(project_slug, identifier, server_id) end
  end

  defp stop_preview(project_slug, identifier, arguments, issue_targets, opts) do
    case server_argument(arguments) do
      nil ->
        stop_for_issue = Keyword.get(opts, :stop_for_issue, &Manager.stop_for_issue/2)
        stop_for_issue.(project_slug, identifier)

      server_arg ->
        with {:ok, view} <- issue_targets.(project_slug, identifier),
             {:ok, server} <- resolve_server(view, server_arg),
             {:ok, id} <- server_id(server) do
          stop_instance = Keyword.get(opts, :stop_instance, &Manager.stop_instance_for_server/3)
          stop_instance.(project_slug, identifier, id)
        end
    end
  end

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

  defp maybe_attach_crashed_output(data, project_slug, identifier, opts) do
    capture_output = Keyword.get(opts, :capture_output, &Manager.capture_server_output/3)

    with %{} = server <- first_crashed_server(data),
         {:ok, id} <- server_id(server),
         {:ok, %{output: output}} <- capture_output.(project_slug, identifier, id) do
      Map.put(data, :output_tail, tail_output(output))
    else
      _ -> data
    end
  end

  defp first_crashed_server(%{servers: servers}) when is_list(servers) do
    Enum.find(servers, &(server_status(&1) == "crashed"))
  end

  defp first_crashed_server(_data), do: nil

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
    serve_steps = list_serve_steps.(project_slug)
    serve_steps_configured = serve_steps != []
    reason = Map.get(view, :reason)

    next_steps =
      case next_steps_hint(reason, serve_steps_configured) do
        nil -> preferred_next_steps(view) || crashed_servers_next_steps(view)
        hint -> hint
      end

    view
    |> Map.put(:serve_steps_configured, serve_steps_configured)
    |> Map.put(:reason, present_reason(reason))
    |> Map.put(:next_steps, next_steps)
    |> Map.put(:servers, enrich_servers(Map.get(view, :servers, []), serve_steps))
  end

  defp preferred_next_steps(view) do
    available = Map.get(view, :available) || Map.get(view, "available")
    reason = Map.get(view, :reason)
    servers = Map.get(view, :servers) || Map.get(view, "servers") || []

    if available == true and is_nil(reason) and servers_ready_or_empty?(servers) do
      @preferred_ports_next_steps
    else
      nil
    end
  end

  defp servers_ready_or_empty?(servers) when is_list(servers) do
    servers == [] or Enum.all?(servers, &(server_status(&1) == "ready"))
  end

  defp servers_ready_or_empty?(_servers), do: false

  defp crashed_servers_next_steps(view) do
    servers = Map.get(view, :servers) || Map.get(view, "servers") || []

    if Enum.any?(servers, &(server_status(&1) == "crashed")) do
      @not_ready_next_steps
    else
      nil
    end
  end

  defp enrich_servers(servers, serve_steps) when is_list(servers) do
    Enum.map(servers, &enrich_server(&1, serve_steps))
  end

  defp enrich_servers(_, _serve_steps), do: []

  defp enrich_server(server, serve_steps) when is_map(server) do
    port = Map.get(server, :port) || Map.get(server, "port")
    slug = to_string(Map.get(server, :slug) || Map.get(server, "slug") || "")
    step = find_serve_step(serve_steps, slug)
    ready_path = step_field(step, :ready_path)
    url_path = step_field(step, :url_path)

    public_url =
      Map.get(server, :public_url) || Map.get(server, "public_url") || Map.get(server, :url) ||
        Map.get(server, "url")

    local_url =
      cond do
        not is_integer(port) or port <= 0 ->
          nil

        is_binary(ready_path) and ready_path != "" ->
          "http://127.0.0.1:#{port}#{normalize_path(ready_path)}"

        is_binary(url_path) and url_path != "" ->
          "http://127.0.0.1:#{port}#{normalize_path(url_path)}"

        String.contains?(slug, "admin") ->
          "http://127.0.0.1:#{port}/"

        true ->
          "http://127.0.0.1:#{port}/api/health"
      end

    server
    |> Map.put(:local_url, local_url)
    |> maybe_put_public_url(public_url)
  end

  defp enrich_server(server, _serve_steps), do: server

  defp find_serve_step(steps, slug) when is_list(steps) and is_binary(slug) do
    Enum.find(steps, fn step ->
      step_slug = step_field(step, :slug)
      is_binary(step_slug) and step_slug == slug
    end)
  end

  defp find_serve_step(_steps, _slug), do: nil

  defp step_field(nil, _key), do: nil

  defp step_field(step, key) when is_map(step) do
    Map.get(step, key) || Map.get(step, Atom.to_string(key))
  end

  defp normalize_path("/" <> _ = path), do: path
  defp normalize_path(path) when is_binary(path), do: "/" <> path
  defp normalize_path(_), do: "/"

  defp maybe_put_public_url(server, public_url) when is_binary(public_url) and public_url != "",
    do: Map.put(server, :public_url, public_url)

  defp maybe_put_public_url(server, _public_url), do: server

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
      "output" -> {:ok, :output}
      other -> {:error, {:invalid_preview_action, other}}
    end
  end

  defp normalize_preview_action(action), do: {:error, {:invalid_preview_action, action}}

  defp preview_action_schema do
    %{
      "type" => "string",
      "enum" => ["status", "start", "stop", "restart", "output"],
      "description" => "Preview action. Use output with server to read command logs."
    }
  end

  defp server_schema do
    %{
      "type" => "string",
      "description" => "Optional server slug (front) or numeric id."
    }
  end

  defp maybe_scope_view_to_server(view, nil), do: view

  defp maybe_scope_view_to_server(view, server_arg) do
    case resolve_server(view, server_arg) do
      {:ok, server} -> Map.put(view, :servers, [server])
      {:error, _reason} -> view
    end
  end

  defp required_server_argument(arguments) do
    case server_argument(arguments) do
      nil -> {:error, {:invalid_preview_arguments, "output requires server"}}
      "" -> {:error, {:invalid_preview_arguments, "output requires server"}}
      server -> {:ok, server}
    end
  end

  defp server_argument(arguments) when is_map(arguments) do
    case Map.get(arguments, "server") || Map.get(arguments, :server) do
      server when is_binary(server) -> String.trim(server)
      nil -> nil
      server -> server
    end
  end

  defp resolve_server(_view, nil), do: :all
  defp resolve_server(_view, ""), do: {:error, {:invalid_preview_arguments, "server must not be empty"}}

  defp resolve_server(view, server_arg) when is_binary(server_arg) do
    servers = Map.get(view, :servers) || Map.get(view, "servers") || []

    case Integer.parse(server_arg) do
      {id, ""} ->
        find_server(servers, fn server -> server_id_value(server) == id end)

      _ ->
        find_server(servers, fn server -> to_string(server_field(server, :slug) || "") == server_arg end)
    end
  end

  defp resolve_server(_view, _server_arg), do: {:error, {:invalid_preview_arguments, "server must be a string"}}

  defp find_server(servers, predicate) do
    case Enum.find(servers, predicate) do
      nil -> {:error, {:invalid_preview_arguments, "server not found"}}
      server -> {:ok, server}
    end
  end

  defp server_id(server) do
    case server_id_value(server) do
      id when is_integer(id) and id > 0 -> {:ok, id}
      _ -> {:error, {:invalid_preview_arguments, "server id is missing"}}
    end
  end

  defp server_id_value(server) do
    case server_field(server, :id) do
      id when is_integer(id) -> id
      id when is_binary(id) -> parse_positive_integer(id)
      _ -> nil
    end
  end

  defp parse_positive_integer(value) do
    case Integer.parse(value) do
      {id, ""} when id > 0 -> id
      _ -> nil
    end
  end

  defp server_field(server, key) when is_map(server) do
    Map.get(server, key) || Map.get(server, Atom.to_string(key))
  end

  defp server_field(_server, _key), do: nil

  defp tail_output(output) when is_binary(output) do
    output
    |> String.split("\n", trim: true)
    |> Enum.take(-@output_tail_max_lines)
    |> Enum.join("\n")
  end

  defp tail_output(_output), do: ""

  defp status_reason("crashed"), do: "crashed"
  defp status_reason(_status), do: nil

  defp output_next_steps("crashed"),
    do: "Read output_tail, fix the underlying error (or manage_dev_env), then manage_preview restart with the same server."

  defp output_next_steps(_status),
    do: "If the server is unhealthy, fix the root cause then manage_preview restart."

  defp tool_spec(description, input_schema) do
    %{"name" => @tool, "description" => String.trim(description), "inputSchema" => input_schema}
  end
end
