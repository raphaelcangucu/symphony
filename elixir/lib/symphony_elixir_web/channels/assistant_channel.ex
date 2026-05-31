defmodule SymphonyElixirWeb.AssistantChannel do
  @moduledoc "Project-scoped realtime channel for Codex-backed tracker assistant chat."

  use Phoenix.Channel

  alias Phoenix.Socket
  alias SymphonyElixir.Assistant.{CodexSession, History, Payload}
  alias SymphonyElixir.Config
  alias SymphonyElixirWeb.TrackerAuth

  @impl true
  def join("assistant:thread:" <> raw_id, _payload, socket) do
    with true <- authorized?(socket),
         {:ok, id} <- parse_id(raw_id),
         {:ok, thread} <- History.get_thread(id) do
      payload = %{messages: Enum.map(History.list_messages_for_thread(thread.id), &History.message_payload/1)}
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
          payload = %{messages: Enum.map(messages, &History.message_payload/1)}
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
        context =
          context
          |> Map.put("attachments", Payload.attachment_summary(attachments))
          |> Map.put("model", Map.get(context, "model") || Map.get(context, :model))
          |> Map.put("effort", Map.get(context, "effort") || Map.get(context, :effort))

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

        thread
        |> run_send_turn(project_slug, trimmed, context, opts)
        |> handle_turn_result(socket)
    end
  end

  def handle_in("send_message", _payload, socket), do: {:reply, {:error, %{reason: "message is required"}}, socket}

  @impl true
  def handle_info({:assistant_history_loaded, payload}, socket) do
    push(socket, "history_loaded", payload)
    {:noreply, socket}
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

  defp run_send_turn(_thread, project_slug, trimmed, context, opts) do
    CodexSession.send_message(project_slug, trimmed, context, opts)
  end

  defp handle_turn_result({:ok, result}, socket) do
    push(socket, "assistant_completed", %{message: result.assistant_chat_message})
    {:reply, :ok, socket}
  end

  defp handle_turn_result({:error, reason}, socket) do
    push(socket, "assistant_error", %{message: error_reason(reason)})
    {:reply, {:error, %{reason: error_reason(reason)}}, socket}
  end

  defp parse_id(raw) do
    case Integer.parse(raw) do
      {id, ""} -> {:ok, id}
      _ -> {:error, :invalid_id}
    end
  end

  defp maybe_put_runner(opts) do
    case Application.get_env(:symphony_elixir, :assistant_runner) do
      runner when is_function(runner, 4) -> Keyword.put(opts, :runner, runner)
      _ -> opts
    end
  end

  defp normalize_context(context) when is_map(context), do: context
  defp normalize_context(_context), do: %{}

  defp authorized?(%Socket{assigns: %{tracker_token_valid: true}}), do: true

  defp authorized?(%Socket{assigns: %{token: token}}) when is_binary(token) do
    TrackerAuth.valid_token?(token, System.get_env(Config.local_api_token_env()))
  end

  defp authorized?(_socket), do: false

  defp error_reason(reason) when is_binary(reason), do: reason
  defp error_reason({:missing_required_field, field}), do: "#{field} is required"
  defp error_reason(:project_not_found), do: "project not found"
  defp error_reason(:message_required), do: "message is required"
  defp error_reason(reason), do: inspect(reason)
end
