defmodule SymphonyElixirWeb.AssistantChannel do
  @moduledoc "Realtime channel for provider-neutral tracker assistant chat."

  use Phoenix.Channel

  alias Phoenix.Socket

  alias SymphonyElixir.Agent.Error, as: AgentError

  alias SymphonyElixir.Assistant.{
    AuthoringGoalControl,
    AgentSession,
    GoalRun,
    History,
    Payload,
    SideQuery,
    ToolExecutor,
    TurnManager,
    UserInputBroker
  }

  alias SymphonyElixir.{
    AgentPreference,
    CodingAgent,
    Config,
    LocalTracker.Context,
    ProjectConfig,
    Repo,
    Settings,
    Workspace
  }

  alias SymphonyElixir.Claude.ApprovalBroker
  alias SymphonyElixir.Observability.Metrics
  alias SymphonyElixirWeb.TrackerAuth

  @issue_authoring_tools ~w(create_draft_issue create_issue)
  @tool_arguments_summary_max_length 200

  # Reload transcript guards: keep opening a workspace cheap by capping oversized
  # tool outputs and paging the message history instead of shipping the whole
  # thread at once. Full tool output stays fetchable via "fetch_tool_output";
  # older messages via "load_older_messages".
  @history_tool_output_cap_bytes 8_192
  @history_page_limit 40

  @impl true
  def join("assistant:issue:" <> raw_issue_topic, _payload, socket) do
    with true <- authorized?(socket),
         {:ok, project_slug, issue_identifier} <- parse_issue_topic(raw_issue_topic),
         {:ok, thread} <-
           History.ensure_issue_thread(project_slug, issue_identifier, %{
             workspace_path: Workspace.path_for_issue(issue_identifier)
           }) do
      # Reattach to any goal turn already in flight for this thread (e.g. started
      # before a page refresh): subscribe to the thread's run topic and surface the
      # running state + elapsed time in the join payload so the pill renders
      # "executing" with a live timer immediately, without waiting for a turn.
      TurnManager.subscribe(thread.id)

      payload =
        thread
        |> join_metadata_payload()
        |> Map.put(:effective_agent, thread_effective_agent(thread))

      socket =
        socket
        |> assign(:thread, thread)
        |> assign(:project_slug, thread.project_slug)
        |> assign(:issue_identifier, thread.issue_identifier)
        |> assign(:turn_execution_id, current_turn_execution_id(thread))
        |> remember_goal_status(payload.goal_status)

      send(self(), {:assistant_history_loaded, thread, payload})
      {:ok, payload, socket}
    else
      false -> {:error, assistant_error_payload("unauthorized")}
      {:error, reason} -> {:error, assistant_error_payload(reason)}
      _ -> {:error, assistant_error_payload("invalid_topic")}
    end
  end

  def join("assistant:explore:" <> raw_project_slug, _payload, socket) do
    with true <- authorized?(socket),
         {:ok, project_slug} <- decode_required_topic_segment(raw_project_slug, :project_slug),
         {:ok, thread} <- History.ensure_project_explore_thread(project_slug) do
      TurnManager.subscribe(thread.id)

      payload = join_metadata_payload(thread)

      socket =
        socket
        |> assign(:thread, thread)
        |> assign(:project_slug, thread.project_slug)
        |> assign(:turn_execution_id, current_turn_execution_id(thread))
        |> remember_goal_status(payload.goal_status)

      send(self(), {:assistant_history_loaded, thread, payload})
      {:ok, payload, socket}
    else
      false -> {:error, assistant_error_payload("unauthorized")}
      {:error, reason} -> {:error, assistant_error_payload(reason)}
      _ -> {:error, assistant_error_payload("invalid_topic")}
    end
  end

  def join("assistant:kb:" <> raw_kb_topic, _payload, socket) do
    with true <- authorized?(socket),
         {:ok, project_slug, repo_slug, page_path} <- parse_kb_topic(raw_kb_topic),
         {:ok, thread} <- History.ensure_kb_thread(project_slug, repo_slug, page_path) do
      TurnManager.subscribe(thread.id)

      payload = join_metadata_payload(thread)

      socket =
        socket
        |> assign(:thread, thread)
        |> assign(:project_slug, thread.project_slug)
        |> assign(:turn_execution_id, current_turn_execution_id(thread))
        |> remember_goal_status(payload.goal_status)

      send(self(), {:assistant_history_loaded, thread, payload})
      {:ok, payload, socket}
    else
      false -> {:error, assistant_error_payload("unauthorized")}
      {:error, reason} -> {:error, assistant_error_payload(reason)}
      _ -> {:error, assistant_error_payload("invalid_topic")}
    end
  end

  def join("assistant:thread:" <> raw_id, _payload, socket) do
    with true <- authorized?(socket),
         {:ok, id} <- parse_id(raw_id),
         {:ok, thread} <- History.get_thread(id) do
      TurnManager.subscribe(thread.id)

      payload = join_metadata_payload(thread)

      socket =
        socket
        |> assign(:thread, thread)
        |> assign(:project_slug, thread.project_slug)
        |> assign(:turn_execution_id, current_turn_execution_id(thread))
        |> remember_goal_status(payload.goal_status)

      send(self(), {:assistant_history_loaded, thread, payload})
      {:ok, payload, socket}
    else
      false -> {:error, assistant_error_payload("unauthorized")}
      {:error, :not_found} -> {:error, assistant_error_payload("thread not found")}
      _ -> {:error, assistant_error_payload("invalid_topic")}
    end
  end

  def join("assistant:" <> project_slug, _payload, socket) when project_slug != "" do
    with true <- authorized?(socket),
         {:ok, workspace} <- AgentSession.assistant_workspace(project_slug),
         {:ok, thread} <- History.ensure_thread(project_slug, %{workspace_path: workspace}) do
      TurnManager.subscribe(thread.id)

      payload = join_metadata_payload(thread)

      socket =
        socket
        |> assign(:thread, thread)
        |> assign(:project_slug, project_slug)
        |> assign(:turn_execution_id, current_turn_execution_id(thread))
        |> remember_goal_status(payload.goal_status)

      send(self(), {:assistant_history_loaded, thread, payload})
      {:ok, payload, socket}
    else
      false -> {:error, assistant_error_payload("unauthorized")}
      {:error, reason} -> {:error, assistant_error_payload(reason)}
    end
  end

  def join(_topic, _payload, _socket), do: {:error, assistant_error_payload("invalid_topic")}

  @impl true
  def handle_in("send_message", %{"message" => message} = payload, socket) when is_binary(message) do
    thread = socket.assigns[:thread]

    if socket.assigns[:turn_status] == :running and
         (is_nil(thread) or Map.get(thread, :scope) == "project") do
      {:reply, {:error, assistant_error_payload(:assistant_busy)}, socket}
    else
      case assistant_thread(socket) do
        {:ok, current_thread} -> do_send_message(message, payload, assign(socket, :thread, current_thread))
        {:error, reason} -> {:reply, {:error, assistant_error_payload(reason)}, socket}
      end
    end
  end

  def handle_in("send_message", _payload, socket), do: {:reply, {:error, assistant_error_payload("message is required")}, socket}

  def handle_in("sync_history", _payload, socket) do
    push_history_sync(socket)
    {:reply, :ok, socket}
  end

  def handle_in("load_older_messages", payload, socket) when is_map(payload) do
    with thread_id when is_integer(thread_id) <- thread_id_from_socket(socket),
         {:ok, before_sequence} <- parse_before_sequence(payload) do
      page =
        Metrics.span(
          [:assistant, :history],
          %{thread_id: thread_id, source: :older},
          fn -> older_messages_page(thread_id, before_sequence) end,
          &history_measurements/1
        )

      {:reply, {:ok, page}, socket}
    else
      nil -> {:reply, {:error, assistant_error_payload("thread is required")}, socket}
      :error -> {:reply, {:error, assistant_error_payload("before_sequence is required")}, socket}
    end
  end

  def handle_in("fetch_tool_output", %{"message_id" => message_id, "tool_call_id" => tool_call_id}, socket)
      when is_binary(tool_call_id) do
    with thread_id when is_integer(thread_id) <- thread_id_from_socket(socket),
         {:ok, parsed_message_id} <- parse_message_id(message_id),
         {:ok, tool_call_id} <- require_tool_call_id(tool_call_id),
         {:ok, result} <- History.tool_call_output(thread_id, parsed_message_id, tool_call_id) do
      {:reply,
       {:ok,
        %{
          message_id: parsed_message_id,
          tool_call_id: tool_call_id,
          output: result.output,
          output_byte_size: result.output_byte_size
        }}, socket}
    else
      nil -> {:reply, {:error, assistant_error_payload("thread is required")}, socket}
      :error -> {:reply, {:error, assistant_error_payload("message_id and tool_call_id are required")}, socket}
      {:error, :not_found} -> {:reply, {:error, assistant_error_payload("tool call not found")}, socket}
    end
  end

  def handle_in("fetch_tool_output", _payload, socket),
    do: {:reply, {:error, assistant_error_payload("message_id and tool_call_id are required")}, socket}

  def handle_in("stop_turn", _payload, socket) do
    case thread_id_from_socket(socket) do
      thread_id when is_integer(thread_id) ->
        case TurnManager.interrupt(thread_id, "user_stop") do
          :ok ->
            {:reply, :ok, socket}

          {:ok, :already_finished} ->
            # The backend turn already reached a terminal state while this tab still
            # renders a running indicator (its terminal stream event was lost, e.g. to
            # a replaced channel process). No interrupt broadcast is emitted in this
            # path, so push the current turn status directly to reconcile the stale
            # "Stop" affordance instead of leaving it hanging.
            {:reply, :ok, reconcile_finished_turn(socket, thread_id)}

          {:error, reason} ->
            {:reply, {:error, assistant_error_payload(reason)}, socket}
        end

      _ ->
        {:reply, {:error, assistant_error_payload("thread is required")}, socket}
    end
  end

  def handle_in("kill_tool", %{"tool_call_id" => tool_call_id}, socket) when is_binary(tool_call_id) do
    case {thread_id_from_socket(socket), normalize_tool_call_id(tool_call_id)} do
      {thread_id, tool_call_id} when is_integer(thread_id) and is_binary(tool_call_id) ->
        case TurnManager.kill_tool(thread_id, tool_call_id) do
          :ok -> {:reply, :ok, socket}
          {:error, reason} -> {:reply, {:error, kill_tool_error_payload(reason)}, socket}
        end

      {_thread_id, nil} ->
        {:reply, {:error, assistant_error_payload("tool_call_id is required")}, socket}

      _ ->
        {:reply, {:error, assistant_error_payload("thread is required")}, socket}
    end
  end

  def handle_in("kill_tool", _payload, socket),
    do: {:reply, {:error, assistant_error_payload("tool_call_id is required")}, socket}

  def handle_in("set_goal_mode", %{"goal_mode" => false}, socket) do
    start_async_goal_mutation(socket, :disable, false, &AuthoringGoalControl.clear/1)
  end

  def handle_in("set_goal_mode", %{"goal_mode" => true} = payload, socket) do
    objective = normalize_goal_objective(Map.get(payload, "objective"))
    turn_was_running = turn_running_for_thread?(socket)

    mutation = fn thread ->
      cond do
        is_binary(objective) and turn_was_running ->
          AuthoringGoalControl.set_objective_metadata(thread, objective)

        is_binary(objective) ->
          AuthoringGoalControl.set_objective(thread, objective)

        true ->
          AuthoringGoalControl.enable(thread, nil)
      end
    end

    with {:ok, _goal_payload, updated_thread} <- goal_mutation(socket, true, mutation) do
      socket = assign(socket, :thread, updated_thread)

      socket =
        schedule_authoritative_goal_status(socket,
          broadcast: true,
          changed: true,
          reply_ref: socket_ref(socket)
        )

      if is_binary(objective) and turn_was_running,
        do: enqueue_goal_continuation(updated_thread, socket)

      {:noreply, socket}
    else
      {:error, reason} -> {:reply, {:error, assistant_error_payload(reason)}, socket}
    end
  end

  def handle_in("set_goal_mode", _payload, socket),
    do: {:reply, {:error, assistant_error_payload("goal_mode is required")}, socket}

  # Thread-scoped Authoring Goal controls. Durable thread/provider state is the
  # source of truth; GoalRun contributes only live process presence.

  def handle_in("set_turn_preferences", payload, socket) when is_map(payload) do
    case assistant_thread(socket) do
      {:ok, thread} ->
        attrs = %{
          execution_mode: Map.get(payload, "execution_mode"),
          skill_profile: Map.get(payload, "skill_profile")
        }

        case History.set_turn_preferences(thread, attrs) do
          {:ok, updated} ->
            socket = assign(socket, :thread, updated)

            reply = %{
              execution_mode: History.thread_execution_mode(updated),
              skill_profile: History.thread_skill_profile(updated)
            }

            push(socket, "turn_preferences_changed", reply)
            {:reply, {:ok, reply}, socket}

          {:error, reason} ->
            {:reply, {:error, assistant_error_payload(reason)}, socket}
        end

      {:error, reason} ->
        {:reply, {:error, assistant_error_payload(reason)}, socket}
    end
  end

  def handle_in("goal_status", _payload, socket) do
    case assistant_thread(socket) do
      {:ok, thread} ->
        socket =
          socket
          |> assign(:thread, thread)
          |> schedule_authoritative_goal_status(reply_ref: socket_ref(socket))

        {:noreply, socket}

      {:error, reason} ->
        request_order = System.unique_integer([:positive, :monotonic])
        status = unavailable_goal_status(socket.assigns[:thread], reason, request_order)
        {:reply, {:ok, status}, remember_goal_status(socket, status)}
    end
  end

  def handle_in("goal_pause", _payload, socket) do
    case authoring_goal_pause_preflight(socket) do
      {:ok, _thread} ->
        start_async_goal_mutation(
          socket,
          :pause,
          true,
          fn thread ->
            cond do
              not History.thread_goal_mode(thread) ->
                {:error, :goal_mode_disabled}

              true ->
                registered_running = TurnManager.running?(thread.id)

                with :ok <- AuthoringGoalControl.pause_preflight(thread),
                     :ok <- interrupt_goal_process(thread.id, registered_running),
                     {:ok, interrupted_thread} <- History.get_thread(thread.id),
                     {:ok, payload, updated} <- AuthoringGoalControl.pause(interrupted_thread) do
                  {:ok, payload, updated}
                end
            end
          end,
          queue_policy: :hold
        )

      {:error, reason} ->
        {:reply, {:error, assistant_error_payload(reason)}, socket}
    end
  end

  def handle_in("goal_resume", _payload, socket) do
    start_async_goal_mutation(socket, :resume, false, fn thread ->
      if History.thread_goal_mode(thread) do
        case AuthoringGoalControl.resume(thread) do
          {:ok, _payload, updated_thread} -> {:ok, updated_thread}
          {:error, reason} -> {:error, reason}
        end
      else
        {:error, :goal_mode_disabled}
      end
    end)
  end

  def handle_in("goal_clear", _payload, socket) do
    start_async_goal_mutation(socket, :clear, false, fn thread ->
      if History.thread_goal_mode(thread),
        do: AuthoringGoalControl.clear(thread),
        else: {:error, :goal_mode_disabled}
    end)
  end

  def handle_in("goal_set_objective", %{"objective" => objective}, socket) when is_binary(objective) do
    case goal_mutation(socket, false, fn thread ->
           if History.thread_goal_mode(thread),
             do: AuthoringGoalControl.set_objective(thread, objective),
             else: {:error, :goal_mode_disabled}
         end) do
      {:ok, _payload, updated_thread} ->
        socket = assign(socket, :thread, updated_thread)

        socket =
          schedule_authoritative_goal_status(socket,
            broadcast: true,
            changed: true,
            reply_ref: socket_ref(socket)
          )

        {:noreply, socket}

      {:error, reason} ->
        {:reply, {:error, assistant_error_payload(reason)}, socket}
    end
  end

  def handle_in("goal_set_objective", _payload, socket),
    do: {:reply, {:error, assistant_error_payload("objective is required")}, socket}

  def handle_in("dispatch_coding_agent", payload, socket), do: do_dispatch(payload, socket)

  def handle_in("dispatch_codex", payload, socket), do: do_dispatch(payload, socket)

  def handle_in("steer_turn", %{"message" => message} = payload, socket) when is_binary(message) do
    trimmed =
      socket
      |> inject_assistant_context_refs(message, socket.assigns[:thread], Map.get(payload, "context_refs", []))
      |> String.trim()

    case {trimmed, active_provider_supports?(socket, :steer), steer_target(socket)} do
      {"", _, _} ->
        {:reply, {:error, assistant_error_payload("message is required")}, socket}

      {_text, false, _target} ->
        {:reply, {:error, assistant_error_payload("ActiveTurnNotSteerable")}, socket}

      {_text, true, {:ok, pid, _run_id}} ->
        maybe_persist_steer(socket, trimmed)
        send(pid, {:codex_steer, [%{"type" => "text", "text" => trimmed}], self()})
        {:reply, :ok, assign(socket, :last_steer_text, trimmed)}

      {_text, true, :error} ->
        {:reply, {:error, assistant_error_payload("ActiveTurnNotSteerable")}, socket}
    end
  end

  def handle_in("steer_turn", _payload, socket),
    do: {:reply, {:error, assistant_error_payload("message is required")}, socket}

  def handle_in("resume_turn", _payload, socket) do
    with %{id: thread_id} when is_integer(thread_id) <- socket.assigns[:thread],
         {:ok, reloaded} <- History.get_thread(thread_id) do
      cond do
        TurnManager.running?(thread_id) ->
          reattach_running_turn(reloaded, socket)

        match?(%{"status" => "interrupted"}, History.current_turn(reloaded)) ->
          do_resume_turn(reloaded, History.current_turn(reloaded), socket)

        History.current_turn(reloaded) == nil ->
          {:reply, {:error, assistant_error_payload("no turn to resume")}, socket}

        true ->
          {:reply, {:error, assistant_error_payload("turn is not interrupted")}, socket}
      end
    else
      {:error, _} -> {:reply, {:error, assistant_error_payload("cannot resume")}, socket}
      _ -> {:reply, {:error, assistant_error_payload("cannot resume")}, socket}
    end
  end

  def handle_in("dismiss_interrupted_turn", _payload, socket) do
    with %{id: thread_id} when is_integer(thread_id) <- socket.assigns[:thread],
         false <- TurnManager.running?(thread_id),
         {:ok, reloaded} <- History.get_thread(thread_id),
         {:ok, updated} <- History.dismiss_interrupted_turn_state(reloaded) do
      payload = History.turn_payload(updated) || %{status: "completed", can_resume: false}
      push(socket, "turn_status", normalize_turn_payload(payload))
      {:reply, :ok, assign(socket, :thread, updated)}
    else
      true -> {:reply, {:error, assistant_error_payload(:assistant_busy)}, socket}
      {:error, :not_interrupted} -> {:reply, {:error, assistant_error_payload("turn is not interrupted")}, socket}
      {:error, _} -> {:reply, {:error, assistant_error_payload("cannot dismiss")}, socket}
      _ -> {:reply, {:error, assistant_error_payload("cannot dismiss")}, socket}
    end
  end

  def handle_in("submit_user_input", %{"request_id" => request_id, "answers" => answers}, socket)
      when is_map(answers) do
    if socket.assigns[:turn_status] != :running or not is_pid(socket.assigns[:turn_pid]) do
      {:reply, {:error, assistant_error_payload("ActiveTurnNotAwaitingInput")}, socket}
    else
      pending = socket.assigns[:pending_user_inputs] || %{}
      {questions, rest} = Map.pop(pending, request_id, [])
      normalized = normalize_user_answers(answers)

      case deliver_user_input(socket, request_id, normalized) do
        :ok ->
          maybe_persist_user_questions(socket, questions, answers)
          {:reply, :ok, assign(socket, :pending_user_inputs, rest)}

        {:error, reason} ->
          {:reply, {:error, assistant_error_payload(reason)}, socket}
      end
    end
  end

  def handle_in("submit_user_input", _payload, socket),
    do: {:reply, {:error, assistant_error_payload("answers are required")}, socket}

  def handle_in("submit_approval", %{"request_id" => request_id, "action" => action}, socket)
      when action in ["approve", "cancel"] do
    if socket.assigns[:turn_status] != :running or not is_pid(socket.assigns[:turn_pid]) do
      {:reply, {:error, assistant_error_payload("ActiveTurnNotAwaitingApproval")}, socket}
    else
      pending = socket.assigns[:pending_approvals] || %{}

      case Map.pop(pending, request_id) do
        {nil, _rest} ->
          {:reply, {:error, assistant_error_payload("approval request not found")}, socket}

        {request, rest} ->
          deliver_approval(socket.assigns.turn_pid, request_id, action, request)
          {:reply, :ok, assign(socket, :pending_approvals, rest)}
      end
    end
  end

  def handle_in("submit_approval", _payload, socket),
    do: {:reply, {:error, assistant_error_payload("approval action is required")}, socket}

  def handle_in("submit_create_plan", %{"request_id" => request_id, "action" => action}, socket)
      when action in ["accept", "reject"] do
    if socket.assigns[:turn_status] != :running do
      {:reply, {:error, assistant_error_payload("ActiveTurnNotAwaitingCreatePlan")}, socket}
    else
      pending = socket.assigns[:pending_create_plans] || %{}

      case Map.pop(pending, request_id) do
        {nil, _rest} ->
          {:reply, {:error, assistant_error_payload("create_plan request not found")}, socket}

        {_request, rest} ->
          decision = if action == "accept", do: :accept, else: :reject
          SymphonyElixir.Cursor.CreatePlanBroker.resolve(to_string(request_id), decision)
          {:reply, :ok, assign(socket, :pending_create_plans, rest)}
      end
    end
  end

  def handle_in("submit_create_plan", _payload, socket),
    do: {:reply, {:error, assistant_error_payload("create_plan action is required")}, socket}

  # credo:disable-for-lines:25
  def handle_in("btw", %{"message" => message}, socket) when is_binary(message) do
    case String.trim(message) do
      "" ->
        {:reply, {:error, assistant_error_payload("message is required")}, socket}

      question ->
        thread = ensure_btw_thread(socket)
        btw_id = "btw-" <> Integer.to_string(System.unique_integer([:positive]))
        channel_pid = self()
        side_runner = Application.get_env(:symphony_elixir, :assistant_side_runner)

        run_opts =
          [on_delta: fn delta -> push(socket, "btw_delta", %{btw_id: btw_id, delta: delta}) end]
          |> maybe_put_side_runner(side_runner)

        case Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn ->
               case SideQuery.run(thread, question, run_opts) do
                 {:ok, answer} -> send(channel_pid, {:btw_finished, btw_id, {:ok, answer}})
                 {:error, reason} -> send(channel_pid, {:btw_finished, btw_id, {:error, reason}})
               end
             end) do
          {:ok, _pid} ->
            {:reply, {:ok, %{btw_id: btw_id}}, socket}

          {:error, reason} ->
            {:reply, {:error, assistant_error_payload({:btw_start_failed, reason})}, socket}
        end
    end
  end

  def handle_in("btw", _payload, socket), do: {:reply, {:error, assistant_error_payload("message is required")}, socket}

  defp do_dispatch(payload, socket) do
    case issue_thread(socket) do
      {:ok, %{issue_identifier: identifier, project_slug: project_slug} = thread} ->
        goal_mode = dispatch_goal_mode(payload, thread)
        agent = agent_from_payload(payload)
        mode = dispatch_mode_from_payload(payload)
        arguments = dispatch_arguments(identifier, goal_mode, agent, mode)

        case ToolExecutor.execute(project_slug, "dispatch_coding_agent", arguments) do
          {:ok, result} ->
            {:reply, {:ok, %{message: result.message, issue: result.data, goal_mode: goal_mode}}, socket}

          {:error, reason} ->
            {:reply, {:error, assistant_error_payload(reason)}, socket}
        end

      {:error, reason} ->
        {:reply, {:error, assistant_error_payload(reason)}, socket}
    end
  end

  @impl true
  def handle_info({:assistant_history_loaded, thread, metadata}, socket) do
    # Defer the capped/paginated transcript window out of the synchronous join
    # path so the join reply stays lightweight and the heavy history query never
    # blocks the socket handshake. The window is transferred exactly once, here.
    payload =
      Metrics.span(
        [:assistant, :history],
        %{thread_id: thread.id, source: :join},
        fn -> merge_history_window(metadata, thread.id) end,
        &history_measurements/1
      )

    push(socket, "history_loaded", payload)
    {:noreply, recover_pending_turns(thread, socket)}
  end

  def handle_info({:goal_mutation_finished, ref, :disable, {:ok, _payload, updated}}, socket) do
    finish_revision_gated(ref, updated, socket, %{goal_mode: false, goal_objective: nil})
  end

  def handle_info({:goal_mutation_finished, ref, :clear, {:ok, payload, updated}}, socket) do
    finish_revision_gated(ref, updated, socket, payload)
  end

  def handle_info({:goal_mutation_finished, ref, :pause, {:ok, payload, updated}}, socket) do
    finish_revision_gated(ref, updated, socket, payload)
  end

  def handle_info({:goal_mutation_finished, ref, :resume, {:ok, thread}}, socket) do
    case History.get_thread(thread.id) do
      {:ok, %{updated_at: revision}} when revision == thread.updated_at ->
        case start_goal_continuation(thread, assign(socket, :thread, thread)) do
          {:ok, socket} ->
            socket =
              schedule_authoritative_goal_status(socket,
                process_running: true,
                broadcast: true,
                changed: true,
                reply_ref: ref
              )

            {:noreply, socket}

          {:error, reason} ->
            reply(ref, {:error, assistant_error_payload(reason)})
            {:noreply, socket}
        end

      _ ->
        reply(ref, {:error, assistant_error_payload("goal mutation was superseded")})
        {:noreply, socket}
    end
  end

  def handle_info({:goal_mutation_finished, ref, _action, {:error, reason}}, socket) do
    reply(ref, {:error, assistant_error_payload(reason)})
    {:noreply, socket}
  end

  def handle_info({:assistant_turn_started, run_id}, socket) do
    socket = assign(socket, :run_id, run_id)

    if authoring_goal_active?(socket) do
      {:noreply, schedule_authoritative_goal_status(socket, process_running: true, broadcast: true)}
    else
      {:noreply, socket}
    end
  end

  def handle_info({:assistant_turn_finished, execution_id, {:ok, result}}, socket) do
    if stale_turn_execution_id?(socket, execution_id) do
      {:noreply, socket}
    else
      finish_successful_turn(result, socket)
    end
  end

  def handle_info({:assistant_turn_finished, execution_id, {:error, reason}}, socket) do
    if stale_turn_execution_id?(socket, execution_id) do
      {:noreply, socket}
    else
      finish_failed_turn(reason, socket)
    end
  end

  def handle_info({:DOWN, ref, :process, _pid, reason}, %{assigns: %{turn_ref: ref}} = socket) do
    cond do
      socket.assigns[:goal_paused] ->
        :ok

      socket.assigns[:turn_status] == :running ->
        push(socket, "assistant_error", assistant_error_payload({:turn_crashed, reason}))

      true ->
        :ok
    end

    socket = schedule_authoritative_goal_status(socket, process_running: false, broadcast: true)
    {:noreply, socket |> clear_goal_paused() |> reset_turn()}
  end

  def handle_info({:assistant_user_input_required, %{request_id: request_id, questions: questions}}, socket) do
    pending = Map.put(socket.assigns[:pending_user_inputs] || %{}, request_id, questions)
    push(socket, "user_input_required", %{request_id: request_id, questions: questions})
    notify_assistant_input_needed(socket, :question)
    {:noreply, assign(socket, :pending_user_inputs, pending)}
  end

  def handle_info({:assistant_ask_user_token, token}, socket) when is_binary(token) do
    {:noreply, assign(socket, :ask_user_token, token)}
  end

  def handle_info({:user_input_ok, _request_id}, socket), do: {:noreply, socket}

  def handle_info({:assistant_approval_required, %{request_id: request_id} = request}, socket) do
    pending = Map.put(socket.assigns[:pending_approvals] || %{}, request_id, request)

    push(socket, "approval_required", %{
      request_id: request_id,
      command: Map.get(request, :command),
      cwd: Map.get(request, :cwd),
      reason: Map.get(request, :reason),
      tool_name: Map.get(request, :tool_name),
      agent: Map.get(request, :agent)
    })

    notify_assistant_input_needed(socket, :approval)
    {:noreply, assign(socket, :pending_approvals, pending)}
  end

  def handle_info({:assistant_create_plan_required, %{request_id: request_id} = request}, socket) do
    pending = Map.put(socket.assigns[:pending_create_plans] || %{}, request_id, request)

    push(socket, "create_plan_required", %{
      request_id: request_id,
      name: Map.get(request, :name),
      overview: Map.get(request, :overview),
      plan: Map.get(request, :plan),
      plan_uri: Map.get(request, :plan_uri)
    })

    notify_assistant_input_needed(socket, :create_plan)
    {:noreply, assign(socket, :pending_create_plans, pending)}
  end

  def handle_info({:approval_ok, _request_id}, socket), do: {:noreply, socket}

  def handle_info({:steer_ok, _result}, socket), do: {:noreply, socket}

  def handle_info({:steer_error, _error}, socket) do
    push(socket, "steer_failed", %{
      code: "active_turn_not_steerable",
      prompt: socket.assigns[:last_steer_text] || ""
    })

    {:noreply, socket}
  end

  def handle_info({:btw_finished, btw_id, {:ok, answer}}, socket) do
    push(socket, "btw_completed", %{btw_id: btw_id, message: answer})
    {:noreply, socket}
  end

  def handle_info({:btw_finished, btw_id, {:error, reason}}, socket) do
    push(socket, "btw_error", %{btw_id: btw_id, message: error_reason(reason)})
    {:noreply, socket}
  end

  # Run lifecycle fanned out over the thread's PubSub topic. The channel that
  # started the run is excluded from these (it streams to its own socket and gets
  # {:assistant_turn_finished} directly), so only reloaded/other tabs land here.
  def handle_info({:goal_run_started}, socket) do
    if authoring_goal_active?(socket) do
      socket = schedule_authoritative_goal_status(socket, process_running: true)
      {:noreply, socket}
    else
      {:noreply, socket}
    end
  end

  def handle_info({:goal_run_finished, message}, socket) do
    # A tab running the turn itself reconciles via {:assistant_turn_finished};
    # only tabs that merely observed the run (reattached after a refresh) act here.
    socket =
      if socket.assigns[:turn_status] != :running do
        if is_map(message) do
          push(socket, "assistant_completed", %{message: message})
          push_history_sync(socket)
        end

        schedule_authoritative_goal_status(socket, process_running: false)
      else
        socket
      end

    {:noreply, socket}
  end

  def handle_info({:authoring_goal_updated, native_goal}, socket) do
    case socket.assigns[:thread] do
      %{id: thread_id} = thread when is_integer(thread_id) and is_map(native_goal) ->
        request_order = System.unique_integer([:positive, :monotonic])
        status = goal_status_from_native_update(thread, native_goal, request_order)
        {accepted?, socket} = accept_goal_status(socket, status, true)

        if accepted? do
          GoalRun.broadcast_from(self(), thread_id, {:authoring_goal_changed, status})
        end

        {:noreply, socket}

      _ ->
        {:noreply, schedule_authoritative_goal_status(socket, broadcast: true)}
    end
  end

  def handle_info({:authoring_goal_changed, status_payload}, socket) do
    {_accepted?, socket} = accept_goal_status(socket, status_payload, true)
    {:noreply, socket}
  end

  def handle_info({:goal_status_updated, status_payload}, socket) do
    {_accepted?, socket} = accept_goal_status(socket, status_payload, false)
    {:noreply, socket}
  end

  def handle_info(
        {:goal_status_resolved, request_order, %{broadcast: broadcast?, changed: changed?} = metadata, status_payload},
        socket
      )
      when is_map(status_payload) do
    status_payload = Map.put(status_payload, :request_order, request_order)
    {accepted?, socket} = accept_goal_status(socket, status_payload, changed?)
    reply_goal_status_refs(metadata, {:ok, status_payload})

    if accepted? and broadcast? do
      with id when is_integer(id) <- thread_id_from_socket(socket) do
        event = if changed?, do: :authoring_goal_changed, else: :goal_status_updated
        GoalRun.broadcast_from(self(), id, {event, status_payload})
      end
    end

    {:noreply, socket}
  end

  def handle_info({:goal_status_resolved, request_order, metadata, {:error, reason}}, socket) do
    handle_info({:goal_status_resolution_failed, request_order, metadata, reason}, socket)
  end

  def handle_info({:goal_status_resolution_failed, request_order, metadata, reason}, socket) do
    reply_goal_status_refs(metadata, {:error, assistant_error_payload(reason)})
    push(socket, "assistant_error", assistant_error_payload(reason))
    push_history_sync(socket)

    fallback =
      case socket.assigns[:goal_status_snapshot] do
        snapshot when is_map(snapshot) ->
          snapshot
          |> Map.put(:request_order, request_order)
          |> Map.put(:error, error_reason(reason))

        _ ->
          unavailable_goal_status(socket.assigns[:thread], reason, request_order)
      end

    {_accepted?, socket} = accept_goal_status(socket, fallback, false)
    {:noreply, socket}
  end

  def handle_info({:authoring_goal_tool_completed}, socket) do
    {:noreply, schedule_authoritative_goal_status(socket, broadcast: true, changed: true)}
  end

  # Durable turn streaming fanned out to reloaded/other tabs (the originating tab
  # receives events directly from the run Task's callbacks).
  def handle_info({:turn_stream, event, payload}, socket) do
    if should_push_turn_stream?(socket, event, payload) do
      push(socket, event, payload)
    end

    {:noreply, socket}
  end

  def handle_info({:goal_stream, event, payload}, socket) do
    handle_info({:turn_stream, event, payload}, socket)
  end

  # Turn lifecycle fanned out by TurnManager over the thread topic. The socket that
  # started the turn streams + reconciles via {:assistant_turn_finished}; only
  # reattached/other tabs (not currently running the turn) surface turn_status.
  def handle_info({:turn_status, :running, payload}, socket) do
    if socket.assigns[:turn_status] != :running do
      push(socket, "turn_status", Map.put(normalize_turn_payload(payload), :status, "running"))
    end

    socket =
      socket
      |> assign(:turn_status, :running)
      |> assign(:turn_execution_id, turn_payload_execution_id(payload))

    {:noreply, socket}
  end

  def handle_info({:turn_status, status, payload}, socket)
      when status in [:failed, :interrupted] do
    handle_terminal_turn_status(payload, socket)
  end

  def handle_info({:turn_status, :finished, payload}, socket) do
    handle_terminal_turn_status(payload, socket)
  end

  def handle_info(_message, socket), do: {:noreply, socket}

  defp ensure_btw_thread(%Socket{assigns: %{thread: %{} = thread}}), do: thread

  defp ensure_btw_thread(%Socket{assigns: %{project_slug: project_slug}}) when is_binary(project_slug) do
    case History.ensure_thread(project_slug, %{}) do
      {:ok, thread} -> thread
      _ -> %{id: nil, workspace_path: nil}
    end
  end

  defp ensure_btw_thread(_socket), do: %{id: nil, workspace_path: nil}

  defp maybe_put_side_runner(opts, runner) when is_function(runner, 4), do: Keyword.put(opts, :runner, runner)
  defp maybe_put_side_runner(opts, _runner), do: opts

  defp maybe_persist_steer(%Socket{assigns: %{thread: %{id: id} = thread}} = socket, text) when is_integer(id) do
    case History.append_message(thread, %{role: "user", content: text, metadata: %{"steer" => true}}) do
      {:ok, message} ->
        push(socket, "message_created", %{message: History.message_payload(message)})
        :ok

      _ ->
        :ok
    end
  end

  defp maybe_persist_steer(_socket, _text), do: :ok

  defp normalize_user_answers(answers) when is_map(answers) do
    Map.new(answers, fn {question_id, value} -> {question_id, %{"answers" => [to_string(value)]}} end)
  end

  # Claude AskUserQuestion and Cursor ACP ask_question wait on UserInputBroker;
  # Codex answers land on the turn process as {:codex_user_input, ...}. The
  # canonical current-turn provider is required; this path never guesses.
  defp deliver_user_input(socket, request_id, normalized) do
    case current_turn_agent(socket) do
      agent when agent in ["claude", "cursor"] ->
        UserInputBroker.resolve(to_string(request_id), normalized)

      "codex" ->
        send(socket.assigns.turn_pid, {:codex_user_input, request_id, normalized, self()})
        :ok

      _unsupported ->
        {:error, "CurrentTurnProviderMissing"}
    end
  end

  defp current_turn_agent(%Socket{assigns: %{thread: thread}}) when is_map(thread) do
    live_thread =
      case Map.get(thread, :id) do
        id when is_integer(id) ->
          case History.get_thread(id) do
            {:ok, fresh} -> fresh
            _ -> thread
          end

        _ ->
          thread
      end

    turn = History.current_turn(live_thread) || %{}

    AgentPreference.normalize(Map.get(turn, "provider") || Map.get(turn, :provider))
  end

  defp current_turn_agent(_socket), do: nil

  defp notify_assistant_input_needed(socket, request_kind) do
    dispatcher = Application.get_env(:symphony_elixir, :push_dispatcher, SymphonyElixir.PushNotifications.Dispatcher)

    metadata = %{
      project_slug: socket.assigns[:project_slug],
      issue_identifier: socket.assigns[:issue_identifier],
      request_kind: request_kind
    }

    try do
      dispatcher.assistant_input_needed(metadata)
    rescue
      _ -> :ok
    end
  end

  # Claude / Cursor approvals wait on ApprovalBroker; Codex approvals are delivered
  # to the turn process over its port protocol. Route by the originating agent.
  defp deliver_approval(turn_pid, request_id, "approve", request) do
    if broker_approval?(request) do
      ApprovalBroker.resolve(request_id, :approve)
    else
      decision = Map.get(request, :decision) || Map.get(request, "decision") || "acceptForSession"
      if is_pid(turn_pid), do: send(turn_pid, {:codex_approval, request_id, decision, self()})
    end
  end

  defp deliver_approval(turn_pid, request_id, "cancel", request) do
    if broker_approval?(request) do
      ApprovalBroker.resolve(request_id, :deny)
    else
      if is_pid(turn_pid), do: send(turn_pid, {:agent_interrupt})
    end
  end

  defp broker_approval?(request) do
    (Map.get(request, :agent) || Map.get(request, "agent")) in ["claude", "cursor"]
  end

  defp maybe_persist_user_questions(socket, questions, answers) do
    case resolve_user_questions_thread(socket) do
      %{id: id} = thread when is_integer(id) ->
        attrs = %{
          role: "user",
          content: user_questions_summary(answers),
          metadata: %{"kind" => "user_questions", "questions" => questions, "answers" => answers}
        }

        case History.append_message(thread, attrs) do
          {:ok, message} ->
            push(socket, "message_created", %{message: History.message_payload(message)})
            :ok

          _ ->
            :ok
        end

      _ ->
        :ok
    end
  end

  defp resolve_user_questions_thread(%Socket{assigns: %{thread: %{id: id} = thread}}) when is_integer(id),
    do: thread

  defp resolve_user_questions_thread(%Socket{assigns: %{project_slug: slug}}) when is_binary(slug) do
    case History.ensure_thread(slug, %{}) do
      {:ok, thread} -> thread
      _ -> nil
    end
  end

  defp resolve_user_questions_thread(_socket), do: nil

  defp user_questions_summary(answers) when is_map(answers) do
    count = map_size(answers)
    "Answered #{count} clarifying question" <> if(count == 1, do: ".", else: "s.")
  end

  defp finish_successful_turn(result, socket) do
    push(socket, "assistant_completed", %{message: result.assistant_chat_message})
    socket = push_model_provenance(socket)
    socket = push_history_sync(socket)
    _ = maybe_push_created_issue(result, socket)
    socket = schedule_authoritative_goal_status(socket, process_running: false, broadcast: true)
    {:noreply, socket |> clear_goal_paused() |> reset_turn()}
  end

  defp push_model_provenance(%Socket{assigns: %{thread: %{id: id}}} = socket)
       when is_integer(id) do
    case History.get_thread(id) do
      {:ok, thread} ->
        push(socket, "model_provenance", %{
          requested_model: History.requested_model(thread),
          requested_effort: History.requested_effort(thread),
          resolved_model: History.resolved_model(thread),
          resolved_effort: History.resolved_effort(thread)
        })

        assign(socket, :thread, thread)

      _ ->
        socket
    end
  end

  defp push_model_provenance(socket), do: socket

  defp finish_failed_turn(reason, socket) do
    # `or`/`and` require a strict boolean on the left; `:goal_paused` may be
    # unset (nil) on freshly joined sockets, which used to crash this clause
    # and swallow the assistant_error push for Cursor turn failures.
    if reason == :interrupted or socket.assigns[:goal_paused] == true or
         goal_pause_interruption?(socket) do
      :ok
    else
      push(socket, "assistant_error", assistant_error_payload(reason))
    end

    socket = rollback_deferred_goal_activation(socket)
    socket = schedule_authoritative_goal_status(socket, process_running: false, broadcast: true)
    socket = clear_goal_paused(socket)

    if reason == :interrupted,
      do: {:noreply, reset_turn_preserving_execution_id(socket)},
      else: {:noreply, reset_turn(socket)}
  end

  defp rollback_deferred_goal_activation(%Socket{assigns: %{thread: %{id: id}}} = socket)
       when is_integer(id) do
    with {:ok, thread} <- History.get_thread(id),
         %{"trigger" => "authoring_goal_changed"} <- History.current_turn(thread),
         true <- History.thread_goal_mode(thread),
         {:ok, rolled_back} <- History.set_goal_mode(thread, false, nil) do
      assign(socket, :thread, rolled_back)
    else
      _ -> socket
    end
  end

  defp rollback_deferred_goal_activation(socket), do: socket

  # Push the current (terminal) turn status plus a durable history sync to a single
  # socket so a stale running indicator reconciles when `stop_turn` finds the turn
  # already finished. Keeps any resumable interrupted turn intact so Resume stays
  # available, unlike `dismiss_interrupted_turn`.
  defp reconcile_finished_turn(socket, thread_id) do
    case History.get_thread(thread_id) do
      {:ok, thread} ->
        payload = History.turn_payload(thread) || %{status: "completed", can_resume: false}
        push(socket, "turn_status", normalize_turn_payload(payload))

        socket
        |> push_history_sync()
        |> maybe_reset_stale_running_turn()

      _ ->
        socket
    end
  end

  defp maybe_reset_stale_running_turn(socket) do
    if socket.assigns[:turn_status] == :running,
      do: reset_turn_preserving_execution_id(socket),
      else: socket
  end

  defp handle_terminal_turn_status(payload, socket) do
    execution_id = turn_payload_execution_id(payload)

    if stale_turn_execution_id?(socket, execution_id) do
      {:noreply, socket}
    else
      push(socket, "turn_status", normalize_turn_payload(payload))
      socket = push_history_sync(socket)

      socket =
        if socket.assigns[:turn_status] == :running,
          do: reset_turn_preserving_execution_id(socket),
          else: socket

      {:noreply, socket}
    end
  end

  defp turn_payload_execution_id(payload) when is_map(payload) do
    Map.get(payload, :execution_id) || Map.get(payload, "execution_id")
  end

  defp turn_payload_execution_id(_payload), do: nil

  defp current_turn_execution_id(thread) do
    thread
    |> History.current_turn()
    |> turn_payload_execution_id()
  end

  defp stale_turn_execution_id?(socket, execution_id) when is_binary(execution_id) do
    socket.assigns[:turn_execution_id] != execution_id
  end

  defp stale_turn_execution_id?(_socket, _execution_id), do: true

  defp reset_turn_preserving_execution_id(socket) do
    execution_id = socket.assigns[:turn_execution_id]
    socket |> reset_turn() |> assign(:turn_execution_id, execution_id)
  end

  defp reset_turn(socket) do
    case socket.assigns[:ask_user_token] do
      token when is_binary(token) -> UserInputBroker.unbind_session(token)
      _ -> :ok
    end

    socket
    |> assign(:turn_status, :idle)
    |> assign(:turn_pid, nil)
    |> assign(:turn_ref, nil)
    |> assign(:turn_execution_id, nil)
    |> assign(:run_id, nil)
    |> assign(:pending_user_inputs, %{})
    |> assign(:ask_user_token, nil)
  end

  # Resolve the live worker for steering: prefer the always-on TurnManager registry
  # (works cross-channel / post-refresh); fall back to this socket's own assigns.
  defp steer_target(%Socket{assigns: %{thread: %{id: id}}} = socket) when is_integer(id) do
    case TurnManager.steer_target(id) do
      {:ok, pid, run_id} -> {:ok, pid, run_id}
      :error -> local_steer_target(socket)
    end
  end

  defp steer_target(socket), do: local_steer_target(socket)

  defp local_steer_target(%Socket{assigns: assigns}) do
    if assigns[:turn_status] == :running and is_pid(assigns[:turn_pid]) and
         not is_nil(assigns[:run_id]) do
      {:ok, assigns[:turn_pid], assigns[:run_id]}
    else
      :error
    end
  end

  defp normalize_turn_payload(payload) when is_map(payload), do: payload
  defp normalize_turn_payload(_payload), do: %{}

  # Reconcile the client transcript from durable history. Pushed after every
  # terminal turn_status fan-out and on explicit sync_history so reattached tabs
  # recover when streaming/completion events targeted a dead channel process.
  defp push_history_sync(%Socket{} = socket) do
    case thread_id_from_socket(socket) do
      id when is_integer(id) ->
        payload =
          Metrics.span(
            [:assistant, :history],
            %{thread_id: id, source: :sync},
            fn ->
              {messages, has_more_before, oldest_sequence} = history_message_window(id)

              %{
                messages: messages,
                has_more_before: has_more_before,
                oldest_sequence: oldest_sequence
              }
            end,
            &history_measurements/1
          )

        push(socket, "history_synced", payload)
        socket

      _ ->
        socket
    end
  end

  # Older-messages page reusing the same tool-output cap and page limit budgets as
  # join/sync so pagination never ships an unbounded window.
  defp older_messages_page(thread_id, before_sequence) do
    records =
      History.list_messages_for_thread(thread_id,
        limit: @history_page_limit,
        before_sequence: before_sequence
      )

    messages =
      Enum.map(
        records,
        &History.message_payload(&1, cap_tool_output_bytes: @history_tool_output_cap_bytes)
      )

    {oldest_sequence, has_more_before} = older_page_meta(thread_id, records)

    %{
      messages: messages,
      has_more_before: has_more_before,
      oldest_sequence: oldest_sequence
    }
  end

  # Merge the freshly queried transcript window into the already-computed join
  # metadata for the single "history_loaded" push.
  defp merge_history_window(metadata, thread_id) do
    {messages, has_more_before, oldest_sequence} = history_message_window(thread_id)

    Map.merge(metadata, %{
      messages: messages,
      has_more_before: has_more_before,
      oldest_sequence: oldest_sequence
    })
  end

  defp history_measurements(%{messages: messages}) when is_list(messages) do
    %{payload_bytes: Metrics.payload_bytes(messages), message_count: length(messages)}
  end

  defp history_measurements(_payload), do: %{}

  # Newest page of the transcript with capped tool outputs, plus the metadata the
  # client needs to offer "load older".
  defp history_message_window(thread_id) do
    records = History.list_messages_for_thread(thread_id, limit: @history_page_limit)

    messages =
      Enum.map(
        records,
        &History.message_payload(&1, cap_tool_output_bytes: @history_tool_output_cap_bytes)
      )

    {oldest_sequence, has_more_before} = older_page_meta(thread_id, records)
    {messages, has_more_before, oldest_sequence}
  end

  defp older_page_meta(thread_id, records) do
    case records do
      [%{sequence: oldest_sequence} | _] when is_integer(oldest_sequence) ->
        {oldest_sequence, History.has_messages_before?(thread_id, oldest_sequence)}

      _ ->
        {nil, false}
    end
  end

  defp parse_before_sequence(payload) do
    case Map.get(payload, "before_sequence") do
      value when is_integer(value) and value > 0 -> {:ok, value}
      value when is_binary(value) -> parse_positive_integer(value)
      _ -> :error
    end
  end

  defp parse_message_id(value) when is_integer(value) and value > 0, do: {:ok, value}
  defp parse_message_id(value) when is_binary(value), do: parse_positive_integer(value)
  defp parse_message_id(_value), do: :error

  defp parse_positive_integer(value) when is_binary(value) do
    case Integer.parse(String.trim(value)) do
      {parsed, ""} when parsed > 0 -> {:ok, parsed}
      _ -> :error
    end
  end

  defp require_tool_call_id(tool_call_id) do
    case normalize_tool_call_id(tool_call_id) do
      nil -> :error
      trimmed -> {:ok, trimmed}
    end
  end

  defp thread_id_from_socket(%Socket{assigns: %{thread: %{id: id}}}) when is_integer(id), do: id
  defp thread_id_from_socket(_socket), do: nil

  defp normalize_tool_call_id(tool_call_id) when is_binary(tool_call_id) do
    case String.trim(tool_call_id) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp kill_tool_error_payload(reason) when reason in [:tool_not_running, :no_worker] do
    reason
    |> assistant_error_payload()
    |> put_in([:details, "can_stop_turn"], true)
  end

  defp kill_tool_error_payload(reason), do: assistant_error_payload(reason)

  # The originating channel is excluded by `GoalRun.broadcast_from/3`, so every
  # channel that receives this PubSub message is an observer and must keep
  # receiving the live stream while its lifecycle status is `running`.
  defp should_push_turn_stream?(_socket, event, payload)
       when is_binary(event) and is_map(payload),
       do: true

  defp should_push_turn_stream?(_socket, _event, _payload), do: false

  # credo:disable-for-next-line Credo.Check.Refactor.CyclomaticComplexity
  defp do_send_message(message, payload, socket) do
    project_slug = socket.assigns[:project_slug]
    thread = socket.assigns[:thread]
    context = normalize_context(Map.get(payload, "context", %{}))
    {raw_attachments, attachments} = resolve_attachments(payload, thread, project_slug)
    context_refs = Map.get(payload, "context_refs", [])

    trimmed =
      message
      |> Payload.enrich_message(attachments)
      |> then(&inject_assistant_context_refs(socket, &1, thread, context_refs))
      |> String.trim()

    cond do
      trimmed == "" ->
        {:reply, {:error, assistant_error_payload("message is required")}, socket}

      is_map(thread) and Map.get(thread, :scope) == "issue_execution" ->
        {:reply, {:error, assistant_error_payload(:execution_thread_not_interactive)}, socket}

      raw_attachments != [] and attachments == [] ->
        {:reply, {:error, assistant_error_payload("One or more attachments could not be processed. Try a smaller image (max 4 MB).")}, socket}

      true ->
        channel_pid = self()

        context =
          context
          |> Map.put("attachments", Payload.attachment_summary(attachments))
          |> Map.put("model", Map.get(context, "model") || Map.get(context, :model))
          |> Map.put("effort", Map.get(context, "effort") || Map.get(context, :effort))
          |> Map.put("agent", Map.get(context, "agent") || Map.get(context, :agent))

        opts =
          turn_stream_opts(socket, thread, channel_pid, context)
          |> Keyword.put(:attachments, attachments)

        if is_map(thread) and is_integer(Map.get(thread, :id)) do
          start_tracked_turn(thread, project_slug, trimmed, context, opts, socket)
        else
          start_legacy_turn(thread, project_slug, trimmed, context, opts, socket)
        end
    end
  end

  defp inject_assistant_context_refs(_socket, message, _thread, []), do: message

  defp inject_assistant_context_refs(socket, message, thread, context_refs) when is_list(context_refs) do
    project_slug =
      case thread do
        %{project_slug: slug} when is_binary(slug) and slug != "" -> slug
        _ -> socket.assigns[:project_slug]
      end

    case thread do
      %{id: thread_id} when is_integer(thread_id) and is_binary(project_slug) and project_slug != "" ->
        project_slug
        |> SymphonyElixir.AttachedContexts.assistant_scope(thread_id)
        |> SymphonyElixir.AttachedContexts.append_to_instructions(message, context_refs: context_refs)

      _ ->
        message
    end
  end

  defp inject_assistant_context_refs(_socket, message, _thread, _context_refs), do: message

  # A live worker is already registered (often after the originating channel died
  # on tab switch). Heal durable metadata if it drifted to interrupted, point this
  # socket at the worker, and fan out running status so the UI reattaches.
  defp reattach_running_turn(thread, socket) do
    thread =
      case History.current_turn(thread) do
        %{"status" => status} when status != "running" ->
          case History.restore_running_turn_state(thread) do
            {:ok, healed} -> healed
            {:error, _} -> thread
          end

        _ ->
          thread
      end

    {turn_pid, run_id} =
      case TurnManager.steer_target(thread.id) do
        {:ok, pid, provider_run_id} -> {pid, provider_run_id}
        :error -> {nil, nil}
      end

    payload =
      thread
      |> live_turn_payload(true)
      |> Map.put(:status, "running")

    push(socket, "turn_status", normalize_turn_payload(payload))

    socket =
      socket
      |> assign(:thread, thread)
      |> assign(:turn_status, :running)
      |> assign(:turn_pid, turn_pid)
      |> assign(:turn_execution_id, current_turn_execution_id(thread))
      |> assign(:run_id, run_id)

    {:reply, :ok, socket}
  end

  # Re-dispatches a thread's interrupted current turn as a brand-new turn that
  # reuses its canonical provider conversation.
  defp do_resume_turn(thread, turn, socket) do
    channel_pid = self()
    context = normalize_context(%{})
    prompt = turn["prompt"] || ""

    with {:ok, provider, conversation_id} <- resumable_turn_identity(thread, turn) do
      context = Map.put(context, "agent", provider)

      opts =
        turn_stream_opts(socket, thread, channel_pid, context)
        |> Keyword.put(:on_turn_started, fn started_conversation_id, run_id ->
          notify_turn_started(
            channel_pid,
            thread,
            provider,
            started_conversation_id,
            run_id
          )
        end)

      start_opts = [
        run: fn -> run_send_turn(thread, thread.project_slug, prompt, context, opts) end,
        reply_to: channel_pid,
        trigger: "resume",
        provider: provider,
        conversation_id: conversation_id,
        model: History.requested_model(thread),
        effort: History.requested_effort(thread)
      ]

      case TurnManager.start_turn(thread.id, prompt, start_opts) do
        {:ok, %{pid: pid, execution_id: execution_id}} ->
          socket =
            socket
            |> assign(:turn_status, :running)
            |> assign(:turn_pid, pid)
            |> assign(:turn_execution_id, execution_id)
            |> assign(:run_id, nil)

          {:reply, :ok, socket}

        {:error, reason} ->
          {:reply, {:error, assistant_error_payload(reason)}, socket}
      end
    else
      {:error, reason} ->
        {:reply, {:error, assistant_error_payload(reason)}, socket}
    end
  end

  defp resumable_turn_identity(
         thread,
         %{"provider" => provider, "conversation_id" => conversation_id}
       )
       when is_binary(provider) and provider != "" and is_binary(conversation_id) and
              conversation_id != "" do
    case History.conversation_ref(thread, provider) do
      {:ok, %{conversation_id: ^conversation_id}} ->
        {:ok, provider, conversation_id}

      {:ok, _different_ref} ->
        {:error, {:resume_conversation_failed, conversation_id, :binding_mismatch}}

      :error ->
        {:error, {:resume_conversation_failed, conversation_id, :binding_missing}}
    end
  end

  defp resumable_turn_identity(_thread, _turn), do: {:error, :conversation_id_required}

  # Durable threads route through TurnManager so it owns the metadata.current_turn
  # lifecycle + the cross-channel pid registry (steer/interrupt + re-attach after a
  # refresh). Live streaming still flows over the originating socket via `opts`.
  defp start_tracked_turn(thread, project_slug, trimmed, context, opts, socket) do
    channel_pid = self()
    goal_run? = goal_thread?(thread)
    agent_kind = turn_agent_kind(context) || thread_effective_agent(thread)

    run_builder = fn prompt_text ->
      fn -> run_tracked_turn(thread, project_slug, prompt_text, context, opts, goal_run?, channel_pid) end
    end

    start_opts = [
      run: run_builder.(trimmed),
      run_builder: run_builder,
      reply_to: channel_pid,
      trigger: "user",
      provider: agent_kind,
      model: Map.get(context, "model"),
      effort: Map.get(context, "effort"),
      queue_context: context
    ]

    case TurnManager.start_turn(thread.id, trimmed, start_opts) do
      {:ok, %{pid: pid, execution_id: execution_id}} ->
        socket =
          socket
          |> assign(:turn_status, :running)
          |> assign(:turn_pid, pid)
          |> assign(:turn_execution_id, execution_id)
          |> assign(:run_id, nil)

        {:reply, :ok, socket}

      {:error, :turn_in_progress} ->
        steer_or_queue(thread, trimmed, start_opts, socket)

      {:error, _reason} ->
        {:reply, {:error, assistant_error_payload("assistant could not start the turn")}, socket}
    end
  end

  # Project-scoped sends (no durable thread) keep the original channel-owned
  # spawn + monitor lifecycle since there is no thread metadata to track.
  defp start_legacy_turn(thread, project_slug, trimmed, context, opts, socket) do
    channel_pid = self()
    execution_id = System.unique_integer([:positive, :monotonic]) |> Integer.to_string()

    {:ok, pid} =
      Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn ->
        result = run_send_turn(thread, project_slug, trimmed, context, opts)
        send(channel_pid, {:assistant_turn_finished, execution_id, result})
      end)

    ref = Process.monitor(pid)

    socket =
      socket
      |> assign(:turn_status, :running)
      |> assign(:turn_pid, pid)
      |> assign(:turn_ref, ref)
      |> assign(:turn_execution_id, execution_id)
      |> assign(:run_id, nil)

    {:reply, :ok, socket}
  end

  defp turn_agent_kind(context) when is_map(context) do
    AgentPreference.normalize(Map.get(context, "agent") || Map.get(context, :agent))
  end

  defp turn_agent_kind(_context), do: nil

  # Worker-side body of a tracked turn. Goal threads keep their track/untrack +
  # finished broadcast bookkeeping; everything runs on the channel topic via `channel_pid`.
  defp run_tracked_turn(thread, project_slug, prompt_text, context, opts, goal_run?, channel_pid) do
    run = fn -> run_send_turn(thread, project_slug, prompt_text, context, opts) end
    if goal_run?, do: run_goal_process(thread.id, channel_pid, run), else: run.()
  end

  defp recover_pending_turns(thread, socket) do
    case History.pending_turns(thread) do
      [] ->
        socket

      _pending ->
        channel_pid = self()
        goal_run? = goal_thread?(thread)

        recovery_builder = fn entry ->
          context =
            case Map.get(entry, "context") do
              value when is_map(value) -> value
              _ -> %{}
            end

          context =
            case entry["provider"] do
              provider when is_binary(provider) and provider != "" ->
                Map.put(context, "agent", provider)

              _provider ->
                context
            end

          stream_opts = turn_stream_opts(socket, thread, channel_pid, context)

          fn ->
            run_tracked_turn(
              thread,
              thread.project_slug,
              entry["prompt"],
              context,
              stream_opts,
              goal_run?,
              channel_pid
            )
          end
        end

        case TurnManager.recover_pending(thread.id, recovery_builder, reply_to: channel_pid) do
          {:ok, _count} ->
            socket

          {:error, reason} ->
            push(socket, "assistant_error", assistant_error_payload(reason))
            socket
        end
    end
  end

  defp run_goal_process(thread_id, channel_pid, run) when is_function(run, 0) do
    GoalRun.track(thread_id)
    GoalRun.broadcast_from(channel_pid, thread_id, {:goal_run_started})

    try do
      result = run.()
      GoalRun.untrack(thread_id)
      GoalRun.broadcast_from(channel_pid, thread_id, {:goal_run_finished, finished_message(result)})
      result
    catch
      kind, reason ->
        stacktrace = __STACKTRACE__
        GoalRun.untrack(thread_id)
        GoalRun.broadcast_from(channel_pid, thread_id, {:goal_run_finished, nil})
        :erlang.raise(kind, reason, stacktrace)
    after
      GoalRun.untrack(thread_id)
    end
  end

  # Channel-side turn-started fan-out: notify the originating socket and record the
  # provider run ID on the durable thread so a reloaded/other tab can steer it.
  defp notify_turn_started(channel_pid, thread, provider, conversation_id, run_id) do
    send(channel_pid, {:assistant_turn_started, run_id})

    if is_map(thread) and is_integer(Map.get(thread, :id)) and is_binary(provider) and
         is_binary(conversation_id) do
      TurnManager.note_run(thread.id, provider, conversation_id, run_id)
    end
  end

  # A send arrived while a turn is running. Prefer steering the live turn; if there
  # is no steerable worker, queue it so it runs next. Either way the message is
  # persisted to history so it is never lost.
  defp steer_or_queue(thread, trimmed, start_opts, socket) do
    provider =
      thread
      |> History.current_turn()
      |> case do
        %{"provider" => active_provider} when is_binary(active_provider) ->
          active_provider

        _turn ->
          nil
      end

    supports_steer? = is_binary(provider) and CodingAgent.capabilities(provider).steer

    case {supports_steer?, TurnManager.steer_target(thread.id)} do
      {true, {:ok, pid, _run_id}} ->
        maybe_persist_steer(socket, trimmed)
        send(pid, {:codex_steer, [%{"type" => "text", "text" => trimmed}], self()})
        {:reply, :ok, assign(socket, :last_steer_text, trimmed)}

      {_supports_steer, _target} ->
        case TurnManager.enqueue(thread.id, trimmed, start_opts) do
          :ok -> {:reply, {:ok, %{queued: true}}, socket}
          {:error, reason} -> {:reply, {:error, assistant_error_payload(reason)}, socket}
        end
    end
  end

  defp active_provider_supports?(socket, capability) when is_atom(capability) do
    provider =
      case thread_id_from_socket(socket) do
        id when is_integer(id) ->
          case History.get_thread(id) do
            {:ok, thread} ->
              turn = History.current_turn(thread) || %{}
              turn["provider"]

            _ ->
              nil
          end

        _ ->
          nil
      end

    CodingAgent.capabilities(provider)
    |> Map.get(capability, false)
  end

  defp resolve_attachments(_payload, %{scope: "freeform"}, _project_slug), do: {[], []}

  defp resolve_attachments(payload, _thread, project_slug) do
    raw = Map.get(payload, "attachments", [])
    {raw, Payload.normalize_attachments(raw, project_slug)}
  end

  defp run_send_turn(%{scope: scope} = thread, _project_slug, trimmed, context, opts)
       when scope in ["issue", "issue_session"] do
    AgentSession.send_message_to_issue_thread(thread, trimmed, context, opts)
  end

  defp run_send_turn(%{scope: "freeform"} = thread, _project_slug, trimmed, context, opts) do
    AgentSession.send_message_to_thread(thread, trimmed, context, opts)
  end

  defp run_send_turn(%{scope: scope} = thread, _project_slug, trimmed, context, opts)
       when scope in ["project_explore", "project_session"] do
    AgentSession.send_message_to_project_explore_thread(thread, trimmed, context, opts)
  end

  defp run_send_turn(%{scope: "kb"} = thread, _project_slug, trimmed, context, opts) do
    AgentSession.send_message_to_kb_thread(thread, trimmed, context, opts)
  end

  defp run_send_turn(%{scope: "project"} = thread, _project_slug, trimmed, context, opts) do
    AgentSession.send_message_to_project_thread(thread, trimmed, context, opts)
  end

  defp run_send_turn(%{scope: "issue_execution"}, _project_slug, _trimmed, _context, _opts),
    do: {:error, :execution_thread_not_interactive}

  defp run_send_turn(_thread, _project_slug, _trimmed, _context, _opts),
    do: {:error, :assistant_thread_required}

  defp maybe_push_created_issue(result, %Socket{assigns: %{project_slug: project_slug}} = socket)
       when is_binary(project_slug) do
    if project_scoped_socket?(socket) do
      result
      |> draft_issue_identifier()
      |> maybe_migrate_created_issue(project_slug, socket)
    else
      :ok
    end
  end

  defp maybe_push_created_issue(_result, _socket), do: :ok

  defp maybe_migrate_created_issue({:ok, identifier}, project_slug, socket) do
    case History.promote_project_thread_to_issue(project_slug, identifier, %{
           workspace_path: Workspace.path_for_issue(identifier)
         }) do
      {:ok, issue_thread} ->
        push(socket, "assistant_issue_created", %{identifier: identifier, thread_id: issue_thread.id})

      _error ->
        :ok
    end

    :ok
  end

  defp maybe_migrate_created_issue(_other, _project_slug, _socket), do: :ok

  defp parse_id(raw) do
    case Integer.parse(raw) do
      {id, ""} -> {:ok, id}
      _ -> {:error, :invalid_id}
    end
  end

  defp parse_kb_topic(raw_kb_topic) do
    case String.split(raw_kb_topic, ":", parts: 3) do
      [raw_project_slug, raw_repo_slug, raw_page_path] ->
        with {:ok, project_slug} <- decode_required_topic_segment(raw_project_slug, :project_slug),
             {:ok, repo_slug} <- decode_required_topic_segment(raw_repo_slug, :repo_slug),
             {:ok, page_path} <- decode_required_topic_segment(raw_page_path, :page_path) do
          {:ok, project_slug, repo_slug, page_path}
        end

      _ ->
        {:error, :invalid_topic}
    end
  end

  defp parse_issue_topic(raw_issue_topic) do
    case String.split(raw_issue_topic, ":", parts: 2) do
      [raw_project_slug, raw_issue_identifier] ->
        with {:ok, project_slug} <- decode_required_topic_segment(raw_project_slug, :project_slug),
             {:ok, issue_identifier} <- decode_required_topic_segment(raw_issue_identifier, :issue_identifier) do
          {:ok, project_slug, issue_identifier}
        end

      _ ->
        {:error, :invalid_topic}
    end
  end

  defp decode_required_topic_segment(raw_value, field) when is_binary(raw_value) do
    raw_value
    |> URI.decode()
    |> String.trim()
    |> case do
      "" -> {:error, {:missing_required_field, field}}
      decoded -> {:ok, decoded}
    end
  rescue
    ArgumentError -> {:error, :invalid_topic}
  end

  defp maybe_put_runner(opts) do
    case Application.get_env(:symphony_elixir, :assistant_runner) do
      runner when is_function(runner, 4) -> Keyword.put(opts, :runner, runner)
      _ -> opts
    end
  end

  # Returns the effective agent kind for a thread's join payload so the UI can
  # display and default to the correct agent without waiting for the first turn.
  # Resolution order: thread agent_kind → project agent_kind → operator default.
  defp thread_effective_agent(thread) do
    AgentPreference.normalize(Map.get(thread, :agent_kind)) ||
      project_agent_kind(Map.get(thread, :project_slug)) ||
      Settings.Agents.default_agent_kind()
  end

  defp project_agent_kind(nil), do: nil
  defp project_agent_kind(""), do: nil

  defp project_agent_kind(project_slug) when is_binary(project_slug) do
    case Context.get_project(project_slug) do
      {:ok, project} ->
        project
        |> Repo.preload(:setup)
        |> ProjectConfig.resolve()
        |> Map.get(:agent_kind)
        |> AgentPreference.normalize()

      _ ->
        nil
    end
  end

  defp normalize_context(context) when is_map(context), do: context
  defp normalize_context(_context), do: %{}

  defp project_scoped_socket?(%Socket{assigns: %{thread: %{scope: scope}}})
       when scope in ["issue", "freeform", "project_explore", "kb"],
       do: false

  defp project_scoped_socket?(%Socket{assigns: %{project_slug: project_slug}}) when is_binary(project_slug), do: true
  defp project_scoped_socket?(_socket), do: false

  defp draft_issue_identifier(result) when is_map(result) do
    result
    |> draft_issue_tool_calls()
    |> Enum.find_value(fn tool_call ->
      if issue_authoring_tool_call?(tool_call) and successful_tool_call?(tool_call) do
        extract_identifier(get_any(tool_call, "result") || tool_call)
      end
    end)
    |> case do
      identifier when is_binary(identifier) and identifier != "" -> {:ok, identifier}
      _ -> :error
    end
  end

  defp draft_issue_identifier(_result), do: :error

  defp draft_issue_tool_calls(result) do
    direct_tool_calls = get_any(result, "tool_calls") || []

    message_tool_calls =
      result
      |> get_any("assistant_chat_message")
      |> case do
        message when is_map(message) -> get_any(message, "tool_calls") || []
        _ -> []
      end

    List.wrap(direct_tool_calls) ++ List.wrap(message_tool_calls)
  end

  defp issue_authoring_tool_call?(tool_call) when is_map(tool_call) do
    nested_tool = tool_call |> get_any("result") |> get_any("tool")

    get_any(tool_call, "name") in @issue_authoring_tools or
      get_any(tool_call, "tool") in @issue_authoring_tools or
      nested_tool in @issue_authoring_tools
  end

  defp issue_authoring_tool_call?(_tool_call), do: false

  defp successful_tool_call?(tool_call) when is_map(tool_call) do
    case get_any(tool_call, "status") do
      status when status in [nil, "complete", :complete, "completed", :completed, "ok", :ok] -> true
      _ -> false
    end
  end

  defp successful_tool_call?(_tool_call), do: false

  defp extract_identifier(value) when is_map(value) do
    identifier =
      get_any(value, "identifier") ||
        get_any(value, "issue_identifier") ||
        get_any(value, "issueIdentifier")

    case normalize_identifier(identifier) do
      {:ok, normalized} ->
        normalized

      :error ->
        extract_identifier(get_any(value, "data")) ||
          extract_identifier(get_any(value, "issue")) ||
          extract_identifier(get_any(value, "result")) ||
          extract_identifier(get_any(value, "toolResult")) ||
          extract_identifier_from_content(get_any(value, "contentItems"))
    end
  end

  defp extract_identifier(_value), do: nil

  defp extract_identifier_from_content(items) when is_list(items) do
    Enum.find_value(items, fn item ->
      item |> get_any("text") |> decode_identifier_text()
    end)
  end

  defp extract_identifier_from_content(_items), do: nil

  defp decode_identifier_text(text) when is_binary(text) do
    case Jason.decode(text) do
      {:ok, decoded} -> extract_identifier(decoded)
      _ -> nil
    end
  end

  defp decode_identifier_text(_text), do: nil

  defp normalize_identifier(value) when is_binary(value) do
    case String.trim(value) do
      "" -> :error
      trimmed -> {:ok, trimmed}
    end
  end

  defp normalize_identifier(_value), do: :error

  defp get_any(nil, _key), do: nil

  defp get_any(map, key) when is_map(map) and is_binary(key) do
    Map.get(map, key) || Map.get(map, String.to_existing_atom(key))
  rescue
    ArgumentError -> Map.get(map, key)
  end

  defp issue_thread(%Socket{assigns: %{thread: %{scope: "issue"} = thread}}), do: {:ok, thread}
  defp issue_thread(_socket), do: {:error, :issue_thread_required}

  defp assistant_thread(%Socket{assigns: %{thread: %{id: id}}}) when is_integer(id) do
    case History.get_thread(id) do
      {:ok, %{status: "active"} = thread} -> {:ok, thread}
      {:ok, _thread} -> {:error, :assistant_thread_not_active}
      {:error, reason} -> {:error, reason}
    end
  end

  defp assistant_thread(_socket), do: {:error, :assistant_thread_required}

  defp goal_mutation(socket, allow_running, operation, opts \\ [])

  defp goal_mutation(%Socket{assigns: %{thread: %{id: id}}} = socket, allow_running, operation, opts)
       when is_integer(id) and is_boolean(allow_running) and is_function(operation, 1) and is_list(opts) do
    TurnManager.goal_mutation(
      id,
      allow_running,
      fn ->
        if not allow_running and GoalRun.running?(id) do
          {:error, :assistant_busy}
        else
          with {:ok, thread} <- assistant_thread(socket), do: operation.(thread)
        end
      end,
      opts
    )
  end

  defp goal_mutation(_socket, _allow_running, _operation, _opts), do: {:error, :assistant_thread_required}

  defp interrupt_goal_process(thread_id, registered_running)
       when is_integer(thread_id) and is_boolean(registered_running) do
    cond do
      registered_running ->
        case TurnManager.interrupt_and_await(thread_id, "goal_pause") do
          :ok ->
            ensure_goal_process_stopped(thread_id)

          {:ok, :already_finished} ->
            if TurnManager.running?(thread_id),
              do: interrupt_goal_process(thread_id, true),
              else: ensure_goal_process_stopped(thread_id)

          {:error, reason} ->
            {:error, reason}
        end

      GoalRun.running?(thread_id) ->
        {:error, :goal_worker_not_registered}

      true ->
        :ok
    end
  end

  defp ensure_goal_process_stopped(thread_id) do
    if GoalRun.running?(thread_id), do: {:error, :assistant_still_running}, else: :ok
  end

  defp goal_pause_interruption?(%Socket{assigns: %{thread: %{id: id}}}) when is_integer(id) do
    case History.get_thread(id) do
      {:ok, thread} ->
        case History.current_turn(thread) do
          %{"status" => "interrupted", "interrupted_reason" => "goal_pause"} -> true
          _ -> false
        end

      _ ->
        false
    end
  end

  defp goal_pause_interruption?(_socket), do: false

  defp finish_revision_gated(ref, updated, socket, _payload) do
    case History.get_thread(updated.id) do
      {:ok, %{updated_at: revision}} when revision == updated.updated_at ->
        socket =
          socket
          |> assign(:thread, updated)
          |> schedule_authoritative_goal_status(
            broadcast: true,
            changed: true,
            reply_ref: ref
          )

        {:noreply, socket}

      _ ->
        reply(ref, {:error, assistant_error_payload("goal mutation was superseded")})
        {:noreply, socket}
    end
  end

  defp start_async_goal_mutation(socket, action, allow_running, operation, opts \\ []) do
    channel_pid = self()
    ref = socket_ref(socket)

    case Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn ->
           send(
             channel_pid,
             {:goal_mutation_finished, ref, action, goal_mutation(socket, allow_running, operation, opts)}
           )
         end) do
      {:ok, _pid} ->
        {:noreply, socket}

      {:error, reason} ->
        reply(
          ref,
          {:error, assistant_error_payload({:goal_mutation_start_failed, reason})}
        )

        {:noreply, schedule_authoritative_goal_status(socket)}
    end
  end

  # Resolves a fresh assistant thread (reloaded from the DB so provider bindings written
  # by a prior turn are visible) that has the Authoring goal enabled.
  defp authoring_goal_thread(socket) do
    with {:ok, thread} <- assistant_thread(socket) do
      if History.thread_goal_mode(thread), do: {:ok, thread}, else: {:error, :goal_mode_disabled}
    else
      {:error, reason} -> {:error, reason}
      _ -> {:error, :assistant_thread_required}
    end
  end

  defp authoring_goal_pause_preflight(socket) do
    with {:ok, thread} <- authoring_goal_thread(socket),
         :ok <- AuthoringGoalControl.pause_preflight(thread) do
      {:ok, thread}
    else
      {:error, reason} -> {:error, reason}
    end
  end

  # True when the socket's persistent thread has the Authoring goal enabled.
  # Uses the (fresh-on-set_goal_mode) assigns metadata to avoid a DB read per turn.
  defp authoring_goal_active?(%Socket{assigns: %{thread: %{id: id} = thread}})
       when is_integer(id),
       do: History.thread_goal_mode(thread)

  defp authoring_goal_active?(_socket), do: false

  # Lightweight thread metadata for the synchronous join reply. Deliberately
  # excludes the transcript window (messages/has_more_before/oldest_sequence);
  # that is transferred exactly once via the deferred "history_loaded" push so a
  # heavy thread (e.g. 8006) never duplicates megabytes of tool output between
  # the join reply and the follow-up push.
  defp join_metadata_payload(thread) do
    turn_running = TurnManager.running?(thread.id)
    thread = maybe_heal_running_turn_metadata(thread, turn_running)
    effective_agent = thread_effective_agent(thread)

    %{
      thread_id: thread.id,
      goal_mode: History.thread_goal_mode(thread),
      goal_objective: History.thread_goal_objective(thread),
      last_turn: live_turn_payload(thread, turn_running),
      turn_running: turn_running,
      turn_elapsed_seconds: History.turn_elapsed_seconds(thread),
      goal_status: joined_authoritative_goal_status(thread),
      effective_agent: effective_agent,
      agent_capabilities:
        effective_agent
        |> CodingAgent.capabilities()
        |> Map.from_struct(),
      execution_mode: History.thread_execution_mode(thread),
      requested_model: History.requested_model(thread),
      requested_effort: History.requested_effort(thread),
      resolved_model: History.resolved_model(thread),
      resolved_effort: History.resolved_effort(thread),
      skill_profile: History.thread_skill_profile(thread),
      scope: thread.scope
    }
  end

  # Prefer the live TurnManager registry over durable metadata: a tab switch can
  # leave the channel while the worker keeps running, and boot reconcile may mark
  # metadata interrupted without clearing that registry entry.
  defp live_turn_payload(thread, true = _turn_running) do
    case History.turn_payload(thread) do
      payload when is_map(payload) ->
        payload
        |> Map.put(:status, "running")
        |> Map.put(:can_resume, false)
        |> Map.put(:finished_at, nil)

      _ ->
        %{status: "running", can_resume: false, active_tools: []}
    end
  end

  defp live_turn_payload(thread, _turn_running), do: History.turn_payload(thread)

  defp maybe_heal_running_turn_metadata(thread, true = _turn_running) do
    case History.current_turn(thread) do
      %{"status" => status} when status != "running" ->
        case History.restore_running_turn_state(thread) do
          {:ok, healed} -> healed
          {:error, _} -> thread
        end

      _ ->
        thread
    end
  end

  defp maybe_heal_running_turn_metadata(thread, _turn_running), do: thread

  defp joined_authoritative_goal_status(%{id: id} = thread) when is_integer(id) do
    operation = fn ->
      case History.get_thread(id) do
        {:ok, reloaded} -> authoritative_goal_status(reloaded)
        {:error, reason} -> {:error, reason}
      end
    end

    case TurnManager.resolve_goal_status_sync(id, operation) do
      {:ok, status, request_order} when is_map(status) ->
        Map.put(status, :request_order, request_order)

      {:ok, {:error, reason}, request_order} ->
        unavailable_goal_status(thread, reason, request_order)

      {:error, reason} ->
        unavailable_goal_status(thread, reason, 0)
    end
  end

  defp schedule_authoritative_goal_status(socket, opts \\ [])

  defp schedule_authoritative_goal_status(%Socket{assigns: %{thread: %{id: id}}} = socket, opts)
       when is_integer(id) and is_list(opts) do
    request_order = System.unique_integer([:positive, :monotonic])
    broadcast? = Keyword.get(opts, :broadcast, false)
    changed? = Keyword.get(opts, :changed, false)
    process_running = Keyword.get(opts, :process_running)
    assigned_thread = socket.assigns.thread

    operation = fn ->
      case History.get_thread(id) do
        {:ok, reloaded} ->
          authoritative_goal_status(reloaded,
            process_running: process_running,
            request_order: request_order
          )

        {:error, reason} ->
          unavailable_goal_status(assigned_thread, reason, request_order)
      end
    end

    metadata = %{
      broadcast: broadcast?,
      changed: changed?,
      reply_refs: List.wrap(Keyword.get(opts, :reply_ref))
    }

    try do
      _ = TurnManager.resolve_goal_status(id, request_order, operation, self(), metadata)
    catch
      kind, reason ->
        send(
          self(),
          {:goal_status_resolution_failed, request_order, metadata, {:goal_status_resolver_unavailable, {kind, reason}}}
        )
    end

    assign(socket, :goal_status_request_order, request_order)
  end

  defp schedule_authoritative_goal_status(socket, _opts), do: socket

  defp enqueue_goal_continuation(%{id: thread_id} = thread, socket) when is_integer(thread_id) do
    channel_pid = self()
    opts = turn_stream_opts(socket, thread, channel_pid, %{})

    run = fn ->
      run_goal_process(thread_id, channel_pid, fn ->
        AgentSession.continue_thread_goal(thread, %{}, opts)
      end)
    end

    TurnManager.enqueue(
      thread_id,
      "Continue the newly activated native authoring Goal.",
      run: run,
      reply_to: channel_pid,
      trigger: "authoring_goal_changed",
      provider: Map.get(thread, :agent_kind)
    )
  end

  defp turn_running_for_thread?(%Socket{assigns: %{thread: %{id: id}}}) when is_integer(id),
    do: TurnManager.running?(id)

  defp turn_running_for_thread?(_socket), do: false

  defp authoritative_goal_status(thread, opts \\ []) do
    request_order = Keyword.get(opts, :request_order, 0)
    process_running = Keyword.get(opts, :process_running)
    process_running = if is_boolean(process_running), do: process_running, else: GoalRun.running?(thread.id)
    process_stoppable = process_running and TurnManager.running?(thread.id)
    process_started_at = if process_running, do: goal_process_started_at(thread.id), else: nil
    process_elapsed = if process_running, do: GoalRun.elapsed_seconds(thread.id), else: nil
    turn = History.turn_payload(thread) || %{}

    payload =
      case AuthoringGoalControl.status(thread) do
        {:ok, goal_payload, _thread} -> goal_payload
        {:error, reason} -> failed_goal_payload(thread, reason)
      end
      |> normalize_goal_payload_provider(thread)
      |> with_runtime_stop_capability(process_stoppable)

    goal =
      payload.goal
      |> patch_goal_runtime(process_elapsed)
      |> normalize_snapshot_goal(payload)

    updated_at =
      History.thread_goal_updated_at(thread) ||
        Map.get(payload, :updated_at) ||
        thread_updated_at(thread)

    revision =
      History.thread_goal_revision(thread) ||
        Map.get(payload, :revision) ||
        updated_at

    %{
      thread_id: thread.id,
      enabled: payload.enabled,
      objective: payload.objective,
      goal_mode: payload.enabled,
      goal_objective: payload.objective,
      native: payload.native,
      status: Map.get(payload, :status),
      provider: Map.get(payload, :provider),
      source: Map.get(payload, :source),
      capabilities: Map.get(payload, :capabilities, []),
      goal: goal,
      token_budget: goal_field(goal, :tokenBudget),
      tokens_used: goal_field(goal, :tokensUsed),
      time_used_seconds: goal_field(goal, :timeUsedSeconds),
      process_running: process_running,
      process_started_at: process_started_at,
      process_elapsed_seconds: process_elapsed,
      resumable: goal_resumable?(payload, turn, process_running),
      interrupted: goal_interrupted?(payload, turn, process_running),
      revision: revision,
      updated_at: updated_at,
      request_order: request_order,
      running: process_running,
      error: Map.get(payload, :error)
    }
  end

  defp goal_status_from_native_update(thread, native_goal, request_order) do
    payload =
      thread
      |> AuthoringGoalControl.payload_from_native_update(native_goal)
      |> normalize_goal_payload_provider(thread)
      |> with_runtime_stop_capability(true)

    process_started_at = goal_process_started_at(thread.id)
    process_elapsed = GoalRun.elapsed_seconds(thread.id)

    goal =
      payload.goal
      |> patch_goal_runtime(process_elapsed)
      |> normalize_snapshot_goal(payload)

    updated_at =
      History.thread_goal_updated_at(thread) ||
        Map.get(payload, :updated_at) ||
        thread_updated_at(thread)

    revision =
      History.thread_goal_revision(thread) ||
        Map.get(payload, :revision) ||
        updated_at

    %{
      thread_id: thread.id,
      enabled: payload.enabled,
      objective: payload.objective,
      goal_mode: payload.enabled,
      goal_objective: payload.objective,
      native: true,
      status: payload.status,
      provider: payload.provider,
      source: payload.source,
      capabilities: payload.capabilities,
      goal: goal,
      token_budget: goal_field(goal, :tokenBudget),
      tokens_used: goal_field(goal, :tokensUsed),
      time_used_seconds: goal_field(goal, :timeUsedSeconds),
      process_running: true,
      process_started_at: process_started_at,
      process_elapsed_seconds: process_elapsed,
      resumable: false,
      interrupted: false,
      revision: revision,
      updated_at: updated_at,
      running: true,
      request_order: request_order,
      error: nil
    }
  end

  defp unavailable_goal_status(%{id: thread_id} = thread, reason, request_order)
       when is_integer(thread_id) do
    provider = thread_effective_agent(thread)

    %{
      thread_id: thread_id,
      enabled: false,
      objective: nil,
      goal_mode: false,
      goal_objective: nil,
      native: false,
      status: nil,
      provider: provider,
      source: goal_source(provider),
      capabilities: [],
      goal: nil,
      token_budget: nil,
      tokens_used: nil,
      time_used_seconds: nil,
      process_running: GoalRun.running?(thread_id),
      process_started_at: goal_process_started_at(thread_id),
      process_elapsed_seconds: GoalRun.elapsed_seconds(thread_id),
      resumable: false,
      interrupted: false,
      revision: nil,
      updated_at: nil,
      request_order: request_order,
      running: GoalRun.running?(thread_id),
      error: error_reason(reason)
    }
  end

  defp unavailable_goal_status(_thread_id, reason, request_order) do
    %{
      thread_id: nil,
      enabled: false,
      objective: nil,
      goal_mode: false,
      goal_objective: nil,
      native: false,
      status: nil,
      provider: nil,
      source: nil,
      capabilities: [],
      goal: nil,
      token_budget: nil,
      tokens_used: nil,
      time_used_seconds: nil,
      process_running: false,
      process_started_at: nil,
      process_elapsed_seconds: nil,
      resumable: false,
      interrupted: false,
      revision: nil,
      updated_at: nil,
      request_order: request_order,
      running: false,
      error: error_reason(reason)
    }
  end

  defp failed_goal_payload(thread, reason) do
    enabled = History.thread_goal_mode(thread)
    provider = thread_effective_agent(thread)

    %{
      enabled: enabled,
      objective: History.thread_goal_objective(thread),
      native: false,
      status: if(enabled, do: "failed", else: nil),
      provider: provider,
      source: goal_source(provider),
      capabilities: [],
      revision: nil,
      updated_at: nil,
      goal: nil,
      error: error_reason(reason)
    }
  end

  defp normalize_goal_payload_provider(payload, thread) when is_map(payload) do
    provider =
      if Map.get(payload, :native),
        do: Map.get(payload, :provider),
        else: thread_effective_agent(thread)

    capabilities =
      case provider do
        "claude" -> ["get", "edit", "clear"]
        "codex" -> ["get", "edit", "pause", "resume", "clear"]
        _ -> []
      end

    payload
    |> Map.put(:provider, provider)
    |> Map.put(:source, goal_source(provider))
    |> Map.put(:capabilities, capabilities)
  end

  defp with_runtime_stop_capability(payload, process_stoppable) when is_map(payload) do
    capabilities =
      payload
      |> Map.get(:capabilities, [])
      |> List.wrap()
      |> Enum.reject(&(&1 == "stop"))

    stoppable? =
      process_stoppable == true and
        Map.get(payload, :enabled) == true and
        Map.get(payload, :provider) in ["codex", "claude"] and
        Map.get(payload, :source) in ["native", "claude"]

    Map.put(payload, :capabilities, if(stoppable?, do: capabilities ++ ["stop"], else: capabilities))
  end

  defp accept_goal_status(socket, payload, changed?) when is_map(payload) and is_boolean(changed?) do
    current = socket.assigns[:goal_status_snapshot]

    if goal_status_for_current_thread?(socket, payload) and goal_status_newer?(payload, current) do
      push(socket, "goal_status", payload)
      if changed?, do: push(socket, "authoring_goal_changed", payload)
      {true, remember_goal_status(socket, payload)}
    else
      {false, socket}
    end
  end

  defp accept_goal_status(socket, _payload, _changed?), do: {false, socket}

  defp reply_goal_status_refs(metadata, response) when is_map(metadata) do
    metadata
    |> Map.get(:reply_refs, [])
    |> List.wrap()
    |> Enum.each(&reply(&1, response))
  end

  defp reply_goal_status_refs(_metadata, _response), do: :ok

  defp remember_goal_status(socket, payload) when is_map(payload),
    do: assign(socket, :goal_status_snapshot, payload)

  defp remember_goal_status(socket, _payload), do: socket

  defp goal_status_for_current_thread?(socket, payload) do
    incoming_id = status_value(payload, :thread_id)

    case thread_id_from_socket(socket) do
      id when is_integer(id) -> incoming_id == id
      _ -> false
    end
  end

  defp goal_status_newer?(_incoming, nil), do: true

  defp goal_status_newer?(incoming, current) when is_map(incoming) and is_map(current) do
    case compare_goal_durable_revision(incoming, current) do
      :newer -> true
      :older -> false
      :same -> goal_request_order(incoming) > goal_request_order(current)
      :unknown -> false
    end
  end

  defp compare_goal_durable_revision(incoming, current) do
    incoming_revision = status_string(incoming, :revision)
    current_revision = status_string(current, :revision)
    incoming_updated_at = status_string(incoming, :updated_at)
    current_updated_at = status_string(current, :updated_at)

    cond do
      is_binary(incoming_revision) and incoming_revision == current_revision ->
        :same

      match?({:ok, _}, parse_goal_revision(incoming_revision)) and
          match?({:ok, _}, parse_goal_revision(current_revision)) ->
        compare_ordered_values(parse_goal_revision(incoming_revision), parse_goal_revision(current_revision))

      comparable_timestamps?(incoming_updated_at, current_updated_at) ->
        compare_goal_timestamps(
          incoming_updated_at,
          current_updated_at,
          incoming_revision,
          current_revision
        )

      is_nil(current_revision) and is_nil(current_updated_at) ->
        :newer

      is_nil(incoming_revision) and is_nil(incoming_updated_at) ->
        :older

      true ->
        :unknown
    end
  end

  defp compare_ordered_values({:ok, incoming}, {:ok, current}) when incoming > current, do: :newer
  defp compare_ordered_values({:ok, incoming}, {:ok, current}) when incoming < current, do: :older
  defp compare_ordered_values({:ok, _incoming}, {:ok, _current}), do: :same
  defp compare_ordered_values(_incoming, _current), do: :unknown

  defp compare_goal_timestamps(incoming, current, incoming_revision, current_revision) do
    case compare_ordered_values(parse_goal_timestamp(incoming), parse_goal_timestamp(current)) do
      :same when incoming_revision == current_revision -> :same
      :same -> :unknown
      comparison -> comparison
    end
  end

  defp parse_goal_revision(value) when is_binary(value) do
    case Integer.parse(value) do
      {revision, ""} -> {:ok, revision}
      _ -> :error
    end
  end

  defp parse_goal_revision(_value), do: :error

  defp comparable_timestamps?(incoming, current),
    do: match?({:ok, _}, parse_goal_timestamp(incoming)) and match?({:ok, _}, parse_goal_timestamp(current))

  defp parse_goal_timestamp(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, timestamp, _offset} -> {:ok, DateTime.to_unix(timestamp, :microsecond)}
      _ -> :error
    end
  end

  defp parse_goal_timestamp(_value), do: :error

  defp goal_request_order(payload) do
    case status_value(payload, :request_order) || status_value(payload, :event_order) do
      order when is_integer(order) -> order
      _ -> -1
    end
  end

  defp status_string(payload, key) do
    case status_value(payload, key) do
      value when is_binary(value) and value != "" -> value
      _ -> nil
    end
  end

  defp status_value(payload, key) when is_map(payload),
    do: Map.get(payload, key) || Map.get(payload, Atom.to_string(key))

  defp thread_updated_at(%{updated_at: %DateTime{} = updated_at}), do: DateTime.to_iso8601(updated_at)
  defp thread_updated_at(%{updated_at: updated_at}) when is_binary(updated_at), do: updated_at
  defp thread_updated_at(_thread), do: nil

  defp goal_process_started_at(thread_id) do
    case GoalRun.started_at(thread_id) do
      started_at when is_integer(started_at) ->
        started_at |> DateTime.from_unix!(:millisecond) |> DateTime.to_iso8601()

      _ ->
        nil
    end
  end

  defp goal_field(goal, key) when is_map(goal), do: Map.get(goal, key)
  defp goal_field(_goal, _key), do: nil

  defp goal_resumable?(%{enabled: true, status: status}, turn, false) do
    status in ["starting", "running", "paused", "blocked", "failed"] or
      turn_value(turn, :can_resume) == true
  end

  defp goal_resumable?(_payload, _turn, _process_running), do: false

  defp goal_interrupted?(%{enabled: true, status: status}, turn, false) do
    status in ["starting", "running", "paused", "blocked", "failed"] or
      turn_value(turn, :status) == "interrupted"
  end

  defp goal_interrupted?(_payload, _turn, _process_running), do: false

  defp turn_value(turn, key) when is_map(turn), do: Map.get(turn, key) || Map.get(turn, Atom.to_string(key))
  defp turn_value(_turn, _key), do: nil

  defp goal_source("claude"), do: "claude"
  defp goal_source("codex"), do: "native"
  defp goal_source(_provider), do: "prompt"

  # When no provider-native goal time is available yet (the goal turn is mid-flight,
  # or the native goal isn't created until the turn completes), fall back to the
  # registry's run-elapsed so a reattached pill still shows a live total time.
  defp patch_goal_runtime(goal, elapsed) when is_map(goal) and is_integer(elapsed) do
    case Map.get(goal, :timeUsedSeconds) do
      nil -> Map.put(goal, :timeUsedSeconds, elapsed)
      _ -> goal
    end
  end

  # No provider-native goal yet (it isn't created until a goal turn completes) but a
  # run is in flight: synthesize a minimal active goal so a reattached pill still
  # gets a live total time.
  defp patch_goal_runtime(nil, elapsed) when is_integer(elapsed) do
    %{
      kind: "goal",
      source: "native",
      objective: nil,
      status: "running",
      capabilities: ["get", "edit", "pause", "resume", "clear"],
      tokenBudget: nil,
      tokensUsed: nil,
      timeUsedSeconds: elapsed,
      updatedAt: nil
    }
  end

  defp patch_goal_runtime(goal, _elapsed), do: goal

  defp normalize_snapshot_goal(goal, payload) when is_map(goal) do
    goal
    |> Map.put(:source, Map.get(payload, :source) || Map.get(goal, :source))
    |> Map.put(:status, Map.get(payload, :status) || Map.get(goal, :status))
    |> Map.put(:objective, Map.get(payload, :objective) || Map.get(goal, :objective))
    |> Map.put(:capabilities, Map.get(payload, :capabilities, Map.get(goal, :capabilities, [])))
    |> Map.put(:revision, Map.get(payload, :revision) || Map.get(goal, :revision))
  end

  defp normalize_snapshot_goal(goal, _payload), do: goal

  # Shared streaming callbacks for assistant turns. Goal threads also fan out
  # deltas/tool events over the thread PubSub topic so a reloaded tab keeps
  # receiving live output, and forward native goal updates to the pill.
  defp turn_stream_opts(%Socket{} = socket, thread, channel_pid, context) when is_map(context) do
    goal_thread = goal_thread?(thread)
    thread_id = if is_map(thread), do: Map.get(thread, :id), else: nil
    durable_thread = durable_thread?(thread)
    provider = turn_agent_kind(context) || thread_effective_agent(thread)

    push_stream = fn event, payload ->
      push(socket, event, payload)

      if durable_thread and is_integer(thread_id) do
        GoalRun.broadcast_from(channel_pid, thread_id, {:turn_stream, event, payload})
      end
    end

    opts =
      []
      |> maybe_put_runner()
      |> Keyword.merge(Payload.model_opts(context))
      |> Keyword.put(:on_message_created, fn message -> push_stream.("message_created", %{message: message}) end)
      |> Keyword.put(:on_assistant_delta, fn delta -> push_stream.("assistant_delta", %{delta: delta}) end)
      |> Keyword.put(:on_tool_call_started, fn tool_call ->
        maybe_upsert_active_tool(thread_id, tool_call)
        push_stream.("tool_call_started", %{tool_call: tool_call})
      end)
      |> Keyword.put(:on_tool_call_completed, fn tool_call ->
        maybe_remove_active_tool(thread_id, tool_call)
        push_stream.("tool_call_completed", %{tool_call: tool_call})
        if authoring_goal_tool_call?(tool_call, thread), do: send(channel_pid, {:authoring_goal_tool_completed})
      end)
      |> Keyword.put(:on_documents_changed, fn identifier ->
        push(socket, "assistant_document_changed", %{identifier: identifier})
      end)
      |> Keyword.put(:on_thread_documents_changed, fn tid ->
        push(socket, "assistant_document_changed", %{thread_id: tid})
      end)
      |> Keyword.put(:on_turn_started, fn conversation_id, run_id ->
        notify_turn_started(channel_pid, thread, provider, conversation_id, run_id)
      end)
      |> Keyword.put(:interactive_user_input, true)
      |> Keyword.put(:on_user_input_required, fn request ->
        send(channel_pid, {:assistant_user_input_required, request})
      end)
      |> Keyword.put(:on_approval_required, fn request ->
        send(channel_pid, {:assistant_approval_required, request})
      end)
      |> Keyword.put(:on_create_plan_required, fn request ->
        send(channel_pid, {:assistant_create_plan_required, request})
      end)
      |> maybe_put_ask_user_session(socket, thread, channel_pid, context)

    if goal_thread and is_integer(thread_id) do
      Keyword.put(opts, :on_goal_updated, fn native_goal ->
        send(channel_pid, {:authoring_goal_updated, native_goal})
      end)
    else
      opts
    end
  end

  defp maybe_put_ask_user_session(opts, socket, thread, channel_pid, context) do
    agent =
      AgentPreference.normalize(Map.get(context, "agent") || Map.get(context, :agent)) ||
        AgentPreference.normalize(Map.get(thread, :agent_kind)) ||
        "codex"

    if agent == "claude" do
      token = "ask-#{System.unique_integer([:positive])}"
      thread_id = if is_map(thread), do: Map.get(thread, :id)

      send(channel_pid, {:assistant_ask_user_token, token})

      Keyword.put(opts, :ask_user_session, %{
        token: token,
        channel_pid: channel_pid,
        thread_id: thread_id
      })
    else
      _ = socket
      opts
    end
  end

  defp goal_thread?(%{id: id} = thread) when is_integer(id),
    do: History.thread_goal_mode(thread)

  defp goal_thread?(_thread), do: false

  defp durable_thread?(%{id: id}) when is_integer(id), do: true
  defp durable_thread?(_thread), do: false

  defp maybe_upsert_active_tool(thread_id, tool_call) when is_integer(thread_id) and is_map(tool_call) do
    with {:ok, active_tool} <- active_tool_payload(tool_call),
         {:ok, thread} <- History.get_thread(thread_id),
         {:ok, _updated} <- History.upsert_active_tool(thread, active_tool) do
      :ok
    else
      _ -> :ok
    end
  end

  defp maybe_upsert_active_tool(_thread_id, _tool_call), do: :ok

  defp maybe_remove_active_tool(thread_id, tool_call) when is_integer(thread_id) and is_map(tool_call) do
    with id when is_binary(id) <- tool_call_id(tool_call),
         {:ok, thread} <- History.get_thread(thread_id),
         {:ok, _updated} <- History.remove_active_tool(thread, id) do
      :ok
    else
      _ -> :ok
    end
  end

  defp maybe_remove_active_tool(_thread_id, _tool_call), do: :ok

  defp active_tool_payload(tool_call) when is_map(tool_call) do
    with id when is_binary(id) <- tool_call_id(tool_call) do
      {:ok,
       %{
         "id" => id,
         "name" => tool_call_name(tool_call),
         "arguments_summary" => summarize_tool_call(tool_call),
         "started_at" => DateTime.utc_now() |> DateTime.to_iso8601()
       }}
    else
      _ -> :error
    end
  end

  defp tool_call_id(tool_call) when is_map(tool_call) do
    tool_call
    |> get_any("id")
    |> case do
      id when is_binary(id) ->
        case String.trim(id) do
          "" -> nil
          trimmed -> trimmed
        end

      id when is_integer(id) ->
        Integer.to_string(id)

      _ ->
        nil
    end
  end

  defp tool_call_name(tool_call) when is_map(tool_call) do
    case get_any(tool_call, "name") do
      name when is_binary(name) and name != "" -> name
      _ -> "tool"
    end
  end

  defp authoring_goal_tool_call?(tool_call, thread) when is_map(tool_call) do
    arguments = get_any(tool_call, "arguments") || get_any(tool_call, "input") || %{}
    context = get_any(arguments, "context")
    action = get_any(arguments, "action")
    successful = get_any(tool_call, "status") in [nil, "complete", "completed", "ok", :complete, :completed, :ok]
    authoring = context == "authoring" or (is_nil(context) and is_integer(Map.get(thread, :id)))

    get_any(tool_call, "name") == "goal" and action in ["set_objective", "pause", "resume", "clear"] and
      successful and authoring
  end

  defp authoring_goal_tool_call?(_tool_call, _thread), do: false

  defp summarize_tool_call(tool_call) when is_map(tool_call) do
    arguments = get_any(tool_call, "arguments") || get_any(tool_call, "input") || %{}

    summary =
      case get_any(arguments, "command") do
        command when is_binary(command) and command != "" ->
          command

        _ ->
          arguments
          |> summary_source(tool_call)
          |> compact_summary()
      end

    truncate_tool_summary(summary)
  end

  defp summary_source(arguments, tool_call) when arguments in [nil, %{}], do: tool_call
  defp summary_source(arguments, _tool_call), do: arguments

  defp compact_summary(value) when is_binary(value), do: String.trim(value)

  defp compact_summary(value) do
    case Jason.encode(value) do
      {:ok, encoded} -> encoded
      {:error, _reason} -> inspect(value, limit: 20, printable_limit: @tool_arguments_summary_max_length)
    end
  end

  defp truncate_tool_summary(summary) when is_binary(summary) do
    if String.length(summary) > @tool_arguments_summary_max_length do
      summary
      |> String.slice(0, @tool_arguments_summary_max_length - 3)
      |> Kernel.<>("...")
    else
      summary
    end
  end

  defp truncate_tool_summary(_summary), do: ""

  # Starts an autonomous goal-continuation batch (no user message) that streams
  # each turn into the chat exactly like a normal send.
  defp start_goal_continuation(thread, socket) do
    channel_pid = self()
    opts = turn_stream_opts(socket, thread, channel_pid, %{})
    thread_id = thread.id
    prompt = "Continue the active authoring Goal."

    run = fn ->
      run_goal_process(thread_id, channel_pid, fn ->
        AgentSession.continue_thread_goal(thread, %{}, opts)
      end)
    end

    start_opts = [
      run: run,
      reply_to: channel_pid,
      trigger: "goal_resume",
      provider: Map.get(thread, :agent_kind)
    ]

    case TurnManager.start_turn(thread_id, prompt, start_opts) do
      {:ok, %{pid: pid, execution_id: execution_id}} ->
        socket =
          socket
          |> assign(:turn_status, :running)
          |> assign(:turn_pid, pid)
          |> assign(:turn_ref, nil)
          |> assign(:turn_execution_id, execution_id)
          |> assign(:run_id, nil)
          |> assign(:goal_paused, false)

        {:ok, socket}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # The assistant message payload a finished run should hand to reloaded/other
  # tabs, or nil when the run errored (those tabs just clear their running state).
  defp finished_message({:ok, %{assistant_chat_message: message}}), do: message
  defp finished_message(_), do: nil

  defp clear_goal_paused(socket), do: assign(socket, :goal_paused, false)

  # Execution dispatch is decoupled from the Authoring (chat) goal: an orchestrator dispatch only
  # carries an execution goal when the dispatch request explicitly opts in via `goal_mode`. The
  # thread's authoring goal stays in the assistant conversation and never auto-promotes to execution.
  defp dispatch_goal_mode(payload, _thread) when is_map(payload) do
    case Map.get(payload, "goal_mode") do
      enabled when is_boolean(enabled) -> enabled
      _ -> false
    end
  end

  defp agent_from_payload(payload) when is_map(payload) do
    case Map.get(payload, "agent") do
      agent when is_binary(agent) -> agent
      _ -> nil
    end
  end

  defp normalize_goal_objective(objective) when is_binary(objective) do
    case String.trim(objective) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_goal_objective(_), do: nil

  defp dispatch_mode_from_payload(payload) when is_map(payload) do
    case Map.get(payload, "mode") do
      mode when is_binary(mode) -> mode
      _ -> nil
    end
  end

  defp dispatch_mode_from_payload(_payload), do: nil

  defp dispatch_arguments(identifier, goal_mode, agent, mode) do
    base = %{"identifier" => identifier, "instructions" => dispatch_instructions(identifier)}

    base =
      if goal_mode do
        Map.put(base, "goal", dispatch_goal(identifier))
      else
        base
      end

    base
    |> maybe_put_dispatch_arg("agent", agent)
    |> maybe_put_dispatch_arg("mode", mode)
  end

  defp maybe_put_dispatch_arg(arguments, key, value) when is_binary(value), do: Map.put(arguments, key, value)
  defp maybe_put_dispatch_arg(arguments, _key, _value), do: arguments

  defp dispatch_instructions(identifier) do
    "Implement issue #{identifier} by following the spec, plan, and handoff under " <>
      "docs/superpowers/ in this working tree. Make the planned changes, verify them, and report when complete."
  end

  defp dispatch_goal(identifier) do
    """
    Objective: complete issue #{identifier} following docs/superpowers/plans/*.md and docs/superpowers/handoff.md in this working tree.
    Constraints: follow the existing specs and plans; verify changes before reporting completion.
    Stopping condition: stop when the planned work is complete or you are blocked.
    """
    |> String.trim()
  end

  defp authorized?(%Socket{assigns: %{tracker_token_valid: true}}), do: true

  defp authorized?(%Socket{assigns: %{token: token}}) when is_binary(token) do
    TrackerAuth.valid_token?(token, System.get_env(Config.local_api_token_env()))
  end

  defp authorized?(_socket), do: false

  defp error_reason(reason) when is_binary(reason), do: reason
  defp error_reason({:missing_required_field, field}), do: "#{field} is required"
  defp error_reason(:project_not_found), do: "project not found"
  defp error_reason(:issue_thread_required), do: "this action is only supported for issue assistant threads"
  defp error_reason(:assistant_thread_required), do: "this action requires a persistent assistant thread"
  defp error_reason(:execution_thread_not_interactive), do: "execution_thread_not_interactive"
  defp error_reason(:assistant_thread_not_active), do: "the current assistant thread is not active"
  defp error_reason(:assistant_busy), do: "assistant is busy"
  defp error_reason(:turn_interrupt_conflict), do: "assistant turn changed while interruption was being persisted"
  defp error_reason(:no_codex_thread), do: "pause requires a persisted native Codex thread; run a Codex turn first"

  defp error_reason({:authoring_goal_provider_mismatch, bound_provider, requested_provider}) do
    "the active Goal is bound to #{bound_provider}; remove it before switching to #{requested_provider}"
  end

  defp error_reason({:authoring_goal_unavailable, :workspace_not_executable}) do
    "authoring Goal Mode requires the thread's persisted executable workspace"
  end

  defp error_reason({:authoring_goal_unavailable, {:unsupported_agent, agent}}) do
    "authoring Goal Mode requires a persisted Codex or Claude provider; the current thread uses #{inspect(agent)}"
  end

  defp error_reason({:authoring_goal_unavailable, :claude_goal_unsupported_version}) do
    "authoring Goal Mode requires a Claude version with native /goal support"
  end

  defp error_reason({:goal_store_read_failed, reason}),
    do: "could not read the native goal state: #{inspect(reason)}"

  defp error_reason({:native_goal_clear_failed, reason}),
    do: "could not clear the native goal: #{inspect(reason)}"

  defp error_reason(:message_required), do: "message is required"
  defp error_reason({:turn_crashed, reason}), do: "assistant turn crashed: #{inspect(reason)}"
  defp error_reason(%Ecto.Changeset{}), do: "failed to persist thread metadata"
  defp error_reason(reason), do: inspect(reason)

  defp assistant_error_payload(reason) do
    normalized = AgentError.to_map(reason)
    generic? = normalized["code"] == "agent_operation_failed"
    generic_string? = generic? and is_binary(reason)

    %{
      code: if(generic?, do: channel_error_code(reason), else: normalized["code"]),
      category: if(generic_string?, do: "validation", else: normalized["category"]),
      retryable: normalized["retryable"],
      message: if(generic?, do: error_reason(reason), else: normalized["message"]),
      details: if(generic_string?, do: %{}, else: normalized["details"])
    }
  end

  defp channel_error_code(reason) when is_atom(reason), do: Atom.to_string(reason)

  defp channel_error_code(reason) when is_binary(reason) do
    normalized =
      reason
      |> String.replace(~r/([a-z0-9])([A-Z])/, "\\1_\\2")
      |> String.downcase()
      |> String.replace(~r/[^a-z0-9]+/, "_")
      |> String.trim("_")

    if normalized == "", do: "assistant_request_failed", else: normalized
  end

  defp channel_error_code(_reason), do: "assistant_request_failed"
end
