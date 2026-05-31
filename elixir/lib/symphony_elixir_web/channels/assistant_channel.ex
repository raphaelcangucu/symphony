defmodule SymphonyElixirWeb.AssistantChannel do
  @moduledoc "Project-scoped realtime channel for Codex-backed tracker assistant chat."

  use Phoenix.Channel

  alias Phoenix.Socket
  alias SymphonyElixir.Assistant.{CodexSession, History}
  alias SymphonyElixir.Config
  alias SymphonyElixirWeb.TrackerAuth

  @impl true
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
    project_slug = socket.assigns.project_slug
    context = normalize_context(Map.get(payload, "context", %{}))
    trimmed = String.trim(message)

    if trimmed == "" do
      {:reply, {:error, %{reason: "message is required"}}, socket}
    else
      opts =
        []
        |> maybe_put_runner()
        |> Keyword.put(:on_message_created, fn message -> push(socket, "message_created", %{message: message}) end)
        |> Keyword.put(:on_assistant_delta, fn delta -> push(socket, "assistant_delta", %{delta: delta}) end)
        |> Keyword.put(:on_tool_call_started, fn tool_call -> push(socket, "tool_call_started", %{tool_call: tool_call}) end)
        |> Keyword.put(:on_tool_call_completed, fn tool_call -> push(socket, "tool_call_completed", %{tool_call: tool_call}) end)

      case CodexSession.send_message(project_slug, trimmed, context, opts) do
        {:ok, result} ->
          push(socket, "assistant_completed", %{
            message: result.assistant_chat_message
          })

          {:reply, :ok, socket}

        {:error, reason} ->
          push(socket, "assistant_error", %{message: error_reason(reason)})
          {:reply, {:error, %{reason: error_reason(reason)}}, socket}
      end
    end
  end

  def handle_in("send_message", _payload, socket), do: {:reply, {:error, %{reason: "message is required"}}, socket}

  @impl true
  def handle_info({:assistant_history_loaded, payload}, socket) do
    push(socket, "history_loaded", payload)
    {:noreply, socket}
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
