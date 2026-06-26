defmodule SymphonyElixirWeb.AssistantChannel do
  @moduledoc "Project-scoped realtime channel for Codex-backed tracker assistant chat."

  use Phoenix.Channel

  alias Phoenix.Socket

  alias SymphonyElixir.Assistant.{
    AuthoringGoalControl,
    CodexSession,
    GoalRun,
    History,
    Payload,
    SideQuery,
    ToolExecutor,
    TurnManager
  }

  alias SymphonyElixir.Config
  alias SymphonyElixirWeb.TrackerAuth
  alias SymphonyElixir.{AgentPreference, LocalTracker.Context, ProjectConfig, Repo, Settings, Workspace}

  @issue_modes ~w(triage simple complex)
  @issue_authoring_tools ~w(create_draft_issue create_issue)

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

      payload = %{
        messages: Enum.map(History.list_messages_for_thread(thread.id), &History.message_payload/1),
        thread_id: thread.id,
        mode: History.thread_mode(thread),
        goal_mode: History.thread_goal_mode(thread),
        goal_objective: History.thread_goal_objective(thread),
        goal_running: GoalRun.running?(thread.id),
        goal_run_elapsed_seconds: GoalRun.elapsed_seconds(thread.id),
        last_turn: History.turn_payload(thread),
        turn_running: TurnManager.running?(thread.id),
        turn_elapsed_seconds: History.turn_elapsed_seconds(thread),
        # Issue task labels are NOT consulted here (would need a tracker fetch at join);
        # dispatch resolves them — composer badge may differ for label-pinned issues.
        effective_agent: thread_effective_agent(thread)
      }

      socket = socket |> assign(:thread, thread) |> assign(:project_slug, thread.project_slug)
      send(self(), {:assistant_history_loaded, payload})
      {:ok, payload, socket}
    else
      false -> {:error, %{reason: "unauthorized"}}
      {:error, reason} -> {:error, %{reason: error_reason(reason)}}
      _ -> {:error, %{reason: "invalid_topic"}}
    end
  end

  def join("assistant:explore:" <> raw_project_slug, _payload, socket) do
    with true <- authorized?(socket),
         {:ok, project_slug} <- decode_required_topic_segment(raw_project_slug, :project_slug),
         {:ok, thread} <- History.ensure_project_explore_thread(project_slug) do
      TurnManager.subscribe(thread.id)

      payload = %{
        messages: Enum.map(History.list_messages_for_thread(thread.id), &History.message_payload/1),
        thread_id: thread.id,
        mode: History.thread_mode(thread),
        goal_mode: History.thread_goal_mode(thread),
        goal_objective: History.thread_goal_objective(thread),
        last_turn: History.turn_payload(thread),
        turn_running: TurnManager.running?(thread.id),
        turn_elapsed_seconds: History.turn_elapsed_seconds(thread),
        effective_agent: thread_effective_agent(thread)
      }

      socket = socket |> assign(:thread, thread) |> assign(:project_slug, thread.project_slug)
      send(self(), {:assistant_history_loaded, payload})
      {:ok, payload, socket}
    else
      false -> {:error, %{reason: "unauthorized"}}
      {:error, reason} -> {:error, %{reason: error_reason(reason)}}
      _ -> {:error, %{reason: "invalid_topic"}}
    end
  end

  def join("assistant:kb:" <> raw_kb_topic, _payload, socket) do
    with true <- authorized?(socket),
         {:ok, project_slug, repo_slug, page_path} <- parse_kb_topic(raw_kb_topic),
         {:ok, thread} <- History.ensure_kb_thread(project_slug, repo_slug, page_path) do
      TurnManager.subscribe(thread.id)

      payload = %{
        messages: Enum.map(History.list_messages_for_thread(thread.id), &History.message_payload/1),
        thread_id: thread.id,
        last_turn: History.turn_payload(thread),
        turn_running: TurnManager.running?(thread.id),
        turn_elapsed_seconds: History.turn_elapsed_seconds(thread),
        effective_agent: thread_effective_agent(thread)
      }

      socket = socket |> assign(:thread, thread) |> assign(:project_slug, thread.project_slug)
      send(self(), {:assistant_history_loaded, payload})
      {:ok, payload, socket}
    else
      false -> {:error, %{reason: "unauthorized"}}
      {:error, reason} -> {:error, %{reason: error_reason(reason)}}
      _ -> {:error, %{reason: "invalid_topic"}}
    end
  end

  def join("assistant:thread:" <> raw_id, _payload, socket) do
    with true <- authorized?(socket),
         {:ok, id} <- parse_id(raw_id),
         {:ok, thread} <- History.get_thread(id) do
      TurnManager.subscribe(thread.id)

      payload = %{
        messages: Enum.map(History.list_messages_for_thread(thread.id), &History.message_payload/1),
        mode: History.thread_mode(thread),
        goal_mode: History.thread_goal_mode(thread),
        goal_objective: History.thread_goal_objective(thread),
        last_turn: History.turn_payload(thread),
        turn_running: TurnManager.running?(thread.id),
        turn_elapsed_seconds: History.turn_elapsed_seconds(thread),
        effective_agent: thread_effective_agent(thread)
      }

      socket = socket |> assign(:thread, thread) |> assign(:project_slug, thread.project_slug)
      send(self(), {:assistant_history_loaded, payload})
      {:ok, payload, socket}
    else
      false -> {:error, %{reason: "unauthorized"}}
      {:error, :not_found} -> {:error, %{reason: "thread not found"}}
      _ -> {:error, %{reason: "invalid_topic"}}
    end
  end

  def join("assistant:" <> project_slug, _payload, socket) when project_slug != "" do
    if authorized?(socket) do
      case History.list_messages(project_slug) do
        {:ok, messages} ->
          socket = assign(socket, :project_slug, project_slug)
          # No thread record for project-scoped joins — resolve via project tier then operator default.
          payload = %{
            messages: Enum.map(messages, &History.message_payload/1),
            effective_agent: project_agent_kind(project_slug) || Settings.Agents.default_agent_kind()
          }

          send(self(), {:assistant_history_loaded, payload})
          {:ok, payload, socket}

        {:error, reason} ->
          {:error, %{reason: error_reason(reason)}}
      end
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  def join(_topic, _payload, _socket), do: {:error, %{reason: "invalid_topic"}}

  @impl true
  def handle_in("send_message", %{"message" => message} = payload, socket) when is_binary(message) do
    thread = socket.assigns[:thread]

    if is_nil(thread) and socket.assigns[:turn_status] == :running do
      {:reply, {:error, %{reason: "assistant is busy"}}, socket}
    else
      do_send_message(message, payload, socket)
    end
  end

  def handle_in("send_message", _payload, socket), do: {:reply, {:error, %{reason: "message is required"}}, socket}

  def handle_in("sync_history", _payload, socket) do
    push_history_sync(socket)
    {:reply, :ok, socket}
  end

  def handle_in("set_mode", %{"mode" => mode}, socket) when is_binary(mode) do
    with {:ok, normalized_mode} <- normalize_issue_mode(mode),
         {:ok, thread} <- issue_thread(socket),
         {:ok, updated_thread} <- History.set_mode(thread, normalized_mode) do
      {:reply, {:ok, %{mode: normalized_mode}}, assign(socket, :thread, updated_thread)}
    else
      {:error, reason} -> {:reply, {:error, %{reason: error_reason(reason)}}, socket}
    end
  end

  def handle_in("set_mode", _payload, socket), do: {:reply, {:error, %{reason: "mode is required"}}, socket}

  def handle_in("set_goal_mode", %{"goal_mode" => false}, socket) do
    with {:ok, thread} <- issue_thread(socket),
         {:ok, _payload, updated_thread} <- AuthoringGoalControl.clear(thread) do
      {:reply, {:ok, %{goal_mode: false, goal_objective: nil}}, assign(socket, :thread, updated_thread)}
    else
      {:error, reason} -> {:reply, {:error, %{reason: error_reason(reason)}}, socket}
    end
  end

  def handle_in("set_goal_mode", %{"goal_mode" => enabled} = payload, socket)
      when is_boolean(enabled) do
    objective = normalize_goal_objective(Map.get(payload, "objective"))

    with {:ok, thread} <- issue_thread(socket),
         {:ok, updated_thread} <- History.set_goal_mode(thread, enabled, objective) do
      {:reply, {:ok, %{goal_mode: enabled, goal_objective: History.thread_goal_objective(updated_thread)}}, assign(socket, :thread, updated_thread)}
    else
      {:error, reason} -> {:reply, {:error, %{reason: error_reason(reason)}}, socket}
    end
  end

  def handle_in("set_goal_mode", _payload, socket),
    do: {:reply, {:error, %{reason: "goal_mode is required"}}, socket}

  # Tab-scoped Authoring goal controls — drive the native Codex goal that lives on
  # this assistant thread (never the orchestrator/execution goal). The native goal
  # is the source of truth for status + timer; thread metadata holds the objective.

  def handle_in("goal_status", _payload, socket) do
    case authoring_goal_thread(socket) do
      {:ok, _thread} ->
        push_goal_status_async(socket, goal_running?(socket))
        {:reply, :ok, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: error_reason(reason)}}, socket}
    end
  end

  def handle_in("goal_pause", _payload, socket) do
    case authoring_goal_thread(socket) do
      {:ok, thread} ->
        # Always interrupt an in-flight batch (the native thread id may not be
        # persisted yet on the very first turn); native pause is best-effort.
        socket = if socket.assigns[:turn_status] == :running, do: pause_running_turn(socket), else: socket
        running = goal_running?(socket)

        payload =
          case AuthoringGoalControl.pause(thread) do
            {:ok, payload, _t} -> goal_status_payload(payload, running)
            _ -> goal_status_payload(metadata_goal_payload(thread, "paused"), running)
          end

        {:reply, {:ok, payload}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: error_reason(reason)}}, socket}
    end
  end

  def handle_in("goal_resume", _payload, socket) do
    cond do
      socket.assigns[:turn_status] == :running ->
        {:reply, {:error, %{reason: "assistant is busy"}}, socket}

      true ->
        case authoring_goal_thread(socket) do
          {:ok, thread} ->
            # Flip the native goal back to active (best-effort; may not exist yet)
            # then kick an autonomous continuation batch that streams into the chat.
            _ = AuthoringGoalControl.resume(thread)
            {:reply, :ok, start_goal_continuation(thread, socket)}

          {:error, reason} ->
            {:reply, {:error, %{reason: error_reason(reason)}}, socket}
        end
    end
  end

  def handle_in("goal_clear", _payload, socket) do
    with_authoring_goal(socket, &AuthoringGoalControl.clear/1, fn payload, socket ->
      {:reply, {:ok, goal_status_payload(payload, false)}, socket}
    end)
  end

  def handle_in("goal_set_objective", %{"objective" => objective}, socket) when is_binary(objective) do
    case authoring_goal_thread(socket) do
      {:ok, thread} ->
        # Save the objective to metadata synchronously (fast) and reply right away
        # so the edit never appears to hang. The native Codex goal is then synced
        # off the channel process — a `thread/goal/set` is a port round-trip that
        # can block (and, while a turn holds the thread, fight it).
        case AuthoringGoalControl.set_objective_metadata(thread, objective) do
          {:ok, payload, updated_thread} ->
            socket = assign(socket, :thread, updated_thread)
            sync_native_objective_async(socket)
            {:reply, {:ok, goal_status_payload(payload, goal_running?(socket))}, socket}

          {:error, reason} ->
            {:reply, {:error, %{reason: error_reason(reason)}}, socket}
        end

      {:error, reason} ->
        {:reply, {:error, %{reason: error_reason(reason)}}, socket}
    end
  end

  def handle_in("goal_set_objective", _payload, socket),
    do: {:reply, {:error, %{reason: "objective is required"}}, socket}

  def handle_in("dispatch_coding_agent", payload, socket), do: do_dispatch(payload, socket)

  def handle_in("dispatch_codex", payload, socket), do: do_dispatch(payload, socket)

  def handle_in("steer_turn", %{"message" => message}, socket) when is_binary(message) do
    trimmed = String.trim(message)

    case {trimmed, steer_target(socket)} do
      {"", _} ->
        {:reply, {:error, %{reason: "message is required"}}, socket}

      {_text, {:ok, pid, _codex_turn_id}} ->
        maybe_persist_steer(socket, trimmed)
        send(pid, {:codex_steer, [%{"type" => "text", "text" => trimmed}], self()})
        {:reply, :ok, assign(socket, :last_steer_text, trimmed)}

      {_text, :error} ->
        {:reply, {:error, %{reason: "ActiveTurnNotSteerable"}}, socket}
    end
  end

  def handle_in("steer_turn", _payload, socket),
    do: {:reply, {:error, %{reason: "message is required"}}, socket}

  def handle_in("resume_turn", _payload, socket) do
    with %{id: thread_id} when is_integer(thread_id) <- socket.assigns[:thread],
         {:ok, reloaded} <- History.get_thread(thread_id),
         %{"status" => "interrupted"} = turn <- History.current_turn(reloaded),
         false <- TurnManager.running?(thread_id) do
      do_resume_turn(reloaded, turn, socket)
    else
      true -> {:reply, {:error, %{reason: "assistant is busy"}}, socket}
      %{"status" => _other} -> {:reply, {:error, %{reason: "turn is not interrupted"}}, socket}
      nil -> {:reply, {:error, %{reason: "no turn to resume"}}, socket}
      {:error, _} -> {:reply, {:error, %{reason: "cannot resume"}}, socket}
      _ -> {:reply, {:error, %{reason: "cannot resume"}}, socket}
    end
  end

  def handle_in("submit_user_input", %{"request_id" => request_id, "answers" => answers}, socket)
      when is_map(answers) do
    if socket.assigns[:turn_status] != :running or not is_pid(socket.assigns[:turn_pid]) do
      {:reply, {:error, %{reason: "ActiveTurnNotAwaitingInput"}}, socket}
    else
      pending = socket.assigns[:pending_user_inputs] || %{}
      {questions, rest} = Map.pop(pending, request_id, [])

      maybe_persist_user_questions(socket, questions, answers)
      send(socket.assigns.turn_pid, {:codex_user_input, request_id, normalize_user_answers(answers), self()})

      {:reply, :ok, assign(socket, :pending_user_inputs, rest)}
    end
  end

  def handle_in("submit_user_input", _payload, socket),
    do: {:reply, {:error, %{reason: "answers are required"}}, socket}

  def handle_in("btw", %{"message" => message}, socket) when is_binary(message) do
    case String.trim(message) do
      "" ->
        {:reply, {:error, %{reason: "message is required"}}, socket}

      question ->
        thread = ensure_btw_thread(socket)
        btw_id = "btw-" <> Integer.to_string(System.unique_integer([:positive]))
        channel_pid = self()
        side_runner = Application.get_env(:symphony_elixir, :assistant_side_runner)

        run_opts =
          [on_delta: fn delta -> push(socket, "btw_delta", %{btw_id: btw_id, delta: delta}) end]
          |> maybe_put_side_runner(side_runner)

        Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn ->
          case SideQuery.run(thread, question, run_opts) do
            {:ok, answer} -> send(channel_pid, {:btw_finished, btw_id, {:ok, answer}})
            {:error, reason} -> send(channel_pid, {:btw_finished, btw_id, {:error, reason}})
          end
        end)

        {:reply, {:ok, %{btw_id: btw_id}}, socket}
    end
  end

  def handle_in("btw", _payload, socket), do: {:reply, {:error, %{reason: "message is required"}}, socket}

  defp do_dispatch(payload, socket) do
    case issue_thread(socket) do
      {:ok, %{issue_identifier: identifier, project_slug: project_slug} = thread} ->
        goal_mode = dispatch_goal_mode(payload, thread)
        agent = agent_from_payload(payload)
        arguments = dispatch_arguments(identifier, goal_mode, agent)

        case ToolExecutor.execute(project_slug, "dispatch_coding_agent", arguments) do
          {:ok, result} ->
            {:reply, {:ok, %{message: result.message, issue: result.data, goal_mode: goal_mode}}, socket}

          {:error, reason} ->
            {:reply, {:error, %{reason: error_reason(reason)}}, socket}
        end

      {:error, reason} ->
        {:reply, {:error, %{reason: error_reason(reason)}}, socket}
    end
  end

  @impl true
  def handle_info({:assistant_history_loaded, payload}, socket) do
    push(socket, "history_loaded", payload)
    {:noreply, socket}
  end

  def handle_info({:assistant_turn_started, turn_id}, socket) do
    if authoring_goal_active?(socket), do: push(socket, "goal_running", %{running: true})
    {:noreply, assign(socket, :codex_turn_id, turn_id)}
  end

  def handle_info({:assistant_turn_finished, {:ok, result}}, socket) do
    push(socket, "assistant_completed", %{message: result.assistant_chat_message})
    socket = push_history_sync(socket)
    _ = maybe_push_created_issue(result, socket)
    push_goal_status_async(socket, false)
    {:noreply, socket |> clear_goal_paused() |> reset_turn()}
  end

  def handle_info({:assistant_turn_finished, {:error, reason}}, socket) do
    # A pause interrupts the running goal batch on purpose; surface the paused
    # goal state instead of an error so the operator sees a clean pause.
    if socket.assigns[:goal_paused] do
      push_goal_status_async(socket, false)
    else
      push(socket, "assistant_error", %{message: error_reason(reason)})
    end

    {:noreply, socket |> clear_goal_paused() |> reset_turn()}
  end

  def handle_info({:DOWN, ref, :process, _pid, reason}, %{assigns: %{turn_ref: ref}} = socket) do
    cond do
      socket.assigns[:goal_paused] ->
        push_goal_status_async(socket, false)

      socket.assigns[:turn_status] == :running ->
        push(socket, "assistant_error", %{message: error_reason({:turn_crashed, reason})})

      true ->
        :ok
    end

    {:noreply, socket |> clear_goal_paused() |> reset_turn()}
  end

  def handle_info({:assistant_user_input_required, %{request_id: request_id, questions: questions}}, socket) do
    pending = Map.put(socket.assigns[:pending_user_inputs] || %{}, request_id, questions)
    push(socket, "user_input_required", %{request_id: request_id, questions: questions})
    {:noreply, assign(socket, :pending_user_inputs, pending)}
  end

  def handle_info({:user_input_ok, _request_id}, socket), do: {:noreply, socket}

  def handle_info({:steer_ok, _result}, socket), do: {:noreply, socket}

  def handle_info({:steer_error, _error}, socket) do
    push(socket, "steer_failed", %{
      reason: "ActiveTurnNotSteerable",
      message: socket.assigns[:last_steer_text] || ""
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
      push(socket, "goal_running", %{running: true})
      push_goal_status_async(socket, true)
    end

    {:noreply, socket}
  end

  def handle_info({:goal_run_finished, message}, socket) do
    # A tab running the turn itself reconciles via {:assistant_turn_finished};
    # only tabs that merely observed the run (reattached after a refresh) act here.
    if socket.assigns[:turn_status] != :running do
      if is_map(message) do
        push(socket, "assistant_completed", %{message: message})
        push_history_sync(socket)
      end

      push_goal_status_async(socket, false)
    end

    {:noreply, socket}
  end

  def handle_info({:authoring_goal_updated, native_goal}, socket) do
    socket = push_live_goal_status(socket, native_goal)
    {:noreply, socket}
  end

  def handle_info({:goal_status_updated, status_payload}, socket) do
    if authoring_goal_active?(socket) do
      push(socket, "goal_status", status_payload)
    end

    {:noreply, socket}
  end

  # Goal-turn streaming fanned out to reloaded/other tabs (the originating tab
  # receives events directly from the run Task's callbacks).
  def handle_info({:goal_stream, event, payload}, socket) do
    if socket.assigns[:turn_status] != :running and is_binary(event) and is_map(payload) do
      push(socket, event, payload)
    end

    {:noreply, socket}
  end

  # Turn lifecycle fanned out by TurnManager over the thread topic. The socket that
  # started the turn streams + reconciles via {:assistant_turn_finished}; only
  # reattached/other tabs (not currently running the turn) surface turn_status.
  def handle_info({:turn_status, :running, payload}, socket) do
    if socket.assigns[:turn_status] != :running do
      push(socket, "turn_status", Map.put(normalize_turn_payload(payload), :status, "running"))
    end

    {:noreply, socket}
  end

  def handle_info({:turn_status, status, payload}, socket)
      when status in [:failed, :interrupted] do
    normalized = normalize_turn_payload(payload)
    push(socket, "turn_status", normalized)
    socket = push_history_sync(socket)

    socket =
      if socket.assigns[:turn_status] == :running do
        # Abnormal worker exits notify reply_to via TurnManager, but always push
        # turn_status + reset so the originating tab can offer Resume and unblock
        # the composer even if that message is delayed or lost.
        reset_turn(socket)
      else
        socket
      end

    {:noreply, socket}
  end

  def handle_info({:turn_status, :finished, payload}, socket) do
    push(socket, "turn_status", normalize_turn_payload(payload))
    socket = push_history_sync(socket)

    socket =
      if socket.assigns[:turn_status] == :running do
        reset_turn(socket)
      else
        socket
      end

    {:noreply, socket}
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

  defp reset_turn(socket) do
    socket
    |> assign(:turn_status, :idle)
    |> assign(:turn_pid, nil)
    |> assign(:turn_ref, nil)
    |> assign(:codex_turn_id, nil)
    |> assign(:pending_user_inputs, %{})
  end

  # Resolve the live worker for steering: prefer the always-on TurnManager registry
  # (works cross-channel / post-refresh); fall back to this socket's own assigns.
  defp steer_target(%Socket{assigns: %{thread: %{id: id}}} = socket) when is_integer(id) do
    case TurnManager.steer_target(id) do
      {:ok, pid, codex_turn_id} -> {:ok, pid, codex_turn_id}
      :error -> local_steer_target(socket)
    end
  end

  defp steer_target(socket), do: local_steer_target(socket)

  defp local_steer_target(%Socket{assigns: assigns}) do
    if assigns[:turn_status] == :running and is_pid(assigns[:turn_pid]) and
         not is_nil(assigns[:codex_turn_id]) do
      {:ok, assigns[:turn_pid], assigns[:codex_turn_id]}
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
        messages = id |> History.list_messages_for_thread() |> Enum.map(&History.message_payload/1)
        push(socket, "history_synced", %{messages: messages})
        socket

      _ ->
        socket
    end
  end

  defp thread_id_from_socket(%Socket{assigns: %{thread: %{id: id}}}) when is_integer(id), do: id
  defp thread_id_from_socket(_socket), do: nil

  defp do_send_message(message, payload, socket) do
    project_slug = socket.assigns[:project_slug]
    thread = socket.assigns[:thread]
    context = normalize_context(Map.get(payload, "context", %{}))
    {raw_attachments, attachments} = resolve_attachments(payload, thread, project_slug)
    trimmed = message |> Payload.enrich_message(attachments) |> String.trim()

    cond do
      trimmed == "" ->
        {:reply, {:error, %{reason: "message is required"}}, socket}

      raw_attachments != [] and attachments == [] ->
        {:reply, {:error, %{reason: "One or more attachments could not be processed. Try a smaller image (max 4 MB)."}}, socket}

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

  # Re-dispatches a thread's interrupted current turn as a brand-new turn that
  # re-uses the saved prompt + codex_thread_id. Codex continuity is automatic:
  # run_send_turn -> CodexSession reloads the thread and continues the persisted
  # agent conversation; the codex_thread_id here is for display/trace only.
  defp do_resume_turn(thread, turn, socket) do
    channel_pid = self()
    context = normalize_context(%{})
    prompt = turn["prompt"] || ""
    codex_thread_id = turn["codex_thread_id"]

    opts =
      turn_stream_opts(socket, thread, channel_pid, %{})
      |> Keyword.put(:on_turn_started, fn turn_id ->
        notify_turn_started(channel_pid, thread, turn_id)
        TurnManager.note_codex_turn(thread.id, codex_thread_id, turn_id)
      end)

    start_opts = [
      run: fn -> run_send_turn(thread, thread.project_slug, prompt, context, opts) end,
      reply_to: channel_pid,
      trigger: "resume",
      codex_thread_id: codex_thread_id,
      agent_kind: turn["agent_kind"],
      model: turn["model"],
      effort: turn["effort"]
    ]

    case TurnManager.start_turn(thread.id, prompt, start_opts) do
      {:ok, %{pid: pid}} ->
        socket =
          socket
          |> assign(:turn_status, :running)
          |> assign(:turn_pid, pid)
          |> assign(:codex_turn_id, nil)

        {:reply, :ok, socket}

      {:error, :turn_in_progress} ->
        {:reply, {:error, %{reason: "assistant is busy"}}, socket}

      {:error, _reason} ->
        {:reply, {:error, %{reason: "could not resume the turn"}}, socket}
    end
  end

  # Durable threads route through TurnManager so it owns the metadata.current_turn
  # lifecycle + the cross-channel pid registry (steer/interrupt + re-attach after a
  # refresh). Live streaming still flows over the originating socket via `opts`.
  defp start_tracked_turn(thread, project_slug, trimmed, context, opts, socket) do
    channel_pid = self()
    goal_run? = goal_thread?(thread)

    run_builder = fn prompt_text ->
      fn -> run_tracked_turn(thread, project_slug, prompt_text, context, opts, goal_run?, channel_pid) end
    end

    start_opts = [
      run: run_builder.(trimmed),
      run_builder: run_builder,
      reply_to: channel_pid,
      trigger: "user",
      agent_kind: turn_agent_kind(context),
      model: Map.get(context, "model"),
      effort: Map.get(context, "effort")
    ]

    case TurnManager.start_turn(thread.id, trimmed, start_opts) do
      {:ok, %{pid: pid}} ->
        if goal_run?, do: GoalRun.broadcast_from(self(), thread.id, {:goal_run_started})

        socket =
          socket
          |> assign(:turn_status, :running)
          |> assign(:turn_pid, pid)
          |> assign(:codex_turn_id, nil)

        {:reply, :ok, socket}

      {:error, :turn_in_progress} ->
        steer_or_queue(thread, trimmed, start_opts, socket)

      {:error, _reason} ->
        {:reply, {:error, %{reason: "assistant could not start the turn"}}, socket}
    end
  end

  # Project-scoped sends (no durable thread) keep the original channel-owned
  # spawn + monitor lifecycle since there is no thread metadata to track.
  defp start_legacy_turn(thread, project_slug, trimmed, context, opts, socket) do
    channel_pid = self()

    {:ok, pid} =
      Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn ->
        result = run_send_turn(thread, project_slug, trimmed, context, opts)
        send(channel_pid, {:assistant_turn_finished, result})
      end)

    ref = Process.monitor(pid)

    socket =
      socket
      |> assign(:turn_status, :running)
      |> assign(:turn_pid, pid)
      |> assign(:turn_ref, ref)
      |> assign(:codex_turn_id, nil)

    {:reply, :ok, socket}
  end

  defp turn_agent_kind(context) when is_map(context) do
    AgentPreference.normalize(Map.get(context, "agent") || Map.get(context, :agent))
  end

  defp turn_agent_kind(_context), do: nil

  # Worker-side body of a tracked turn. Goal threads keep their track/untrack +
  # finished broadcast bookkeeping; everything runs on the channel topic via `channel_pid`.
  defp run_tracked_turn(thread, project_slug, prompt_text, context, opts, goal_run?, channel_pid) do
    if goal_run?, do: GoalRun.track(thread.id)
    result = run_send_turn(thread, project_slug, prompt_text, context, opts)
    if goal_run?, do: finish_goal_run(thread.id, result, channel_pid)
    result
  end

  defp finish_goal_run(thread_id, result, channel_pid) do
    GoalRun.untrack(thread_id)
    GoalRun.broadcast_from(channel_pid, thread_id, {:goal_run_finished, finished_message(result)})
  end

  # Channel-side turn-started fan-out: notify the originating socket and record the
  # codex turn id on the durable thread so a reloaded/other tab can steer it.
  defp notify_turn_started(channel_pid, thread, turn_id) do
    send(channel_pid, {:assistant_turn_started, turn_id})

    if is_map(thread) and is_integer(Map.get(thread, :id)),
      do: TurnManager.note_codex_turn(thread.id, nil, turn_id)
  end

  # A send arrived while a turn is running. Prefer steering the live turn; if there
  # is no steerable worker, queue it so it runs next. Either way the message is
  # persisted to history so it is never lost.
  defp steer_or_queue(thread, trimmed, start_opts, socket) do
    case TurnManager.steer_target(thread.id) do
      {:ok, pid, _codex_turn_id} ->
        maybe_persist_steer(socket, trimmed)
        send(pid, {:codex_steer, [%{"type" => "text", "text" => trimmed}], self()})
        {:reply, :ok, assign(socket, :last_steer_text, trimmed)}

      :error ->
        maybe_persist_steer(socket, trimmed)
        TurnManager.enqueue(thread.id, trimmed, start_opts)
        {:reply, {:ok, %{queued: true}}, socket}
    end
  end

  defp resolve_attachments(_payload, %{scope: "freeform"}, _project_slug), do: {[], []}

  defp resolve_attachments(payload, _thread, project_slug) do
    raw = Map.get(payload, "attachments", [])
    {raw, Payload.normalize_attachments(raw, project_slug)}
  end

  defp run_send_turn(%{scope: "issue"} = thread, _project_slug, trimmed, context, opts) do
    CodexSession.send_message_to_issue_thread(thread, trimmed, context, opts)
  end

  defp run_send_turn(%{scope: "freeform"} = thread, _project_slug, trimmed, context, opts) do
    CodexSession.send_message_to_thread(thread, trimmed, context, opts)
  end

  defp run_send_turn(%{scope: "project_explore"} = thread, _project_slug, trimmed, context, opts) do
    CodexSession.send_message_to_project_explore_thread(thread, trimmed, context, opts)
  end

  defp run_send_turn(%{scope: "kb"} = thread, _project_slug, trimmed, context, opts) do
    CodexSession.send_message_to_kb_thread(thread, trimmed, context, opts)
  end

  defp run_send_turn(_thread, project_slug, trimmed, context, opts) do
    CodexSession.send_message(project_slug, trimmed, context, opts)
  end

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

  defp normalize_issue_mode(mode) do
    normalized = mode |> String.trim() |> String.downcase()

    if normalized in @issue_modes do
      {:ok, normalized}
    else
      {:error, {:unsupported_mode, mode}}
    end
  end

  defp issue_thread(%Socket{assigns: %{thread: %{scope: "issue"} = thread}}), do: {:ok, thread}
  defp issue_thread(_socket), do: {:error, :issue_thread_required}

  # Resolves a fresh issue thread (reloaded from the DB so agent_thread_ids written
  # by a prior turn are visible) that has the Authoring goal enabled.
  defp authoring_goal_thread(socket) do
    with {:ok, %{id: id}} <- issue_thread(socket),
         {:ok, thread} <- History.get_thread(id) do
      if History.thread_goal_mode(thread), do: {:ok, thread}, else: {:error, :goal_mode_disabled}
    else
      {:error, reason} -> {:error, reason}
      _ -> {:error, :issue_thread_required}
    end
  end

  defp with_authoring_goal(socket, action, on_ok) when is_function(action, 1) and is_function(on_ok, 2) do
    case authoring_goal_thread(socket) do
      {:ok, thread} ->
        case action.(thread) do
          {:ok, payload, updated_thread} ->
            on_ok.(payload, assign(socket, :thread, updated_thread))

          {:error, reason} ->
            {:reply, {:error, %{reason: error_reason(reason)}}, socket}
        end

      {:error, reason} ->
        {:reply, {:error, %{reason: error_reason(reason)}}, socket}
    end
  end

  # True when the socket's thread is an issue thread with the Authoring goal enabled.
  # Uses the (fresh-on-set_goal_mode) assigns metadata to avoid a DB read per turn.
  defp authoring_goal_active?(%Socket{assigns: %{thread: %{scope: "issue"} = thread}}),
    do: History.thread_goal_mode(thread)

  defp authoring_goal_active?(_socket), do: false

  # Fetches the native goal off the channel process (a Codex port round-trip can
  # take seconds) and pushes the authoritative status to the client.
  defp push_goal_status_async(%Socket{assigns: %{thread: %{scope: "issue", id: id} = thread}} = socket, running) do
    if History.thread_goal_mode(thread) do
      elapsed = GoalRun.elapsed_seconds(id)

      Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn ->
        with {:ok, reloaded} <- History.get_thread(id),
             {:ok, payload, _t} <- AuthoringGoalControl.status(reloaded) do
          push(socket, "goal_status", goal_status_payload(payload, running, elapsed))
        else
          _ -> :ok
        end
      end)
    end

    :ok
  end

  defp push_goal_status_async(_socket, _running), do: :ok

  # Reflects a freshly-edited objective into the native Codex goal off the channel
  # process, then pushes the authoritative status. Skipped while a turn runs: a
  # competing `thread/goal/set` would block on (or clobber) the in-flight turn's
  # thread, and the metadata is already saved + echoed by the reply.
  defp sync_native_objective_async(%Socket{assigns: %{thread: %{scope: "issue", id: id} = thread}} = socket) do
    if History.thread_goal_mode(thread) and not goal_running?(socket) do
      Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn ->
        with {:ok, reloaded} <- History.get_thread(id),
             {:ok, payload, _t} <- AuthoringGoalControl.sync_native_objective(reloaded) do
          push(socket, "goal_status", goal_status_payload(payload, false))
        else
          _ -> :ok
        end
      end)
    end

    :ok
  end

  defp sync_native_objective_async(_socket), do: :ok

  defp goal_status_payload(payload, running, elapsed_seconds \\ nil) do
    %{
      enabled: payload.enabled,
      objective: payload.objective,
      native: payload.native,
      goal: patch_goal_runtime(payload.goal, elapsed_seconds),
      running: running
    }
  end

  # When no native Codex goal time is available yet (the goal turn is mid-flight,
  # or the native goal isn't created until the turn completes), fall back to the
  # registry's run-elapsed so a reattached pill still shows a live total time.
  defp patch_goal_runtime(goal, elapsed) when is_map(goal) and is_integer(elapsed) do
    case Map.get(goal, :timeUsedSeconds) do
      nil -> Map.put(goal, :timeUsedSeconds, elapsed)
      _ -> goal
    end
  end

  # No native Codex goal yet (it isn't created until a goal turn completes) but a
  # run is in flight: synthesize a minimal active goal so a reattached pill still
  # gets a live total time.
  defp patch_goal_runtime(nil, elapsed) when is_integer(elapsed) do
    %{
      kind: "goal",
      source: "native",
      objective: nil,
      status: "active",
      capabilities: ["get", "edit", "pause", "resume", "clear"],
      tokenBudget: nil,
      tokensUsed: nil,
      timeUsedSeconds: elapsed,
      updatedAt: nil
    }
  end

  defp patch_goal_runtime(goal, _elapsed), do: goal

  # Shared streaming callbacks for assistant turns. Goal threads also fan out
  # deltas/tool events over the thread PubSub topic so a reloaded tab keeps
  # receiving live output, and forward native goal updates to the pill.
  defp turn_stream_opts(%Socket{} = socket, thread, channel_pid, context) when is_map(context) do
    goal_thread = goal_thread?(thread)
    thread_id = if is_map(thread), do: Map.get(thread, :id), else: nil

    push_stream = fn event, payload ->
      push(socket, event, payload)

      if goal_thread and is_integer(thread_id) do
        GoalRun.broadcast_from(channel_pid, thread_id, {:goal_stream, event, payload})
      end
    end

    opts =
      []
      |> maybe_put_runner()
      |> Keyword.merge(Payload.model_opts(context))
      |> Keyword.put(:on_message_created, fn message -> push_stream.("message_created", %{message: message}) end)
      |> Keyword.put(:on_assistant_delta, fn delta -> push_stream.("assistant_delta", %{delta: delta}) end)
      |> Keyword.put(:on_tool_call_started, fn tool_call -> push_stream.("tool_call_started", %{tool_call: tool_call}) end)
      |> Keyword.put(:on_tool_call_completed, fn tool_call ->
        push_stream.("tool_call_completed", %{tool_call: tool_call})
      end)
      |> Keyword.put(:on_documents_changed, fn identifier ->
        push(socket, "assistant_document_changed", %{identifier: identifier})
      end)
      |> Keyword.put(:on_thread_documents_changed, fn tid ->
        push(socket, "assistant_document_changed", %{thread_id: tid})
      end)
      |> Keyword.put(:on_turn_started, fn turn_id -> notify_turn_started(channel_pid, thread, turn_id) end)
      |> Keyword.put(:interactive_user_input, true)
      |> Keyword.put(:on_user_input_required, fn request ->
        send(channel_pid, {:assistant_user_input_required, request})
      end)

    if goal_thread and match?(%{scope: "issue"}, thread) do
      Keyword.put(opts, :on_goal_updated, fn native_goal ->
        send(channel_pid, {:authoring_goal_updated, native_goal})
      end)
    else
      opts
    end
  end

  defp push_live_goal_status(%Socket{assigns: %{thread: %{scope: "issue", id: id} = thread}} = socket, native_goal)
       when is_integer(id) and is_map(native_goal) do
    payload = AuthoringGoalControl.payload_from_native_update(thread, native_goal)
    elapsed = GoalRun.elapsed_seconds(id)
    status = goal_status_payload(payload, goal_running?(socket), elapsed)
    push(socket, "goal_status", status)
    GoalRun.broadcast_from(self(), id, {:goal_status_updated, status})
    socket
  end

  defp push_live_goal_status(socket, _native_goal), do: socket

  # The authoritative "is a goal turn executing" signal: either this socket is
  # running the turn, or the durable registry shows a run in flight for the thread
  # (covers a tab that reattached after a refresh).
  defp goal_running?(%Socket{assigns: %{thread: %{scope: "issue", id: id}}} = socket)
       when is_integer(id),
       do: socket.assigns[:turn_status] == :running or GoalRun.running?(id)

  defp goal_running?(socket), do: socket.assigns[:turn_status] == :running

  defp goal_thread?(%{scope: "issue", id: id} = thread) when is_integer(id),
    do: History.thread_goal_mode(thread)

  defp goal_thread?(_thread), do: false

  # Synthesizes a goal payload carrying an explicit status for cases where no
  # native goal exists yet (e.g. pausing the very first batch before the Codex
  # thread id is persisted), so the pill can still render the right phase.
  defp metadata_goal_payload(thread, status) do
    objective = History.thread_goal_objective(thread)

    %{
      enabled: History.thread_goal_mode(thread),
      objective: objective,
      native: false,
      goal: %{
        kind: "goal",
        source: "native",
        objective: objective,
        status: status,
        capabilities: ["get", "edit", "pause", "resume", "clear"],
        tokenBudget: nil,
        tokensUsed: nil,
        timeUsedSeconds: nil,
        updatedAt: nil
      }
    }
  end

  # Starts an autonomous goal-continuation batch (no user message) that streams
  # each turn into the chat exactly like a normal send.
  defp start_goal_continuation(thread, socket) do
    channel_pid = self()
    opts = turn_stream_opts(socket, thread, channel_pid, %{})

    thread_id = thread.id

    {:ok, pid} =
      Task.Supervisor.start_child(SymphonyElixir.TaskSupervisor, fn ->
        # The Task (not the channel) owns the run lifecycle so it survives a page
        # refresh: register in the durable run registry, run, then notify reloaded/
        # other tabs over PubSub before handing the result back to this channel.
        GoalRun.track(thread_id)
        result = CodexSession.continue_issue_goal(thread, %{}, opts)
        GoalRun.untrack(thread_id)
        GoalRun.broadcast_from(channel_pid, thread_id, {:goal_run_finished, finished_message(result)})
        send(channel_pid, {:assistant_turn_finished, result})
      end)

    ref = Process.monitor(pid)
    GoalRun.broadcast_from(self(), thread_id, {:goal_run_started})

    socket
    |> assign(:turn_status, :running)
    |> assign(:turn_pid, pid)
    |> assign(:turn_ref, ref)
    |> assign(:codex_turn_id, nil)
    |> assign(:goal_paused, false)
  end

  # The assistant message payload a finished run should hand to reloaded/other
  # tabs, or nil when the run errored (those tabs just clear their running state).
  defp finished_message({:ok, %{assistant_chat_message: message}}), do: message
  defp finished_message(_), do: nil

  defp pause_running_turn(socket) do
    if is_pid(socket.assigns[:turn_pid]), do: send(socket.assigns.turn_pid, {:codex_interrupt})
    assign(socket, :goal_paused, true)
  end

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

  defp dispatch_arguments(identifier, goal_mode, agent) do
    base = %{"identifier" => identifier, "instructions" => dispatch_instructions(identifier)}

    base =
      if goal_mode do
        Map.put(base, "goal", dispatch_goal(identifier))
      else
        base
      end

    if is_binary(agent) do
      Map.put(base, "agent", agent)
    else
      base
    end
  end

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
  defp error_reason({:unsupported_mode, mode}), do: "unsupported mode: #{mode}. Expected one of: #{Enum.join(@issue_modes, ", ")}"
  defp error_reason(:issue_thread_required), do: "this action is only supported for issue assistant threads"
  defp error_reason(:message_required), do: "message is required"
  defp error_reason({:turn_crashed, reason}), do: "assistant turn crashed: #{inspect(reason)}"
  defp error_reason(%Ecto.Changeset{}), do: "failed to persist mode"
  defp error_reason(reason), do: inspect(reason)
end
