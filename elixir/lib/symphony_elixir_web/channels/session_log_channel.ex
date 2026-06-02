defmodule SymphonyElixirWeb.SessionLogChannel do
  @moduledoc "Streams Codex rollout JSONL session logs for an issue workspace."

  use Phoenix.Channel

  alias Phoenix.Socket
  alias SymphonyElixir.Codex.SessionLog
  alias SymphonyElixir.Workspace
  alias SymphonyElixirWeb.TrackerAuth

  @poll_ms 500

  @impl true
  def join("session_log:" <> topic_rest, %{"project_slug" => project_slug}, socket)
      when is_binary(project_slug) and project_slug != "" do
    with :ok <- authorize(socket),
         {:ok, issue_identifier} <- parse_topic(topic_rest, project_slug),
         workspace <- Workspace.path_for_issue(issue_identifier),
         {:ok, path} <- SessionLog.resolve_rollout_path(workspace) do
      {:ok, lines, offset} = SessionLog.tail(path)

      socket =
        socket
        |> assign(:issue_identifier, issue_identifier)
        |> assign(:project_slug, project_slug)
        |> assign(:workspace, workspace)
        |> assign(:path, path)
        |> assign(:offset, offset)

      send(self(), :poll)

      {:ok, %{entries: lines, offset: offset, path: path}, socket}
    else
      :error -> {:error, %{reason: "session_log_unavailable"}}
      {:error, reason} -> {:error, %{reason: error_reason(reason)}}
    end
  end

  def join(_topic, _payload, _socket), do: {:error, %{reason: "invalid_topic"}}

  @impl true
  def handle_info(:poll, %{assigns: %{path: path, offset: offset}} = socket) do
    socket =
      case SessionLog.read_from(path, offset) do
        {:ok, lines, new_offset} when lines != [] ->
          push(socket, "entries", %{entries: lines, offset: new_offset})
          assign(socket, :offset, new_offset)

        {:ok, _lines, new_offset} ->
          assign(socket, :offset, new_offset)

        {:error, _reason} ->
          socket
      end

    Process.send_after(self(), :poll, @poll_ms)
    {:noreply, socket}
  end

  defp authorized?(%Socket{assigns: %{tracker_token_valid: true}}), do: true

  defp authorized?(%Socket{assigns: %{token: token}}) when is_binary(token) do
    alias SymphonyElixir.Config
    TrackerAuth.valid_token?(token, System.get_env(Config.local_api_token_env()))
  end

  defp authorized?(_socket), do: false

  defp authorize(socket) do
    if authorized?(socket), do: :ok, else: {:error, "unauthorized"}
  end

  defp parse_topic(topic_rest, project_slug) do
    prefix = project_slug <> ":"

    if String.starts_with?(topic_rest, prefix) do
      case String.replace_prefix(topic_rest, prefix, "") do
        "" -> {:error, "invalid_topic"}
        issue_identifier -> {:ok, issue_identifier}
      end
    else
      {:error, "invalid_topic"}
    end
  end

  defp error_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp error_reason(reason) when is_binary(reason), do: reason
  defp error_reason(reason), do: inspect(reason)
end
