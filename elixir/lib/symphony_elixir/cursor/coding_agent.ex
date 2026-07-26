defmodule SymphonyElixir.Cursor.CodingAgent do
  @moduledoc """
  Native Cursor Agent backend implementing the CodingAgent behaviour by
  spawning the `cursor-agent` CLI per turn (no external bridge). Tools are
  served through the shared MCP ToolGateway; events are translated by
  `SymphonyElixir.Cursor.CliRunner` into the bridge vocabulary the rest of
  Symphony understands.

  Unlike Claude (`--mcp-config <path>`), the cursor-agent CLI only reads MCP
  servers from `<workspace>/.cursor/mcp.json`, so the gateway entry is merged
  into that file at session start and removed at session stop.

  Interactive assistant turns use Cursor ACP (`agent acp`) so permissions,
  ask-question, and create-plan can wait on the composer. Non-interactive /
  orchestrator turns keep `--print` stream-json via `CliRunner`. Interactive
  `build` also gates mutating Symphony MCP tools through `ApprovalBroker`.
  """

  @behaviour SymphonyElixir.CodingAgent

  require Logger

  alias SymphonyElixir.Agent.{ConversationRef, SessionTranscript}
  alias SymphonyElixir.Assistant.ToolExecutor
  alias SymphonyElixir.Claude.ApprovalBroker
  alias SymphonyElixir.Claude.AppServer.ToolGateway
  alias SymphonyElixir.Config
  alias SymphonyElixir.Cursor.AcpRunner
  alias SymphonyElixir.Cursor.CliRunner
  alias SymphonyElixir.Cursor.ModelCatalog
  alias SymphonyElixir.ExecutionMode

  @mcp_server_name "symphony"
  @default_approval_timeout_ms 300_000

  @type session :: %{
          session_uuid: String.t(),
          workspace: Path.t(),
          command: String.t(),
          cli_session_id: String.t() | nil,
          model: String.t() | nil,
          gateway_token: String.t() | nil,
          mcp_config_path: Path.t() | nil,
          mcp_config_backup: String.t() | nil,
          metadata: map()
        }

  @impl true
  def capabilities, do: SymphonyElixir.Agent.BackendCapabilities.for("cursor")

  @impl true
  def start_session(workspace, opts \\ []) do
    with :ok <- validate_workspace_cwd(workspace, opts),
         {:ok, gateway} <- maybe_register_tools(workspace, opts) do
      {:ok,
       %{
         session_uuid: generate_uuid(),
         workspace: Path.expand(workspace),
         command: resolve_command(opts),
         cli_session_id: conversation_id(opts, "cursor"),
         model: Keyword.get(opts, :model),
         gateway_token: Map.get(gateway, :token),
         mcp_config_path: Map.get(gateway, :path),
         mcp_config_backup: Map.get(gateway, :backup),
         metadata: %{}
       }}
    end
  end

  @impl true
  def run_turn(session, prompt, issue, opts \\ []) do
    on_message = Keyword.get(opts, :on_message, &default_on_message/1)
    turn_id = generate_uuid()
    prior_totals = session_usage_totals(session)

    emit_message(
      on_message,
      :session_started,
      %{provider: "cursor", conversation_id: session.cli_session_id, run_id: turn_id},
      %{}
    )

    write_transcript_sidecar(session, opts)

    # Cursor CLI reports per-turn usage (not cumulative). Accumulate into an
    # absolute session total before emitting so TokenDelta can subtract safely.
    {:ok, usage_agent} = Agent.start(fn -> %{prior: prior_totals, turn: nil} end)

    on_event = fn notification ->
      {event, details} = bridge_event_to_message(notification)
      emit_message(on_message, event, details, usage_metadata(notification, usage_agent))
    end

    runner_args = turn_args(session, prompt, opts)
    interactive? = Keyword.get(opts, :interactive_user_input, false) == true

    run_result =
      try do
        if interactive? do
          AcpRunner.run_turn(acp_turn_args(runner_args, opts), on_event)
        else
          CliRunner.run_turn(runner_args, on_event)
        end
      after
        if Process.alive?(usage_agent), do: Agent.stop(usage_agent)
      end

    case run_result do
      {:ok, result} ->
        case resolved_model(Map.get(result, :provider_model), Map.get(runner_args, :model)) do
          {:ok, resolved_model} ->
            turn_usage = canonicalize_usage(result.usage)
            usage_totals = add_usage(prior_totals, turn_usage)
            resolved_effort = resolved_effort(resolved_model, Map.get(runner_args, :model))

            result =
              result
              |> Map.put(:resolved_model, resolved_model)
              |> Map.put(:resolved_effort, resolved_effort)

            emit_message(
              on_message,
              :turn_completed,
              %{payload: %{"usage" => usage_totals}, result: result},
              %{usage: usage_totals}
            )

            {:ok,
             %{
               result: :turn_completed,
               provider: "cursor",
               conversation_id: result.cli_session_id,
               run_id: turn_id,
               usage: usage_totals,
               usage_totals: usage_totals,
               cost_usd: result.cost_usd,
               resolved_model: resolved_model,
               resolved_effort: resolved_effort
             }}

          {:error, reason} ->
            Logger.warning("Cursor model confirmation failed for #{issue_context(issue)}: #{inspect(reason)}")
            emit_message(on_message, :turn_ended_with_error, %{reason: reason}, %{})
            {:error, reason}
        end

      {:error, {:resume_session_not_found, stale_id}} when session.cli_session_id != nil ->
        reason = {:resume_conversation_failed, stale_id, :not_found}
        Logger.warning("Cursor turn failed for #{issue_context(issue)}: #{inspect(reason)}")
        emit_message(on_message, :turn_ended_with_error, %{reason: reason}, %{})
        {:error, reason}

      {:error, {:turn_failed, "cursor-agent exited with code 1"}} when session.cli_session_id != nil ->
        reason = {:resume_conversation_failed, session.cli_session_id, :provider_exit}
        Logger.warning("Cursor turn failed for #{issue_context(issue)}: #{inspect(reason)}")
        emit_message(on_message, :turn_ended_with_error, %{reason: reason}, %{})
        {:error, reason}

      {:error, reason} ->
        Logger.warning("Cursor turn failed for #{issue_context(issue)}: #{inspect(reason)}")
        emit_message(on_message, :turn_ended_with_error, %{reason: reason}, %{})
        {:error, reason}
    end
  end

  @impl true
  def stop_session(%{gateway_token: token} = session) when is_binary(token) do
    ToolGateway.unregister_session(token)
    restore_mcp_config(session)
    :ok
  end

  def stop_session(_session), do: :ok

  @impl true
  @spec normalize_event(map()) :: map()
  def normalize_event(event) when is_map(event) do
    event
    |> normalize_usage()
    |> Map.put(:rate_limits, event[:rate_limits] || Map.get(event, "rate_limits"))
  end

  @doc false
  @spec resolved_model(String.t() | nil, String.t() | nil) ::
          {:ok, String.t() | nil} | {:error, term()}
  def resolved_model(provider_model, requested_model) do
    provider_model = normalize_model_value(provider_model)
    requested_model = normalize_model_value(requested_model)

    cond do
      is_nil(provider_model) ->
        if is_nil(requested_model) do
          {:ok, nil}
        else
          {:error, {:model_confirmation_missing, requested_model}}
        end

      true ->
        with {:ok, catalog} <- ModelCatalog.list_models() do
          resolve_catalog_model(catalog.models, provider_model, requested_model)
        end
    end
  end

  defp resolve_catalog_model(models, provider_model, requested_model)
       when requested_model in [nil, "auto"] do
    case Enum.filter(models, &provider_model_matches?(&1, provider_model)) do
      [model] ->
        {:ok, model.model}

      [] ->
        # Cursor's automatic router can return a provider-owned, parameterized
        # identifier that is intentionally absent from the selectable catalog
        # (for example `auto-smart[optimize_for=balanced]`). It is still the
        # strongest native confirmation available for an `auto` request, so
        # preserve it verbatim as provenance instead of discarding a completed
        # turn.
        {:ok, provider_model}

      matches ->
        {:error, {:model_confirmation_ambiguous, provider_model, Enum.map(matches, & &1.model)}}
    end
  end

  defp resolve_catalog_model(models, provider_model, requested_model) do
    case Enum.filter(models, &(&1.model == requested_model)) do
      [model] ->
        if provider_model_matches?(model, provider_model) do
          {:ok, model.model}
        else
          {:error, {:model_confirmation_mismatch, requested_model, provider_model}}
        end

      [] ->
        {:error, {:requested_model_unavailable, requested_model}}

      matches ->
        {:error, {:requested_model_ambiguous, requested_model, Enum.map(matches, & &1.model)}}
    end
  end

  @doc false
  @spec resolved_effort(String.t() | nil, String.t() | nil) :: String.t() | nil
  def resolved_effort(_provider_model, _requested_model), do: nil

  # ── Private helpers ────────────────────────────────────────────────────────

  defp normalize_model_value(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      normalized -> normalized
    end
  end

  defp normalize_model_value(nil), do: nil
  defp normalize_model_value(value), do: value |> to_string() |> normalize_model_value()

  defp comparable_model(value) do
    value
    |> String.replace(~r/\[.*\]\z/u, "")
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9]/u, "")
    |> String.replace_prefix("cursor", "")
    |> String.replace(~r/(high|medium|low)\z/u, "")
  end

  defp provider_model_matches?(model, provider_model) do
    comparable =
      [model.model, model.id, model.label]
      |> Enum.filter(&is_binary/1)
      |> Enum.any?(&(comparable_model(&1) == comparable_model(provider_model)))

    provider_effort = parameter_effort(provider_model) || variant_effort(provider_model)
    catalog_effort = variant_effort(model.model) || variant_effort(model.id)

    comparable and
      (is_nil(catalog_effort) or provider_effort == catalog_effort)
  end

  defp parameter_effort(value) when is_binary(value) do
    case Regex.run(~r/(?:^|[,\[])effort=(low|medium|high|xhigh|max)(?:[,\]]|$)/u, String.downcase(value)) do
      [_, effort] -> effort
      _ -> nil
    end
  end

  defp parameter_effort(_value), do: nil

  defp variant_effort(value) when is_binary(value) do
    case Regex.run(~r/(?:^|[\s_-])(low|medium|high|xhigh|max)(?:\s|\z)/u, String.downcase(value)) do
      [_, effort] -> effort
      _ -> nil
    end
  end

  defp variant_effort(_value), do: nil

  defp turn_args(session, prompt, opts) do
    %{
      command: session.command,
      workspace: session.workspace,
      prompt: prompt,
      session_uuid: session.session_uuid,
      cli_session_id: session.cli_session_id,
      model: Keyword.get(opts, :model, session.model),
      mcp_config_path: session.mcp_config_path,
      execution_mode: Keyword.get(opts, :execution_mode),
      timeout_ms: Config.agent_turn_timeout_ms()
    }
  end

  defp conversation_id(opts, provider) do
    case Keyword.get(opts, :conversation_ref) do
      %ConversationRef{provider: ^provider, conversation_id: conversation_id} ->
        conversation_id

      _ ->
        nil
    end
  end

  defp acp_turn_args(runner_args, opts) do
    runner_args
    |> Map.put(:on_approval_required, Keyword.get(opts, :on_approval_required))
    |> Map.put(:on_user_input_required, Keyword.get(opts, :on_user_input_required))
    |> Map.put(:on_create_plan_required, Keyword.get(opts, :on_create_plan_required))
  end

  defp maybe_register_tools(workspace, opts) do
    specs = Keyword.get(opts, :dynamic_tools, [])
    executor = Keyword.get(opts, :tool_executor)

    if specs != [] and is_function(executor, 2) do
      with {:ok, token, url} <-
             ToolGateway.register_session(specs, wrap_executor(executor, Path.expand(workspace), opts)) do
        {path, backup} = write_mcp_config!(Path.expand(workspace), url)
        {:ok, %{token: token, path: path, backup: backup}}
      end
    else
      {:ok, %{}}
    end
  end

  # cursor-agent only reads MCP servers from <workspace>/.cursor/mcp.json, so
  # the gateway entry is merged into any existing config. The pre-existing
  # raw content is kept so stop_session can restore the file untouched.
  defp write_mcp_config!(workspace, url) do
    dir = Path.join(workspace, ".cursor")
    File.mkdir_p!(dir)
    path = Path.join(dir, "mcp.json")

    backup =
      case File.read(path) do
        {:ok, raw} -> raw
        {:error, _reason} -> nil
      end

    existing =
      with raw when is_binary(raw) <- backup,
           {:ok, decoded} when is_map(decoded) <- Jason.decode(raw) do
        decoded
      else
        _ -> %{}
      end

    servers = Map.get(existing, "mcpServers", %{})
    config = Map.put(existing, "mcpServers", Map.put(servers, @mcp_server_name, %{"url" => url}))

    File.write!(path, Jason.encode!(config))
    {path, backup}
  end

  defp restore_mcp_config(%{mcp_config_path: path, mcp_config_backup: backup}) when is_binary(path) do
    if is_binary(backup) do
      File.write(path, backup)
    else
      File.rm(path)
    end

    :ok
  end

  defp restore_mcp_config(_session), do: :ok

  # The CLI prefixes MCP tools; executors know bare names. Interactive build
  # pauses mutating tools on ApprovalBroker so the composer can approve/deny.
  defp wrap_executor(executor, workspace, opts) do
    mode = Keyword.get(opts, :execution_mode)
    interactive? = Keyword.get(opts, :interactive_user_input, false) == true
    on_approval_required = Keyword.get(opts, :on_approval_required)
    timeout_ms = Keyword.get(opts, :approval_timeout_ms, @default_approval_timeout_ms)

    fn name, arguments ->
      bare = String.replace_prefix(name, "mcp__#{@mcp_server_name}__", "")
      arguments = if is_map(arguments), do: arguments, else: %{}

      case tool_gate(bare, mode, interactive?) do
        :allow ->
          executor.(bare, arguments)

        :require_approval ->
          await_tool_approval(bare, arguments, workspace, on_approval_required, timeout_ms, executor)
      end
    end
  end

  defp tool_gate(tool, mode, interactive?) do
    cond do
      ToolExecutor.read_only_tool?(tool) ->
        :allow

      ExecutionMode.cursor_interactive_approval?(mode, interactive?) ->
        :require_approval

      true ->
        :allow
    end
  end

  defp await_tool_approval(tool, arguments, workspace, on_approval_required, timeout_ms, executor) do
    request_id = generate_uuid()

    if is_function(on_approval_required, 1) do
      request = %{
        request_id: request_id,
        agent: "cursor",
        tool_name: tool,
        command: approval_command(tool, arguments),
        cwd: workspace,
        input: arguments,
        reason: "Cursor requested approval to run Symphony MCP tool #{tool}"
      }

      case ApprovalBroker.await(request_id, timeout_ms, fn -> on_approval_required.(request) end) do
        :approve -> executor.(tool, arguments)
        :deny -> tool_error("Denied by operator: #{tool}")
      end
    else
      Logger.warning("Cursor approval requested for #{tool} but no on_approval_required callback is wired; denying")
      tool_error("Denied: no approval channel for #{tool}")
    end
  end

  defp approval_command(tool, arguments) when is_map(arguments) do
    case Jason.encode(Map.put(arguments, "tool", tool)) do
      {:ok, encoded} -> encoded
      _ -> tool
    end
  end

  defp approval_command(tool, _arguments), do: tool

  defp tool_error(message) when is_binary(message) do
    %{"success" => false, "contentItems" => [%{"type" => "inputText", "text" => message}]}
  end

  defp resolve_command(opts) do
    Keyword.get(opts, :cursor_command) || SymphonyElixir.Cursor.Config.command()
  end

  defp generate_uuid do
    <<a::32, b::16, c::16, d::16, e::48>> = :crypto.strong_rand_bytes(16)

    :io_lib.format(~c"~8.16.0b-~4.16.0b-4~3.16.0b-~4.16.0b-~12.16.0b", [
      a,
      b,
      Bitwise.band(c, 0xFFF),
      Bitwise.bor(Bitwise.band(d, 0x3FFF), 0x8000),
      e
    ])
    |> IO.iodata_to_binary()
  end

  defp validate_workspace_cwd(workspace, opts) when is_binary(workspace) and is_list(opts) do
    workspace_path = Path.expand(workspace)
    workspace_root = opts |> resolve_workspace_root() |> Path.expand()

    root_prefix = workspace_root <> "/"

    cond do
      workspace_path == workspace_root ->
        {:error, {:invalid_workspace_cwd, :workspace_root, workspace_path}}

      not String.starts_with?(workspace_path <> "/", root_prefix) ->
        {:error, {:invalid_workspace_cwd, :outside_workspace_root, workspace_path, workspace_root}}

      true ->
        :ok
    end
  end

  defp resolve_workspace_root(opts) do
    case Keyword.get(opts, :workspace_root) do
      root when is_binary(root) and root != "" -> root
      _ -> Config.workspace_root()
    end
  end

  defp issue_context(%{id: issue_id, identifier: identifier}) do
    "issue_id=#{issue_id} issue_identifier=#{identifier}"
  end

  defp normalize_usage(event) do
    payloads = [
      event[:usage],
      Map.get(event, "usage"),
      event[:payload],
      Map.get(event, "payload"),
      event[:result] && Map.get(event[:result], :usage),
      event
    ]

    usage =
      Enum.find_value(payloads, &canonicalize_usage/1) ||
        Enum.find_value(payloads, &turn_completed_usage/1)

    Map.put(event, :usage, usage)
  end

  defp turn_completed_usage(payload) when is_map(payload) do
    method = Map.get(payload, "method") || Map.get(payload, :method)

    if method in ["turn/completed", :turn_completed] do
      usage =
        Map.get(payload, "usage") || Map.get(payload, :usage) ||
          get_in(payload, ["params", "usage"]) || get_in(payload, [:params, :usage])

      canonicalize_usage(usage)
    end
  end

  defp turn_completed_usage(_), do: nil

  defp canonicalize_usage(nil), do: nil

  defp canonicalize_usage(raw) when is_map(raw) do
    # Prefer explicit input/output fields. Cache tokens are NOT input fallbacks —
    # cursor-agent reports them separately and totals must include them
    # (matches Cursor SDK: input + output + cacheRead + cacheWrite).
    input =
      token_value(
        raw,
        ~w(input_tokens prompt_tokens inputTokens promptTokens)a ++
          ~w(input_tokens prompt_tokens inputTokens promptTokens)
      )

    output =
      token_value(
        raw,
        ~w(output_tokens completion_tokens outputTokens completionTokens reasoningTokens)a ++
          ~w(output_tokens completion_tokens outputTokens completionTokens reasoningTokens)
      )

    cache_read =
      token_value(
        raw,
        ~w(cache_read_input_tokens cacheReadTokens cache_read_tokens)a ++
          ~w(cache_read_input_tokens cacheReadTokens cache_read_tokens)
      )

    cache_write =
      token_value(
        raw,
        ~w(cache_creation_input_tokens cacheWriteTokens cache_write_tokens)a ++
          ~w(cache_creation_input_tokens cacheWriteTokens cache_write_tokens)
      )

    total = token_value(raw, ~w(total_tokens total totalTokens)a ++ ~w(total_tokens total totalTokens))

    input = input || 0
    output = output || 0
    cache_read = cache_read || 0
    cache_write = cache_write || 0
    total = total || input + output + cache_read + cache_write

    if input > 0 or output > 0 or cache_read > 0 or cache_write > 0 or total > 0 do
      %{input_tokens: input, output_tokens: output, total_tokens: total}
    end
  end

  defp token_value(map, keys) do
    Enum.find_value(keys, fn key ->
      map |> Map.get(key) |> parse_token_value()
    end)
  end

  defp parse_token_value(v) when is_integer(v) and v >= 0, do: v

  defp parse_token_value(v) when is_binary(v) do
    case Integer.parse(String.trim(v)) do
      {n, _} when n >= 0 -> n
      _ -> nil
    end
  end

  defp parse_token_value(_), do: nil

  defp zero_usage, do: %{input_tokens: 0, output_tokens: 0, total_tokens: 0}

  defp session_usage_totals(%{metadata: %{usage_totals: totals}}) when is_map(totals) do
    canonicalize_usage(totals) || zero_usage()
  end

  defp session_usage_totals(%{usage_totals: totals}) when is_map(totals) do
    canonicalize_usage(totals) || zero_usage()
  end

  defp session_usage_totals(_session), do: zero_usage()

  defp add_usage(nil, turn) when is_map(turn), do: turn
  defp add_usage(_prior, nil), do: nil

  defp add_usage(prior, turn) when is_map(prior) and is_map(turn) do
    %{
      input_tokens: Map.get(prior, :input_tokens, 0) + Map.get(turn, :input_tokens, 0),
      output_tokens: Map.get(prior, :output_tokens, 0) + Map.get(turn, :output_tokens, 0),
      total_tokens: Map.get(prior, :total_tokens, 0) + Map.get(turn, :total_tokens, 0)
    }
  end

  defp usage_metadata(notification, usage_agent) when is_pid(usage_agent) do
    case extract_notification_usage(notification) do
      nil ->
        %{}

      raw ->
        case canonicalize_usage(raw) do
          nil ->
            %{}

          turn_usage ->
            cumulative =
              Agent.get_and_update(usage_agent, fn %{prior: prior} ->
                reported = add_usage(prior, turn_usage)
                {reported, %{prior: prior, turn: turn_usage}}
              end)

            %{usage: cumulative}
        end
    end
  end

  defp extract_notification_usage(%{"method" => method, "params" => params})
       when method in ["usage/update", "turn/completed"] and is_map(params) do
    Map.get(params, "usage") || Map.get(params, :usage)
  end

  defp extract_notification_usage(_notification), do: nil

  @doc false
  @spec bridge_event_to_message(map()) ::
          {:tool_call_started | :tool_call_completed | :tool_call_failed | :notification, %{payload: map(), raw: String.t()}}
  def bridge_event_to_message(%{"method" => "item/created", "params" => %{"item" => item}} = notification) do
    event =
      case item do
        %{"type" => "tool_call"} -> :tool_call_started
        %{"type" => "tool_result", "is_error" => true} -> :tool_call_failed
        %{"type" => "tool_result"} -> :tool_call_completed
        _ -> :notification
      end

    {event, %{payload: notification, raw: Jason.encode!(notification)}}
  end

  def bridge_event_to_message(notification) when is_map(notification) do
    {:notification, %{payload: notification, raw: Jason.encode!(notification)}}
  end

  defp write_transcript_sidecar(session, opts) do
    model = session.model || Keyword.get(opts, :model)
    effort = Keyword.get(opts, :effort) || Map.get(session, :effort)

    SessionTranscript.write_sidecar(:cursor, session.workspace, %{
      "session_id" => session.cli_session_id,
      "agent_kind" => "cursor",
      "model" => model,
      "effort" => effort,
      "path" => SessionTranscript.path(:cursor, session.workspace)
    })
  end

  defp emit_message(on_message, event, details, metadata) when is_function(on_message, 1) do
    message = metadata |> Map.merge(details) |> Map.put(:event, event) |> Map.put(:timestamp, DateTime.utc_now())
    on_message.(message)
  end

  defp default_on_message(_message), do: :ok
end
