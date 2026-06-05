defmodule SymphonyElixirWeb.AssistantChannel do
  @moduledoc "Project-scoped realtime channel for Codex-backed tracker assistant chat."

  use Phoenix.Channel

  alias Phoenix.Socket
  alias SymphonyElixir.Assistant.{CodexSession, History, Payload, SideQuery, ToolExecutor}
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
      payload = %{
        messages: Enum.map(History.list_messages_for_thread(thread.id), &History.message_payload/1),
        thread_id: thread.id,
        mode: History.thread_mode(thread),
        goal_mode: History.thread_goal_mode(thread),
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
      payload = %{
        messages: Enum.map(History.list_messages_for_thread(thread.id), &History.message_payload/1),
        thread_id: thread.id,
        mode: History.thread_mode(thread),
        goal_mode: History.thread_goal_mode(thread),
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
      payload = %{
        messages: Enum.map(History.list_messages_for_thread(thread.id), &History.message_payload/1),
        mode: History.thread_mode(thread),
        goal_mode: History.thread_goal_mode(thread),
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
    if socket.assigns[:turn_status] == :running do
      {:reply, {:error, %{reason: "assistant is busy"}}, socket}
    else
      do_send_message(message, payload, socket)
    end
  end

  def handle_in("send_message", _payload, socket), do: {:reply, {:error, %{reason: "message is required"}}, socket}

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

  def handle_in("set_goal_mode", %{"goal_mode" => enabled}, socket) when is_boolean(enabled) do
    with {:ok, thread} <- issue_thread(socket),
         {:ok, updated_thread} <- History.set_goal_mode(thread, enabled) do
      {:reply, {:ok, %{goal_mode: enabled}}, assign(socket, :thread, updated_thread)}
    else
      {:error, reason} -> {:reply, {:error, %{reason: error_reason(reason)}}, socket}
    end
  end

  def handle_in("set_goal_mode", _payload, socket),
    do: {:reply, {:error, %{reason: "goal_mode is required"}}, socket}

  def handle_in("dispatch_coding_agent", payload, socket), do: do_dispatch(payload, socket)

  def handle_in("dispatch_codex", payload, socket), do: do_dispatch(payload, socket)

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

  def handle_in("steer_turn", %{"message" => message}, socket) when is_binary(message) do
    trimmed = String.trim(message)

    cond do
      trimmed == "" ->
        {:reply, {:error, %{reason: "message is required"}}, socket}

      socket.assigns[:turn_status] != :running or not is_pid(socket.assigns[:turn_pid]) or
          is_nil(socket.assigns[:codex_turn_id]) ->
        {:reply, {:error, %{reason: "ActiveTurnNotSteerable"}}, socket}

      true ->
        maybe_persist_steer(socket, trimmed)
        send(socket.assigns.turn_pid, {:codex_steer, [%{"type" => "text", "text" => trimmed}], self()})
        {:reply, :ok, assign(socket, :last_steer_text, trimmed)}
    end
  end

  def handle_in("steer_turn", _payload, socket),
    do: {:reply, {:error, %{reason: "message is required"}}, socket}

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

  @impl true
  def handle_info({:assistant_history_loaded, payload}, socket) do
    push(socket, "history_loaded", payload)
    {:noreply, socket}
  end

  def handle_info({:assistant_turn_started, turn_id}, socket) do
    {:noreply, assign(socket, :codex_turn_id, turn_id)}
  end

  def handle_info({:assistant_turn_finished, {:ok, result}}, socket) do
    push(socket, "assistant_completed", %{message: result.assistant_chat_message})
    maybe_push_created_issue(result, socket)
    {:noreply, reset_turn(socket)}
  end

  def handle_info({:assistant_turn_finished, {:error, reason}}, socket) do
    push(socket, "assistant_error", %{message: error_reason(reason)})
    {:noreply, reset_turn(socket)}
  end

  def handle_info({:DOWN, ref, :process, _pid, reason}, %{assigns: %{turn_ref: ref}} = socket) do
    if socket.assigns[:turn_status] == :running do
      push(socket, "assistant_error", %{message: error_reason({:turn_crashed, reason})})
    end

    {:noreply, reset_turn(socket)}
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
          []
          |> maybe_put_runner()
          |> Keyword.merge(Payload.model_opts(context))
          |> Keyword.put(:attachments, attachments)
          |> Keyword.put(:on_message_created, fn message -> push(socket, "message_created", %{message: message}) end)
          |> Keyword.put(:on_assistant_delta, fn delta -> push(socket, "assistant_delta", %{delta: delta}) end)
          |> Keyword.put(:on_tool_call_started, fn tool_call -> push(socket, "tool_call_started", %{tool_call: tool_call}) end)
          |> Keyword.put(:on_tool_call_completed, fn tool_call -> push(socket, "tool_call_completed", %{tool_call: tool_call}) end)
          |> Keyword.put(:on_documents_changed, fn identifier ->
            push(socket, "assistant_document_changed", %{identifier: identifier})
          end)
          |> Keyword.put(:on_thread_documents_changed, fn thread_id ->
            push(socket, "assistant_document_changed", %{thread_id: thread_id})
          end)
          |> Keyword.put(:on_turn_started, fn turn_id -> send(channel_pid, {:assistant_turn_started, turn_id}) end)
          |> Keyword.put(:interactive_user_input, true)
          |> Keyword.put(:on_user_input_required, fn request ->
            send(channel_pid, {:assistant_user_input_required, request})
          end)

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
       when scope in ["issue", "freeform", "project_explore"],
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

  defp dispatch_goal_mode(payload, thread) when is_map(payload) do
    case Map.get(payload, "goal_mode") do
      enabled when is_boolean(enabled) -> enabled
      _ -> History.thread_goal_mode(thread)
    end
  end

  defp agent_from_payload(payload) when is_map(payload) do
    case Map.get(payload, "agent") do
      agent when is_binary(agent) -> agent
      _ -> nil
    end
  end

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
