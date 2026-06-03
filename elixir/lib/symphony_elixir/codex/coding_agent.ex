defmodule SymphonyElixir.Codex.CodingAgent do
  @moduledoc """
  Minimal client for the Codex app-server JSON-RPC 2.0 stream over stdio.
  """

  @version Mix.Project.config()[:version]

  @behaviour SymphonyElixir.CodingAgent

  require Logger
  alias SymphonyElixir.Codex.Config, as: CodexConfig
  alias SymphonyElixir.Codex.DynamicTool
  alias SymphonyElixir.Codex.Session
  alias SymphonyElixir.Config

  @initialize_id 1
  @thread_start_id 2
  @turn_start_id 3
  @goal_set_id 4
  @steer_base_id 100
  @default_max_goal_turns 50
  @max_goal_turns_cap 500
  @port_line_bytes 1_048_576
  @max_stream_log_bytes 1_000
  @non_interactive_tool_input_answer "This is a non-interactive session. Operator input is unavailable."
  @goal_continuation_prompt "Continue working toward the active goal. Review prior progress, continue from the current workspace state, and stop when the goal is complete or blocked."

  @type session :: %{
          port: port(),
          metadata: map(),
          approval_policy: String.t() | map(),
          auto_approve_requests: boolean(),
          thread_sandbox: String.t(),
          turn_sandbox_policy: map(),
          thread_id: String.t(),
          workspace: Path.t()
        }

  @spec run(Path.t(), String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def run(workspace, prompt, issue, opts \\ []) do
    with {:ok, session} <- start_session(workspace, opts) do
      try do
        run_turn(session, prompt, issue, opts)
      after
        stop_session(session)
      end
    end
  end

  @spec start_session(Path.t(), keyword()) :: {:ok, session()} | {:error, term()}
  def start_session(workspace, opts \\ []) do
    with :ok <- validate_workspace_cwd(workspace),
         {:ok, port} <- start_port(workspace) do
      metadata = port_metadata(port)
      expanded_workspace = Path.expand(workspace)

      with {:ok, session_policies} <- session_policies(expanded_workspace),
           {:ok, thread_id} <- do_start_session(port, expanded_workspace, session_policies, opts) do
        goal_state = maybe_set_goal(port, thread_id, Keyword.get(opts, :goal))
        Session.write(expanded_workspace, thread_id)

        {:ok,
         %{
           port: port,
           metadata: metadata,
           approval_policy: session_policies.approval_policy,
           auto_approve_requests: session_policies.approval_policy == "never",
           thread_sandbox: session_policies.thread_sandbox,
           turn_sandbox_policy: session_policies.turn_sandbox_policy,
           thread_id: thread_id,
           workspace: expanded_workspace,
           goal_active: goal_state == :active,
           goal_attempted: goal_state != :not_requested
         }}
      else
        {:error, reason} ->
          stop_port(port)
          {:error, reason}
      end
    end
  end

  @spec run_turn(session(), String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def run_turn(%{} = session, prompt, issue, opts \\ []) do
    on_message = Keyword.get(opts, :on_message, &default_on_message/1)

    tool_executor =
      Keyword.get(opts, :tool_executor, fn tool, arguments ->
        DynamicTool.execute(tool, arguments)
      end)

    goal_active = ensure_goal_active(session, opts)
    max_goal_turns = max_goal_turns(opts)

    run_goal_turns(
      session,
      prompt,
      issue,
      opts,
      on_message,
      tool_executor,
      goal_active,
      max_goal_turns,
      1
    )
  end

  defp run_goal_turns(
         session,
         prompt,
         issue,
         opts,
         on_message,
         tool_executor,
         goal_active,
         max_goal_turns,
         turn_number
       ) do
    case run_single_turn(session, prompt, issue, opts, on_message, tool_executor) do
      {:ok, turn_session} ->
        case next_goal_turn_action(goal_active, turn_session, turn_number, max_goal_turns) do
          :continue ->
            Logger.info("Continuing Codex goal for #{issue_context(issue)} turn=#{turn_number + 1}/#{max_goal_turns}")

            run_goal_turns(
              session,
              @goal_continuation_prompt,
              issue,
              opts,
              on_message,
              tool_executor,
              goal_active,
              max_goal_turns,
              turn_number + 1
            )

          :budget_exhausted ->
            Logger.info("Codex goal turn budget exhausted for #{issue_context(issue)} max_goal_turns=#{max_goal_turns}")

            {:ok, Map.put(turn_session, :goal_turns, turn_number)}

          :stop ->
            {:ok, Map.put(turn_session, :goal_turns, turn_number)}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp run_single_turn(
         %{
           port: port,
           metadata: metadata,
           approval_policy: approval_policy,
           auto_approve_requests: auto_approve_requests,
           turn_sandbox_policy: turn_sandbox_policy,
           thread_id: thread_id,
           workspace: workspace
         },
         prompt,
         issue,
         opts,
         on_message,
         tool_executor
       ) do
    case start_turn(port, thread_id, prompt, issue, workspace, approval_policy, turn_sandbox_policy, opts) do
      {:ok, turn_id} ->
        session_id = "#{thread_id}-#{turn_id}"
        Logger.info("Codex session started for #{issue_context(issue)} session_id=#{session_id}")

        emit_message(
          on_message,
          :session_started,
          %{
            session_id: session_id,
            thread_id: thread_id,
            turn_id: turn_id
          },
          metadata
        )

        turn_ctx = %{
          thread_id: thread_id,
          turn_id: turn_id,
          next_id: @steer_base_id,
          pending: %{},
          interactive_user_input: Keyword.get(opts, :interactive_user_input, false)
        }

        case await_turn_completion(port, on_message, tool_executor, auto_approve_requests, turn_ctx) do
          {:ok, completion_payload} ->
            Logger.info("Codex session completed for #{issue_context(issue)} session_id=#{session_id}")

            {:ok,
             %{
               result: :turn_completed,
               completion_payload: completion_payload,
               session_id: session_id,
               thread_id: thread_id,
               turn_id: turn_id
             }}

          {:error, reason} ->
            Logger.warning("Codex session ended with error for #{issue_context(issue)} session_id=#{session_id}: #{inspect(reason)}")

            emit_message(
              on_message,
              :turn_ended_with_error,
              %{
                session_id: session_id,
                reason: reason
              },
              metadata
            )

            {:error, reason}
        end

      {:error, reason} ->
        Logger.error("Codex session failed for #{issue_context(issue)}: #{inspect(reason)}")
        emit_message(on_message, :startup_failed, %{reason: reason}, metadata)
        {:error, reason}
    end
  end

  defp next_goal_turn_action(false, _turn_session, _turn_number, _max_goal_turns), do: :stop

  defp next_goal_turn_action(true, %{completion_payload: completion_payload}, turn_number, max_goal_turns) do
    case goal_status_from_completion(completion_payload) do
      :active when turn_number < max_goal_turns -> :continue
      :active -> :budget_exhausted
      _status -> :stop
    end
  end

  defp ensure_goal_active(%{goal_active: true}, _opts), do: true
  defp ensure_goal_active(%{goal_attempted: true}, _opts), do: false

  defp ensure_goal_active(%{port: port, thread_id: thread_id}, opts) do
    maybe_set_goal(port, thread_id, Keyword.get(opts, :goal)) == :active
  end

  defp ensure_goal_active(_session, _opts), do: false

  defp max_goal_turns(opts) do
    case Keyword.get(opts, :max_goal_turns, @default_max_goal_turns) do
      value when is_integer(value) and value > 0 -> min(value, @max_goal_turns_cap)
      _value -> @default_max_goal_turns
    end
  end

  # Supported Codex completion status shapes for goal continuation.
  defp goal_status_from_completion(payload) when is_map(payload) do
    [
      ["params", "goal", "status"],
      ["params", "goalStatus"],
      ["goal", "status"],
      ["goalStatus"]
    ]
    |> Enum.find_value(fn path -> payload |> dig(path) |> normalize_goal_status() end)
    |> case do
      nil -> :unknown
      status -> status
    end
  end

  defp goal_status_from_completion(_payload), do: :unknown

  defp normalize_goal_status(status) when is_binary(status) do
    status
    |> String.trim()
    |> String.downcase()
    |> case do
      "active" -> :active
      "in_progress" -> :active
      "in-progress" -> :active
      "running" -> :active
      "pending" -> :active
      "completed" -> :completed
      "complete" -> :completed
      "done" -> :completed
      "satisfied" -> :completed
      "blocked" -> :blocked
      "failed" -> :blocked
      "cancelled" -> :blocked
      "canceled" -> :blocked
      _other -> nil
    end
  end

  defp normalize_goal_status(_status), do: nil

  @spec stop_session(session()) :: :ok
  def stop_session(%{port: port}) when is_port(port) do
    stop_port(port)
  end

  defp validate_workspace_cwd(workspace) when is_binary(workspace) do
    workspace_path = Path.expand(workspace)
    workspace_root = Path.expand(Config.workspace_root())

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

  defp start_port(workspace) do
    executable = System.find_executable("bash")

    if is_nil(executable) do
      {:error, :bash_not_found}
    else
      port =
        Port.open(
          {:spawn_executable, String.to_charlist(executable)},
          [
            :binary,
            :exit_status,
            :stderr_to_stdout,
            args: [~c"-lc", String.to_charlist(SymphonyElixir.Codex.Config.command())],
            cd: String.to_charlist(workspace),
            line: @port_line_bytes
          ]
        )

      {:ok, port}
    end
  end

  defp port_metadata(port) when is_port(port) do
    case :erlang.port_info(port, :os_pid) do
      {:os_pid, os_pid} ->
        %{codex_app_server_pid: to_string(os_pid)}

      _ ->
        %{}
    end
  end

  defp send_initialize(port) do
    payload = %{
      "method" => "initialize",
      "id" => @initialize_id,
      "params" => %{
        "capabilities" => %{
          "experimentalApi" => true
        },
        "clientInfo" => %{
          "name" => "symphony-orchestrator",
          "title" => "Symphony Orchestrator",
          "version" => @version
        }
      }
    }

    send_message(port, payload)

    with {:ok, _} <- await_response(port, @initialize_id) do
      send_message(port, %{"method" => "initialized", "params" => %{}})
      :ok
    end
  end

  defp session_policies(workspace) do
    SymphonyElixir.Codex.Config.runtime_settings(workspace)
  end

  defp do_start_session(port, workspace, session_policies, opts) do
    case send_initialize(port) do
      :ok -> start_thread(port, workspace, session_policies, opts)
      {:error, reason} -> {:error, reason}
    end
  end

  defp start_thread(port, workspace, %{approval_policy: approval_policy, thread_sandbox: thread_sandbox}, opts) do
    send_message(port, %{
      "method" => "thread/start",
      "id" => @thread_start_id,
      "params" => %{
        "approvalPolicy" => approval_policy,
        "sandbox" => thread_sandbox,
        "cwd" => Path.expand(workspace),
        "dynamicTools" => Keyword.get(opts, :dynamic_tools, DynamicTool.tool_specs())
      }
    })

    case await_response(port, @thread_start_id) do
      {:ok, %{"thread" => thread_payload}} ->
        case thread_payload do
          %{"id" => thread_id} -> {:ok, thread_id}
          _ -> {:error, {:invalid_thread_payload, thread_payload}}
        end

      other ->
        other
    end
  end

  defp maybe_set_goal(_port, _thread_id, nil), do: :not_requested

  defp maybe_set_goal(port, thread_id, goal) when is_binary(goal) do
    goal = String.trim(goal)

    if goal == "" do
      :inactive
    else
      set_goal(port, thread_id, goal)
    end
  end

  defp maybe_set_goal(_port, thread_id, _goal) do
    Logger.warning("Codex goal option must be a string; continuing with single-turn session thread_id=#{thread_id}")

    :inactive
  end

  defp set_goal(port, thread_id, goal) do
    if CodexConfig.goals_enabled?() do
      send_message(port, %{
        "method" => "thread/goal/set",
        "id" => @goal_set_id,
        "params" => %{"threadId" => thread_id, "goal" => goal}
      })

      case await_response(port, @goal_set_id) do
        {:ok, _result} ->
          :active

        {:error, reason} ->
          Logger.warning("Codex failed to set thread goal; continuing with single-turn session thread_id=#{thread_id}: #{inspect(reason)}")

          :inactive
      end
    else
      Logger.warning("Codex goal provided but goal mode is disabled; continuing with single-turn session thread_id=#{thread_id}")

      :inactive
    end
  end

  defp turn_input(prompt, attachments) do
    alias SymphonyElixir.Assistant.Payload

    Payload.turn_input_items(prompt, attachments)
  end

  defp maybe_put_param(params, _key, nil), do: params
  defp maybe_put_param(params, _key, ""), do: params
  defp maybe_put_param(params, key, value), do: Map.put(params, key, value)

  defp reasoning_effort(nil), do: nil
  defp reasoning_effort(effort) when is_binary(effort), do: effort

  defp start_turn(port, thread_id, prompt, issue, workspace, approval_policy, turn_sandbox_policy, opts) do
    attachments = Keyword.get(opts, :attachments, [])

    params =
      %{
        "threadId" => thread_id,
        "input" => turn_input(prompt, attachments),
        "cwd" => Path.expand(workspace),
        "title" => "#{issue.identifier}: #{issue.title}",
        "approvalPolicy" => approval_policy,
        "sandboxPolicy" => turn_sandbox_policy
      }
      |> maybe_put_param("model", Keyword.get(opts, :model))
      |> maybe_put_param("reasoningEffort", reasoning_effort(Keyword.get(opts, :effort)))

    send_message(port, %{
      "method" => "turn/start",
      "id" => @turn_start_id,
      "params" => params
    })

    case await_response(port, @turn_start_id) do
      {:ok, %{"turn" => %{"id" => turn_id}}} -> {:ok, turn_id}
      other -> other
    end
  end

  defp await_turn_completion(port, on_message, tool_executor, auto_approve_requests, turn_ctx) do
    receive_loop(port, on_message, Config.agent_turn_timeout_ms(), "", tool_executor, auto_approve_requests, turn_ctx)
  end

  defp receive_loop(port, on_message, timeout_ms, pending_line, tool_executor, auto_approve_requests, turn_ctx) do
    receive do
      {^port, {:data, {:eol, chunk}}} ->
        complete_line = pending_line <> to_string(chunk)
        handle_incoming(port, on_message, complete_line, timeout_ms, tool_executor, auto_approve_requests, turn_ctx)

      {^port, {:data, {:noeol, chunk}}} ->
        receive_loop(
          port,
          on_message,
          timeout_ms,
          pending_line <> to_string(chunk),
          tool_executor,
          auto_approve_requests,
          turn_ctx
        )

      {^port, {:exit_status, status}} ->
        {:error, {:port_exit, status}}

      {:codex_steer, input, reply_to} ->
        turn_ctx = send_steer(port, turn_ctx, input, reply_to)
        receive_loop(port, on_message, timeout_ms, pending_line, tool_executor, auto_approve_requests, turn_ctx)

      {:codex_user_input, request_id, answers, reply_to} ->
        send_message(port, %{"id" => request_id, "result" => %{"answers" => answers}})
        if is_pid(reply_to), do: send(reply_to, {:user_input_ok, request_id})
        receive_loop(port, on_message, timeout_ms, pending_line, tool_executor, auto_approve_requests, turn_ctx)

      {:codex_interrupt} ->
        send_interrupt(port, turn_ctx)
        receive_loop(port, on_message, timeout_ms, pending_line, tool_executor, auto_approve_requests, turn_ctx)
    after
      timeout_ms ->
        {:error, :turn_timeout}
    end
  end

  defp send_steer(port, %{thread_id: thread_id, turn_id: turn_id, next_id: next_id, pending: pending} = turn_ctx, input, reply_to) do
    send_message(port, %{
      "method" => "turn/steer",
      "id" => next_id,
      "params" => %{
        "threadId" => thread_id,
        "expectedTurnId" => turn_id,
        "input" => input
      }
    })

    %{turn_ctx | next_id: next_id + 1, pending: Map.put(pending, next_id, reply_to)}
  end

  defp send_interrupt(port, %{thread_id: thread_id, turn_id: turn_id, next_id: next_id}) do
    send_message(port, %{
      "method" => "turn/interrupt",
      "id" => next_id,
      "params" => %{"threadId" => thread_id, "turnId" => turn_id}
    })

    :ok
  end

  defp handle_incoming(port, on_message, data, timeout_ms, tool_executor, auto_approve_requests, turn_ctx) do
    payload_string = to_string(data)

    case Jason.decode(payload_string) do
      {:ok, %{"method" => "turn/completed"} = payload} ->
        emit_turn_event(on_message, :turn_completed, payload, payload_string, port, payload)
        {:ok, payload}

      {:ok, %{"method" => "turn/failed", "params" => _} = payload} ->
        emit_turn_event(
          on_message,
          :turn_failed,
          payload,
          payload_string,
          port,
          Map.get(payload, "params")
        )

        {:error, {:turn_failed, Map.get(payload, "params")}}

      {:ok, %{"method" => "turn/cancelled", "params" => _} = payload} ->
        emit_turn_event(
          on_message,
          :turn_cancelled,
          payload,
          payload_string,
          port,
          Map.get(payload, "params")
        )

        {:error, {:turn_cancelled, Map.get(payload, "params")}}

      {:ok, %{"id" => id} = payload} when is_map_key(turn_ctx.pending, id) ->
        turn_ctx = route_steer_response(turn_ctx, id, payload)
        receive_loop(port, on_message, timeout_ms, "", tool_executor, auto_approve_requests, turn_ctx)

      {:ok, %{"method" => method} = payload}
      when is_binary(method) ->
        handle_turn_method(
          port,
          on_message,
          payload,
          payload_string,
          method,
          timeout_ms,
          tool_executor,
          auto_approve_requests,
          turn_ctx
        )

      {:ok, payload} ->
        emit_message(
          on_message,
          :other_message,
          %{
            payload: payload,
            raw: payload_string
          },
          metadata_from_message(port, payload)
        )

        receive_loop(port, on_message, timeout_ms, "", tool_executor, auto_approve_requests, turn_ctx)

      {:error, _reason} ->
        log_non_json_stream_line(payload_string, "turn stream")

        emit_message(
          on_message,
          :malformed,
          %{
            payload: payload_string,
            raw: payload_string
          },
          metadata_from_message(port, %{raw: payload_string})
        )

        receive_loop(port, on_message, timeout_ms, "", tool_executor, auto_approve_requests, turn_ctx)
    end
  end

  defp route_steer_response(%{pending: pending} = turn_ctx, id, payload) do
    {reply_to, rest} = Map.pop(pending, id)

    if is_pid(reply_to) do
      case payload do
        %{"error" => error} -> send(reply_to, {:steer_error, error})
        %{"result" => result} -> send(reply_to, {:steer_ok, result})
        _ -> :ok
      end
    end

    %{turn_ctx | pending: rest}
  end

  defp emit_turn_event(on_message, event, payload, payload_string, port, payload_details) do
    emit_message(
      on_message,
      event,
      %{
        payload: payload,
        raw: payload_string,
        details: payload_details
      },
      metadata_from_message(port, payload)
    )
  end

  defp handle_turn_method(
         port,
         on_message,
         payload,
         payload_string,
         method,
         timeout_ms,
         tool_executor,
         auto_approve_requests,
         turn_ctx
       ) do
    metadata = metadata_from_message(port, payload)

    case maybe_handle_approval_request(
           port,
           method,
           payload,
           payload_string,
           on_message,
           metadata,
           tool_executor,
           auto_approve_requests,
           Map.get(turn_ctx, :interactive_user_input, false)
         ) do
      :input_required ->
        emit_message(
          on_message,
          :turn_input_required,
          %{payload: payload, raw: payload_string},
          metadata
        )

        {:error, {:turn_input_required, payload}}

      :awaiting_user_input ->
        receive_loop(port, on_message, timeout_ms, "", tool_executor, auto_approve_requests, turn_ctx)

      :approved ->
        receive_loop(port, on_message, timeout_ms, "", tool_executor, auto_approve_requests, turn_ctx)

      :approval_required ->
        emit_message(
          on_message,
          :approval_required,
          %{payload: payload, raw: payload_string},
          metadata
        )

        {:error, {:approval_required, payload}}

      :unhandled ->
        if needs_input?(method, payload) do
          emit_message(
            on_message,
            :turn_input_required,
            %{payload: payload, raw: payload_string},
            metadata
          )

          {:error, {:turn_input_required, payload}}
        else
          emit_message(
            on_message,
            :notification,
            %{
              payload: payload,
              raw: payload_string
            },
            metadata
          )

          Logger.debug("Codex notification: #{inspect(method)}")
          receive_loop(port, on_message, timeout_ms, "", tool_executor, auto_approve_requests, turn_ctx)
        end
    end
  end

  defp maybe_handle_approval_request(
         port,
         "item/commandExecution/requestApproval",
         %{"id" => id} = payload,
         payload_string,
         on_message,
         metadata,
         _tool_executor,
         auto_approve_requests,
         _interactive_user_input
       ) do
    approve_or_require(
      port,
      id,
      "acceptForSession",
      payload,
      payload_string,
      on_message,
      metadata,
      auto_approve_requests
    )
  end

  defp maybe_handle_approval_request(
         port,
         "item/tool/call",
         %{"id" => id, "params" => params} = payload,
         payload_string,
         on_message,
         metadata,
         tool_executor,
         _auto_approve_requests,
         _interactive_user_input
       ) do
    tool_name = tool_call_name(params)
    arguments = tool_call_arguments(params)

    emit_message(on_message, :tool_call_started, %{payload: payload, raw: payload_string}, metadata)

    result = tool_executor.(tool_name, arguments)

    send_message(port, %{
      "id" => id,
      "result" => result
    })

    event =
      case result do
        %{"success" => true} -> :tool_call_completed
        _ when is_nil(tool_name) -> :unsupported_tool_call
        _ -> :tool_call_failed
      end

    emit_message(on_message, event, %{payload: payload, raw: payload_string, result: result}, metadata)

    :approved
  end

  defp maybe_handle_approval_request(
         port,
         "execCommandApproval",
         %{"id" => id} = payload,
         payload_string,
         on_message,
         metadata,
         _tool_executor,
         auto_approve_requests,
         _interactive_user_input
       ) do
    approve_or_require(
      port,
      id,
      "approved_for_session",
      payload,
      payload_string,
      on_message,
      metadata,
      auto_approve_requests
    )
  end

  defp maybe_handle_approval_request(
         port,
         "applyPatchApproval",
         %{"id" => id} = payload,
         payload_string,
         on_message,
         metadata,
         _tool_executor,
         auto_approve_requests,
         _interactive_user_input
       ) do
    approve_or_require(
      port,
      id,
      "approved_for_session",
      payload,
      payload_string,
      on_message,
      metadata,
      auto_approve_requests
    )
  end

  defp maybe_handle_approval_request(
         port,
         "item/fileChange/requestApproval",
         %{"id" => id} = payload,
         payload_string,
         on_message,
         metadata,
         _tool_executor,
         auto_approve_requests,
         _interactive_user_input
       ) do
    approve_or_require(
      port,
      id,
      "acceptForSession",
      payload,
      payload_string,
      on_message,
      metadata,
      auto_approve_requests
    )
  end

  defp maybe_handle_approval_request(
         port,
         "item/tool/requestUserInput",
         %{"id" => id, "params" => params} = payload,
         payload_string,
         on_message,
         metadata,
         _tool_executor,
         auto_approve_requests,
         interactive_user_input
       ) do
    maybe_auto_answer_tool_request_user_input(
      port,
      id,
      params,
      payload,
      payload_string,
      on_message,
      metadata,
      auto_approve_requests,
      interactive_user_input
    )
  end

  defp maybe_handle_approval_request(
         _port,
         _method,
         _payload,
         _payload_string,
         _on_message,
         _metadata,
         _tool_executor,
         _auto_approve_requests,
         _interactive_user_input
       ) do
    :unhandled
  end

  defp approve_or_require(
         port,
         id,
         decision,
         payload,
         payload_string,
         on_message,
         metadata,
         true
       ) do
    send_message(port, %{"id" => id, "result" => %{"decision" => decision}})

    emit_message(
      on_message,
      :approval_auto_approved,
      %{payload: payload, raw: payload_string, decision: decision},
      metadata
    )

    :approved
  end

  defp approve_or_require(
         _port,
         _id,
         _decision,
         _payload,
         _payload_string,
         _on_message,
         _metadata,
         false
       ) do
    :approval_required
  end

  defp maybe_auto_answer_tool_request_user_input(
         port,
         id,
         params,
         payload,
         payload_string,
         on_message,
         metadata,
         auto_approve_requests,
         interactive_user_input
       ) do
    approval = tool_request_user_input_approval_answers(params)

    cond do
      auto_approve_requests and match?({:ok, _, _}, approval) ->
        {:ok, answers, decision} = approval
        send_message(port, %{"id" => id, "result" => %{"answers" => answers}})

        emit_message(
          on_message,
          :approval_auto_approved,
          %{payload: payload, raw: payload_string, decision: decision},
          metadata
        )

        :approved

      interactive_user_input ->
        emit_message(
          on_message,
          :user_input_required,
          %{
            payload: payload,
            raw: payload_string,
            request_id: id,
            item_id: Map.get(params, "itemId"),
            questions: Map.get(params, "questions") || []
          },
          metadata
        )

        :awaiting_user_input

      true ->
        reply_with_non_interactive_tool_input_answer(
          port,
          id,
          params,
          payload,
          payload_string,
          on_message,
          metadata
        )
    end
  end

  defp tool_request_user_input_approval_answers(%{"questions" => questions}) when is_list(questions) do
    answers =
      Enum.reduce_while(questions, %{}, fn question, acc ->
        case tool_request_user_input_approval_answer(question) do
          {:ok, question_id, answer_label} ->
            {:cont, Map.put(acc, question_id, %{"answers" => [answer_label]})}

          :error ->
            {:halt, :error}
        end
      end)

    case answers do
      :error -> :error
      answer_map when map_size(answer_map) > 0 -> {:ok, answer_map, "Approve this Session"}
      _ -> :error
    end
  end

  defp tool_request_user_input_approval_answers(_params), do: :error

  defp reply_with_non_interactive_tool_input_answer(
         port,
         id,
         params,
         payload,
         payload_string,
         on_message,
         metadata
       ) do
    case tool_request_user_input_unavailable_answers(params) do
      {:ok, answers} ->
        send_message(port, %{"id" => id, "result" => %{"answers" => answers}})

        emit_message(
          on_message,
          :tool_input_auto_answered,
          %{payload: payload, raw: payload_string, answer: @non_interactive_tool_input_answer},
          metadata
        )

        :approved

      :error ->
        :input_required
    end
  end

  defp tool_request_user_input_unavailable_answers(%{"questions" => questions}) when is_list(questions) do
    answers =
      Enum.reduce_while(questions, %{}, fn question, acc ->
        case tool_request_user_input_question_id(question) do
          {:ok, question_id} ->
            {:cont, Map.put(acc, question_id, %{"answers" => [@non_interactive_tool_input_answer]})}

          :error ->
            {:halt, :error}
        end
      end)

    case answers do
      :error -> :error
      answer_map when map_size(answer_map) > 0 -> {:ok, answer_map}
      _ -> :error
    end
  end

  defp tool_request_user_input_unavailable_answers(_params), do: :error

  defp tool_request_user_input_question_id(%{"id" => question_id}) when is_binary(question_id),
    do: {:ok, question_id}

  defp tool_request_user_input_question_id(_question), do: :error

  defp tool_request_user_input_approval_answer(%{"id" => question_id, "options" => options})
       when is_binary(question_id) and is_list(options) do
    case tool_request_user_input_approval_option_label(options) do
      nil -> :error
      answer_label -> {:ok, question_id, answer_label}
    end
  end

  defp tool_request_user_input_approval_answer(_question), do: :error

  defp tool_request_user_input_approval_option_label(options) do
    options
    |> Enum.map(&tool_request_user_input_option_label/1)
    |> Enum.reject(&is_nil/1)
    |> case do
      labels ->
        Enum.find(labels, &(&1 == "Approve this Session")) ||
          Enum.find(labels, &(&1 == "Approve Once")) ||
          Enum.find(labels, &approval_option_label?/1)
    end
  end

  defp tool_request_user_input_option_label(%{"label" => label}) when is_binary(label), do: label
  defp tool_request_user_input_option_label(_option), do: nil

  defp approval_option_label?(label) when is_binary(label) do
    normalized_label =
      label
      |> String.trim()
      |> String.downcase()

    String.starts_with?(normalized_label, "approve") or String.starts_with?(normalized_label, "allow")
  end

  defp await_response(port, request_id) do
    with_timeout_response(port, request_id, Config.agent_read_timeout_ms(), "")
  end

  defp with_timeout_response(port, request_id, timeout_ms, pending_line) do
    receive do
      {^port, {:data, {:eol, chunk}}} ->
        complete_line = pending_line <> to_string(chunk)
        handle_response(port, request_id, complete_line, timeout_ms)

      {^port, {:data, {:noeol, chunk}}} ->
        with_timeout_response(port, request_id, timeout_ms, pending_line <> to_string(chunk))

      {^port, {:exit_status, status}} ->
        {:error, {:port_exit, status}}
    after
      timeout_ms ->
        {:error, :response_timeout}
    end
  end

  defp handle_response(port, request_id, data, timeout_ms) do
    payload = to_string(data)

    case Jason.decode(payload) do
      {:ok, %{"id" => ^request_id, "error" => error}} ->
        {:error, {:response_error, error}}

      {:ok, %{"id" => ^request_id, "result" => result}} ->
        {:ok, result}

      {:ok, %{"id" => ^request_id} = response_payload} ->
        {:error, {:response_error, response_payload}}

      {:ok, %{} = other} ->
        Logger.debug("Ignoring message while waiting for response: #{inspect(other)}")
        with_timeout_response(port, request_id, timeout_ms, "")

      {:error, _} ->
        log_non_json_stream_line(payload, "response stream")
        with_timeout_response(port, request_id, timeout_ms, "")
    end
  end

  defp log_non_json_stream_line(data, stream_label) do
    text =
      data
      |> to_string()
      |> String.trim()
      |> String.slice(0, @max_stream_log_bytes)

    if text != "" do
      if String.match?(text, ~r/\b(error|warn|warning|failed|fatal|panic|exception)\b/i) do
        Logger.warning("Codex #{stream_label} output: #{text}")
      else
        Logger.debug("Codex #{stream_label} output: #{text}")
      end
    end
  end

  defp issue_context(%{id: issue_id, identifier: identifier}) do
    "issue_id=#{issue_id} issue_identifier=#{identifier}"
  end

  defp stop_port(port) when is_port(port) do
    case :erlang.port_info(port) do
      :undefined ->
        :ok

      _ ->
        try do
          Port.close(port)
          :ok
        rescue
          ArgumentError ->
            :ok
        end
    end
  end

  @spec normalize_event(map()) :: map()
  def normalize_event(event) when is_map(event) do
    event
    |> normalize_usage()
    |> normalize_rate_limits()
  end

  defp normalize_usage(event) do
    payloads = [
      event[:usage],
      Map.get(event, "usage"),
      event[:payload],
      Map.get(event, "payload"),
      event
    ]

    usage =
      Enum.find_value(payloads, &absolute_token_usage/1) ||
        Enum.find_value(payloads, &turn_completed_usage/1) ||
        Enum.find_value(payloads, &direct_token_map/1)

    Map.put(event, :usage, canonicalize_usage(usage))
  end

  defp normalize_rate_limits(event) do
    raw =
      find_rate_limits(event[:rate_limits]) ||
        find_rate_limits(Map.get(event, "rate_limits")) ||
        find_rate_limits(event[:payload]) ||
        find_rate_limits(Map.get(event, "payload")) ||
        find_rate_limits(event)

    Map.put(event, :rate_limits, raw)
  end

  defp absolute_token_usage(payload) when is_map(payload) do
    paths = [
      ["params", "msg", "payload", "info", "total_token_usage"],
      [:params, :msg, :payload, :info, :total_token_usage],
      ["params", "msg", "info", "total_token_usage"],
      [:params, :msg, :info, :total_token_usage],
      ["params", "tokenUsage", "total"],
      [:params, :tokenUsage, :total],
      ["tokenUsage", "total"],
      [:tokenUsage, :total]
    ]

    Enum.find_value(paths, fn path ->
      value = dig(payload, path)
      if is_map(value) and has_token_field?(value), do: value
    end)
  end

  defp absolute_token_usage(_), do: nil

  defp turn_completed_usage(payload) when is_map(payload) do
    method = Map.get(payload, "method") || Map.get(payload, :method)

    if method in ["turn/completed", :turn_completed] do
      direct =
        Map.get(payload, "usage") || Map.get(payload, :usage) ||
          dig(payload, ["params", "usage"]) || dig(payload, [:params, :usage])

      if is_map(direct) and has_token_field?(direct), do: direct
    end
  end

  defp turn_completed_usage(_), do: nil

  defp direct_token_map(payload) when is_map(payload) do
    if has_token_field?(payload), do: payload
  end

  defp direct_token_map(_), do: nil

  defp canonicalize_usage(nil), do: nil

  defp canonicalize_usage(raw) when is_map(raw) do
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

  defp has_token_field?(map) when is_map(map) do
    token_keys =
      ~w(input_tokens output_tokens total_tokens prompt_tokens completion_tokens
                    inputTokens outputTokens totalTokens promptTokens completionTokens)a ++
        ~w(input_tokens output_tokens total_tokens prompt_tokens completion_tokens
                    inputTokens outputTokens totalTokens promptTokens completionTokens)

    Enum.any?(token_keys, fn key ->
      map |> Map.get(key) |> token_like_value?()
    end)
  end

  defp has_token_field?(_), do: false

  defp token_like_value?(v) when is_integer(v) and v >= 0, do: true

  defp token_like_value?(v) when is_binary(v) do
    case Integer.parse(String.trim(v)) do
      {n, _} when n >= 0 -> true
      _ -> false
    end
  end

  defp token_like_value?(_), do: false

  defp find_rate_limits(payload) when is_map(payload) do
    direct = Map.get(payload, "rate_limits") || Map.get(payload, :rate_limits)

    cond do
      rate_limits_map?(direct) -> direct
      rate_limits_map?(payload) -> payload
      true -> search_rate_limits(payload)
    end
  end

  defp find_rate_limits(_), do: nil

  defp search_rate_limits(payload) when is_map(payload) do
    Enum.find_value(Map.values(payload), fn
      value when is_map(value) -> find_rate_limits(value)
      _ -> nil
    end)
  end

  defp rate_limits_map?(payload) when is_map(payload) do
    has_id =
      !is_nil(
        Map.get(payload, "limit_id") || Map.get(payload, :limit_id) ||
          Map.get(payload, "limit_name") || Map.get(payload, :limit_name)
      )

    has_buckets =
      Enum.any?(
        ["primary", :primary, "secondary", :secondary, "credits", :credits],
        &Map.has_key?(payload, &1)
      )

    has_id and has_buckets
  end

  defp rate_limits_map?(_), do: false

  defp dig(map, []), do: map

  defp dig(map, [key | rest]) when is_map(map) do
    case Map.get(map, key) do
      nil -> nil
      value -> dig(value, rest)
    end
  end

  defp dig(_, _), do: nil

  defp emit_message(on_message, event, details, metadata) when is_function(on_message, 1) do
    message = metadata |> Map.merge(details) |> Map.put(:event, event) |> Map.put(:timestamp, DateTime.utc_now())
    on_message.(message)
  end

  defp metadata_from_message(port, payload) do
    port |> port_metadata() |> maybe_set_usage(payload)
  end

  defp maybe_set_usage(metadata, payload) when is_map(payload) do
    usage = Map.get(payload, "usage") || Map.get(payload, :usage)

    if is_map(usage) do
      Map.put(metadata, :usage, usage)
    else
      metadata
    end
  end

  defp maybe_set_usage(metadata, _payload), do: metadata

  defp default_on_message(_message), do: :ok

  defp tool_call_name(params) when is_map(params) do
    case Map.get(params, "tool") || Map.get(params, :tool) || Map.get(params, "name") || Map.get(params, :name) do
      name when is_binary(name) ->
        case String.trim(name) do
          "" -> nil
          trimmed -> trimmed
        end

      _ ->
        nil
    end
  end

  defp tool_call_name(_params), do: nil

  defp tool_call_arguments(params) when is_map(params) do
    Map.get(params, "arguments") || Map.get(params, :arguments) || %{}
  end

  defp tool_call_arguments(_params), do: %{}

  defp send_message(port, message) do
    line = Jason.encode!(message) <> "\n"
    Port.command(port, line)
  end

  defp needs_input?(method, payload)
       when is_binary(method) and is_map(payload) do
    String.starts_with?(method, "turn/") && input_required_method?(method, payload)
  end

  defp needs_input?(_method, _payload), do: false

  defp input_required_method?(method, payload) when is_binary(method) do
    method in [
      "turn/input_required",
      "turn/needs_input",
      "turn/need_input",
      "turn/request_input",
      "turn/request_response",
      "turn/provide_input",
      "turn/approval_required"
    ] || request_payload_requires_input?(payload)
  end

  defp request_payload_requires_input?(payload) do
    params = Map.get(payload, "params")
    needs_input_field?(payload) || needs_input_field?(params)
  end

  defp needs_input_field?(payload) when is_map(payload) do
    Map.get(payload, "requiresInput") == true or
      Map.get(payload, "needsInput") == true or
      Map.get(payload, "input_required") == true or
      Map.get(payload, "inputRequired") == true or
      Map.get(payload, "type") == "input_required" or
      Map.get(payload, "type") == "needs_input"
  end

  defp needs_input_field?(_payload), do: false
end
