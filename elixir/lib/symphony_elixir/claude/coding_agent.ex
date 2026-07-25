defmodule SymphonyElixir.Claude.CodingAgent do
  @moduledoc """
  Native Claude Code backend implementing the CodingAgent behaviour by
  spawning the `claude` CLI per turn (no external bridge). Tools are served
  through the component-owned MCP ToolGateway; events are translated by
  CliRunner into the bridge vocabulary the rest of Symphony understands.
  """

  @behaviour SymphonyElixir.CodingAgent

  require Logger

  alias SymphonyElixir.Agent.SessionTranscript
  alias SymphonyElixir.AgentAvailability
  alias SymphonyElixir.Assistant.UserInputBroker
  alias SymphonyElixir.Claude.ApprovalBroker
  alias SymphonyElixir.Claude.AskUserHook
  alias SymphonyElixir.Claude.AppServer.{CliRunner, ToolGateway}
  alias SymphonyElixir.Claude.Config, as: ClaudeConfig
  alias SymphonyElixir.Claude.GoalControl, as: ClaudeGoal
  alias SymphonyElixir.Claude.GoalStore
  alias SymphonyElixir.Config
  alias SymphonyElixir.ExecutionMode

  # The MCP tool Claude calls to request operator approval when running with
  # `--permission-mode default` (interactive `build`). The bare name is what the
  # gateway advertises; the qualified name is what `--permission-prompt-tool`
  # expects on the CLI.
  @approval_tool_name "symphony_approve"
  @approval_tool_qualified "mcp__symphony__symphony_approve"

  # How long the blocking MCP approval handler waits for the operator before it
  # gives up and denies (so a turn can never hang forever). Overridable per
  # session via the `:approval_timeout_ms` opt.
  @default_approval_timeout_ms 300_000

  @type session :: %{
          session_uuid: String.t(),
          workspace: Path.t(),
          command: String.t(),
          cli_session_id: String.t() | nil,
          model: String.t() | nil,
          effort: String.t() | nil,
          permission_mode: String.t(),
          permission_prompt_tool: String.t() | nil,
          gateway_token: String.t() | nil,
          mcp_config_path: Path.t() | nil,
          settings_path: Path.t() | nil,
          ask_user_token: String.t() | nil,
          metadata: map()
        }

  @impl true
  def start_session(workspace, opts \\ []) do
    command = ClaudeConfig.resolve_command(opts)

    with :ok <- validate_workspace_cwd(workspace, opts),
         :ok <- maybe_preflight_goal_command(workspace, command, opts),
         {:ok, gateway} <- maybe_register_tools(workspace, opts),
         {:ok, ask_user} <- maybe_install_ask_user_hook(workspace, opts) do
      interactive? = interactive?(opts)

      {:ok,
       %{
         session_uuid: generate_uuid(),
         workspace: Path.expand(workspace),
         command: command,
         cli_session_id: nil,
         model: Keyword.get(opts, :model),
         effort: Keyword.get(opts, :effort),
         permission_mode: ExecutionMode.claude_permission_mode(Keyword.get(opts, :execution_mode), interactive?),
         permission_prompt_tool: Map.get(gateway, :permission_prompt_tool),
         gateway_token: Map.get(gateway, :token),
         mcp_config_path: Map.get(gateway, :path),
         settings_path: Map.get(ask_user, :settings_path),
         ask_user_token: Map.get(ask_user, :token),
         metadata: %{}
       }}
    end
  end

  @impl true
  def run_turn(session, prompt, issue, opts \\ []) do
    original_prompt = prompt
    on_message = Keyword.get(opts, :on_message, &default_on_message/1)
    turn_id = generate_uuid()
    session_id = "#{session.session_uuid}-#{turn_id}"
    goal_role = Keyword.get(opts, :goal_role, :execution)
    assistant_thread_id = Keyword.get(opts, :assistant_thread_id)

    goal_snapshot =
      case read_goal_snapshot(session.workspace, goal_role, assistant_thread_id) do
        {:ok, snapshot} -> snapshot
        {:error, reason} -> throw({:goal_state_read_failed, reason})
      end

    native_goal_active = native_goal_active?(goal_snapshot)
    goal_revision = goal_snapshot_revision(goal_snapshot)

    {prompt, pending} =
      case ClaudeGoal.apply_snapshot_to_prompt(prompt, goal_snapshot) do
        {:error, reason} -> throw({:goal_injection_failed, reason})
        value -> value
      end

    emit_message(on_message, :session_started, %{session_id: session_id, thread_id: session.session_uuid, turn_id: turn_id}, %{})

    write_transcript_sidecar(session, opts)

    on_event = fn notification ->
      {event, details} = bridge_event_to_message(notification)
      emit_message(on_message, event, details, usage_metadata(notification))
    end

    case CliRunner.run_turn(turn_args(session, prompt, opts), on_event) do
      {:ok, result} ->
        case finalize_goal_inject(
               session.workspace,
               goal_role,
               assistant_thread_id,
               pending,
               native_goal_active,
               :completed,
               goal_revision,
               issue
             ) do
          :ok ->
            emit_message(
              on_message,
              :turn_completed,
              %{payload: %{"usage" => result.usage}, result: result},
              %{usage: result.usage}
            )

            {:ok,
             %{
               result: :turn_completed,
               session_id: session_id,
               thread_id: session.session_uuid,
               turn_id: turn_id,
               cli_session_id: result.cli_session_id,
               usage: result.usage,
               cost_usd: result.cost_usd
             }}

          {:error, reason} ->
            report_turn_error(on_message, session_id, issue, reason)
        end

      {:error, {:resume_session_not_found, stale_id}} when session.cli_session_id != nil ->
        # The persisted backend session no longer exists in claude's local store
        # (wiped session storage, or an id recorded while the backend was
        # misconfigured). Restart the turn as a fresh session instead of
        # hard-failing the thread forever; the fresh cli_session_id is persisted
        # upstream, so the thread self-heals for subsequent turns.
        Logger.warning("Claude resume session #{inspect(stale_id)} not found for #{issue_context(issue)}; retrying with a fresh session")

        retry_fresh_session(
          session,
          original_prompt,
          issue,
          opts,
          goal_role,
          assistant_thread_id,
          {:resume_session_not_found, stale_id},
          on_message,
          session_id
        )

      {:error, {:turn_failed, "claude exited with code 1"}} when session.cli_session_id != nil ->
        # A resumed Claude session can exit non-zero when the local conversation
        # ended outside Symphony. Retry once as a fresh session before failing.
        Logger.warning("Claude resumed session #{inspect(session.cli_session_id)} exited for #{issue_context(issue)}; retrying with a fresh session")

        retry_fresh_session(
          session,
          original_prompt,
          issue,
          opts,
          goal_role,
          assistant_thread_id,
          {:turn_failed, "claude exited with code 1"},
          on_message,
          session_id
        )

      {:error, reason} ->
        outcome = if reason == :interrupted, do: :interrupted, else: :failed

        case maybe_transition_native_goal(
               session.workspace,
               goal_role,
               assistant_thread_id,
               native_goal_active,
               outcome,
               goal_revision
             ) do
          :ok ->
            report_turn_error(on_message, session_id, issue, reason)

          {:error, transition_error} ->
            combined_error = {:turn_failed_with_goal_transition_failure, reason, transition_error}
            report_turn_error(on_message, session_id, issue, combined_error)
        end
    end
  catch
    {:goal_injection_failed, reason} -> {:error, {:goal_injection_failed, reason}}
    {:goal_state_read_failed, reason} -> {:error, {:goal_state_read_failed, reason}}
  end

  @impl true
  def stop_session(session) when is_map(session) do
    token = Map.get(session, :gateway_token)
    path = Map.get(session, :mcp_config_path)
    settings_path = Map.get(session, :settings_path)
    ask_user_token = Map.get(session, :ask_user_token)

    if is_binary(token), do: ToolGateway.unregister_session(token)
    if is_binary(path), do: File.rm(path)
    if is_binary(settings_path), do: File.rm(settings_path)

    if is_binary(settings_path) do
      wrapper = Path.join(Path.dirname(settings_path), "ask_user_hook_wrapper.sh")
      File.rm(wrapper)
    end

    if is_binary(ask_user_token), do: UserInputBroker.unbind_session(ask_user_token)
    :ok
  end

  def stop_session(_session), do: :ok

  @impl true
  @spec normalize_event(map()) :: map()
  def normalize_event(event) when is_map(event) do
    event
    |> normalize_usage()
    |> normalize_rate_limits()
  end

  # ── Private helpers ────────────────────────────────────────────────────────

  defp acknowledge_goal_inject(_workspace, _role, :none, _assistant_thread_id), do: :ok

  defp acknowledge_goal_inject(workspace, role, {command, revision} = pending, assistant_thread_id)
       when command in [:set, :clear] and is_binary(revision) do
    case ClaudeGoal.acknowledge_inject(workspace, role, pending, assistant_thread_id) do
      :ok -> :ok
      :stale -> :stale
      {:error, reason} -> {:error, {:goal_acknowledgement_failed, reason}}
    end
  end

  defp finalize_goal_inject(
         workspace,
         :execution,
         assistant_thread_id,
         {:clear, revision},
         false,
         :completed,
         _goal_revision,
         issue
       ) do
    case ClaudeGoal.acknowledge_clear_and_mirror(workspace, revision, assistant_thread_id, issue) do
      :ok -> :ok
      :stale -> :ok
      {:error, reason} -> {:error, {:goal_tracker_mirror_clear_failed, reason}}
    end
  end

  defp finalize_goal_inject(
         workspace,
         role,
         assistant_thread_id,
         _pending,
         true,
         :completed,
         goal_revision,
         _issue
       ) do
    maybe_transition_native_goal(workspace, role, assistant_thread_id, true, :completed, goal_revision)
  end

  defp finalize_goal_inject(
         workspace,
         role,
         assistant_thread_id,
         pending,
         false,
         :completed,
         _goal_revision,
         _issue
       ) do
    case acknowledge_goal_inject(workspace, role, pending, assistant_thread_id) do
      :ok -> :ok
      :stale -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp read_goal_snapshot(workspace, role, assistant_thread_id) do
    case GoalStore.read(workspace, role, assistant_thread_id) do
      {:ok, snapshot} -> {:ok, snapshot}
      :error -> {:ok, nil}
      {:error, reason} -> {:error, reason}
    end
  end

  defp native_goal_active?(%{"status" => status, "pending_command" => pending}),
    do: GoalStore.active_status?(status) and pending != "clear"

  defp native_goal_active?(_snapshot), do: false

  defp goal_snapshot_revision(%{"revision" => revision}) when is_binary(revision) and revision != "",
    do: revision

  defp goal_snapshot_revision(_snapshot), do: nil

  defp maybe_transition_native_goal(
         workspace,
         role,
         assistant_thread_id,
         true,
         outcome,
         goal_revision
       ) do
    case GoalStore.transition_native_run(
           workspace,
           role,
           outcome,
           assistant_thread_id,
           goal_revision
         ) do
      :ok -> :ok
      :stale -> :ok
      {:error, reason} -> {:error, {:goal_lifecycle_transition_failed, reason}}
    end
  end

  defp maybe_transition_native_goal(
         _workspace,
         _role,
         _assistant_thread_id,
         false,
         _outcome,
         _goal_revision
       ),
       do: :ok

  defp retry_fresh_session(
         session,
         original_prompt,
         issue,
         opts,
         goal_role,
         assistant_thread_id,
         runner_error,
         on_message,
         session_id
       ) do
    case ClaudeGoal.requeue_set_if_active(session.workspace, goal_role, assistant_thread_id) do
      :ok ->
        run_turn(%{session | cli_session_id: nil}, original_prompt, issue, opts)

      {:error, reason} ->
        restoration_error = {:goal_restoration_failed, runner_error, reason}
        report_turn_error(on_message, session_id, issue, restoration_error)
    end
  end

  defp report_turn_error(on_message, session_id, issue, reason) do
    Logger.warning("Claude turn failed for #{issue_context(issue)}: #{inspect(reason)}")
    emit_message(on_message, :turn_ended_with_error, %{session_id: session_id, reason: reason}, %{})
    {:error, reason}
  end

  defp turn_args(session, prompt, opts) do
    %{
      command: session.command,
      workspace: session.workspace,
      prompt: prompt,
      session_uuid: session.session_uuid,
      cli_session_id: session.cli_session_id,
      model: Keyword.get(opts, :model, session.model),
      effort: Keyword.get(opts, :effort, session.effort),
      mcp_config_path: session.mcp_config_path,
      permission_mode: turn_permission_mode(session, opts),
      permission_prompt_tool: session.permission_prompt_tool,
      settings_path: Map.get(session, :settings_path),
      timeout_ms: Config.agent_turn_timeout_ms()
    }
  end

  # A per-turn execution mode (carried in the run opts) overrides the session's
  # mode; otherwise the mode resolved at session start applies. `default` only
  # makes sense when the approval prompt tool was wired at session start —
  # otherwise fall back to bypass so tool calls don't fail on "requires approval".
  defp turn_permission_mode(session, opts) do
    requested =
      case Keyword.get(opts, :execution_mode) do
        mode when is_binary(mode) -> ExecutionMode.claude_permission_mode(mode, interactive?(opts))
        _ -> session.permission_mode
      end

    if requested == "default" and is_nil(session.permission_prompt_tool) do
      "bypassPermissions"
    else
      requested
    end
  end

  defp maybe_register_tools(workspace, opts) do
    specs = Keyword.get(opts, :dynamic_tools, [])
    executor = Keyword.get(opts, :tool_executor)

    approval? =
      ExecutionMode.claude_interactive_approval?(Keyword.get(opts, :execution_mode), interactive?(opts))

    cond do
      approval? ->
        register_with_approval(workspace, specs, executor, opts)

      specs != [] and is_function(executor, 2) ->
        with {:ok, token, url} <- ToolGateway.register_session(specs, wrap_executor(executor)) do
          {:ok, %{token: token, path: ToolGateway.write_mcp_config!(Path.expand(workspace), url)}}
        end

      true ->
        {:ok, %{}}
    end
  end

  # Interactive `build`: register the MCP gateway (even without other dynamic
  # tools) plus a `symphony_approve` tool. Claude runs with `--permission-mode
  # default` and `--permission-prompt-tool`, so every tool it can't statically run
  # is routed to `handle_approval_request/4`, which asks the operator and blocks
  # until they decide.
  defp register_with_approval(workspace, specs, executor, opts) do
    workspace = Path.expand(workspace)
    on_approval_required = Keyword.get(opts, :on_approval_required)
    timeout_ms = Keyword.get(opts, :approval_timeout_ms, @default_approval_timeout_ms)

    approval_spec = %{
      "name" => @approval_tool_name,
      "description" => "Internal Symphony permission gate; invoked by Claude to request operator approval before running a tool.",
      "inputSchema" => %{
        "type" => "object",
        "properties" => %{
          "tool_name" => %{"type" => "string"},
          "input" => %{"type" => "object"},
          "tool_use_id" => %{"type" => "string"}
        }
      }
    }

    combined = combined_executor(executor, workspace, on_approval_required, timeout_ms)

    with {:ok, token, url} <- ToolGateway.register_session([approval_spec | specs], wrap_executor(combined)) do
      {:ok,
       %{
         token: token,
         path: ToolGateway.write_mcp_config!(workspace, url),
         permission_prompt_tool: @approval_tool_qualified
       }}
    end
  end

  # Routes the approval tool to the blocking handler and everything else to the
  # session's real tool executor (if any).
  defp combined_executor(user_executor, workspace, on_approval_required, timeout_ms) do
    fn name, arguments ->
      cond do
        name == @approval_tool_name ->
          handle_approval_request(arguments, workspace, on_approval_required, timeout_ms)

        is_function(user_executor, 2) ->
          user_executor.(name, arguments)

        true ->
          %{"success" => false, "contentItems" => [%{"text" => "Unknown tool: #{name}"}]}
      end
    end
  end

  # Blocking MCP permission-prompt handler. Surfaces the request to the operator
  # via `on_approval_required`, waits (bounded) for the decision through the
  # ApprovalBroker, then returns the Claude permission-result contract as JSON
  # text (`{"behavior":"allow"|"deny", ...}`).
  defp handle_approval_request(arguments, workspace, on_approval_required, timeout_ms) do
    tool_name = approval_tool_name(arguments)
    input = Map.get(arguments, "input") || %{}
    request_id = generate_uuid()

    if is_function(on_approval_required, 1) do
      on_approval_required.(%{
        request_id: request_id,
        agent: "claude",
        tool_name: tool_name,
        command: approval_command(tool_name, input),
        cwd: workspace,
        input: input,
        reason: "Claude requested approval to run #{tool_name}"
      })

      request_id
      |> ApprovalBroker.await(timeout_ms)
      |> permission_result(input)
    else
      # No channel is listening for approvals; deny rather than silently running.
      Logger.warning("Claude approval requested for #{tool_name} but no on_approval_required callback is wired; denying")
      permission_result(:deny, input)
    end
  end

  defp permission_result(:approve, input) do
    payload = %{"behavior" => "allow", "updatedInput" => input}
    %{"success" => true, "contentItems" => [%{"text" => Jason.encode!(payload)}]}
  end

  defp permission_result(:deny, _input) do
    payload = %{"behavior" => "deny", "message" => "Denied by operator"}
    %{"success" => true, "contentItems" => [%{"text" => Jason.encode!(payload)}]}
  end

  defp approval_tool_name(arguments) do
    Map.get(arguments, "tool_name") || Map.get(arguments, "toolName") || "command"
  end

  defp approval_command(tool_name, input) when is_map(input) do
    case Map.get(input, "command") do
      cmd when is_binary(cmd) and cmd != "" -> cmd
      _ -> tool_name
    end
  end

  defp approval_command(tool_name, _input), do: tool_name

  defp interactive?(opts), do: Keyword.get(opts, :interactive_user_input, false) == true

  defp maybe_install_ask_user_hook(workspace, opts) do
    ask = Keyword.get(opts, :ask_user_session)

    cond do
      not interactive?(opts) ->
        {:ok, %{}}

      not is_map(ask) ->
        {:ok, %{}}

      true ->
        install_ask_user_hook(workspace, ask)
    end
  end

  defp install_ask_user_hook(workspace, ask) when is_map(ask) do
    token = Map.get(ask, :token) || Map.get(ask, "token")
    channel_pid = Map.get(ask, :channel_pid) || Map.get(ask, "channel_pid")
    thread_id = Map.get(ask, :thread_id) || Map.get(ask, "thread_id")
    base_url = ToolGateway.loopback_base_url()

    cond do
      not is_binary(token) or token == "" ->
        {:error, :ask_user_token_required}

      not is_pid(channel_pid) ->
        {:error, :ask_user_channel_required}

      not is_binary(base_url) ->
        {:error, :ask_user_gateway_unavailable}

      true ->
        UserInputBroker.ensure_started()

        :ok =
          UserInputBroker.bind_session(token, %{
            channel_pid: channel_pid,
            thread_id: thread_id,
            agent: "claude"
          })

        settings_dir = Path.join([Path.expand(workspace), ".symphony", "ask-user-#{token}"])

        case AskUserHook.write_settings!(settings_dir,
               session_token: token,
               gateway_base_url: base_url,
               timeout_ms: Map.get(ask, :timeout_ms) || Map.get(ask, "timeout_ms") || 300_000
             ) do
          {:ok, settings_path} ->
            {:ok, %{token: token, settings_path: settings_path}}
        end
    end
  end

  # The CLI prefixes MCP tools as mcp__symphony__<name>; executors know bare names.
  defp wrap_executor(executor) do
    fn name, arguments ->
      executor.(String.replace_prefix(name, "mcp__symphony__", ""), arguments)
    end
  end

  defp maybe_preflight_goal_command(workspace, command, opts) do
    if Keyword.get(opts, :goal_role) in [:execution, :authoring],
      do: AgentAvailability.claude_goal_preflight(workspace, command),
      else: :ok
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

  defp usage_metadata(%{"method" => "usage/update", "params" => %{"usage" => usage}}), do: %{usage: usage}
  defp usage_metadata(_notification), do: %{}

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
    raw = event[:usage] || Map.get(event, "usage")

    usage =
      if is_map(raw) do
        input =
          token_value(
            raw,
            ~w(input_tokens prompt_tokens inputTokens promptTokens)a ++
              ~w(input_tokens prompt_tokens inputTokens promptTokens)
          )

        output =
          token_value(
            raw,
            ~w(output_tokens completion_tokens outputTokens completionTokens)a ++
              ~w(output_tokens completion_tokens outputTokens completionTokens)
          )

        total = token_value(raw, ~w(total_tokens total totalTokens)a ++ ~w(total_tokens total totalTokens))

        if input || output || total do
          %{input_tokens: input || 0, output_tokens: output || 0, total_tokens: total || 0}
        end
      end

    Map.put(event, :usage, usage)
  end

  defp normalize_rate_limits(event) do
    raw = event[:rate_limits] || Map.get(event, "rate_limits")
    Map.put(event, :rate_limits, raw)
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
    effort = session.effort || Keyword.get(opts, :effort)

    SessionTranscript.write_sidecar(:claude, session.workspace, %{
      "session_id" => session.cli_session_id,
      "agent_kind" => "claude",
      "model" => model,
      "effort" => effort,
      "path" => SessionTranscript.path(:claude, session.workspace)
    })
  end

  defp emit_message(on_message, event, details, metadata) when is_function(on_message, 1) do
    message = metadata |> Map.merge(details) |> Map.put(:event, event) |> Map.put(:timestamp, DateTime.utc_now())
    on_message.(message)
  end

  defp default_on_message(_message), do: :ok
end
