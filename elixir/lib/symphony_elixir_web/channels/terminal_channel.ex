defmodule SymphonyElixirWeb.TerminalChannel do
  @moduledoc "Issue-scoped terminal channel for local tracker tmux sessions."

  use Phoenix.Channel

  alias Phoenix.Socket
  alias SymphonyElixir.Config
  alias SymphonyElixir.Terminal.Registry
  alias SymphonyElixirWeb.TrackerAuth

  @capture_delays_ms [50, 250, 750]

  @impl true
  def join("terminal:" <> topic_rest, %{"project_slug" => project_slug}, socket)
      when is_binary(project_slug) and project_slug != "" do
    if authorized?(socket) do
      case parse_topic(topic_rest, project_slug) do
        {:ok, issue_identifier} ->
          case Registry.open_project_issue_session(project_slug, issue_identifier) do
            {:ok, session} ->
              socket =
                socket
                |> assign(:issue_identifier, issue_identifier)
                |> assign(:project_slug, project_slug)

              {:ok, %{session: session_payload(session)}, socket}

            {:error, reason} ->
              {:error, %{reason: error_reason(reason)}}
          end

        {:error, reason} ->
          {:error, %{reason: reason}}
      end
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  def join(_topic, _payload, _socket), do: {:error, %{reason: "invalid_topic"}}

  @impl true
  def handle_in("input", %{"data" => data}, socket) when is_binary(data) do
    issue_identifier = socket.assigns.issue_identifier
    project_slug = socket.assigns.project_slug

    case Registry.send_input(project_slug, issue_identifier, data) do
      :ok ->
        push_capture(socket, project_slug, issue_identifier)
        schedule_followup_captures(project_slug, issue_identifier)
        {:noreply, socket}

      {:error, message} ->
        push(socket, "error", %{message: message})
        {:noreply, socket}
    end
  end

  def handle_in("input", _payload, socket) do
    push(socket, "error", %{message: "terminal input data is required"})
    {:noreply, socket}
  end

  @impl true
  def handle_in("resize", %{"cols" => cols, "rows" => rows}, socket) when is_integer(cols) and is_integer(rows) do
    issue_identifier = socket.assigns.issue_identifier
    project_slug = socket.assigns.project_slug

    case Registry.resize(project_slug, issue_identifier, cols, rows) do
      :ok ->
        {:noreply, socket}

      {:error, message} ->
        push(socket, "error", %{message: message})
        {:noreply, socket}
    end
  end

  def handle_in("resize", _payload, socket) do
    push(socket, "error", %{message: "terminal resize cols and rows are required"})
    {:noreply, socket}
  end

  @impl true
  def handle_info({:capture_terminal, project_slug, issue_identifier}, socket) do
    push_capture(socket, project_slug, issue_identifier)
    {:noreply, socket}
  end

  defp schedule_followup_captures(project_slug, issue_identifier) do
    Enum.each(@capture_delays_ms, fn delay_ms ->
      Process.send_after(self(), {:capture_terminal, project_slug, issue_identifier}, delay_ms)
    end)
  end

  defp push_capture(socket, project_slug, issue_identifier) do
    case Registry.capture(project_slug, issue_identifier) do
      {:ok, output} -> push(socket, "output", %{data: output})
      {:error, message} -> push(socket, "error", %{message: message})
    end
  end

  defp session_payload(session) do
    %{
      project_slug: session.project_slug,
      issue_identifier: session.issue_identifier,
      session_name: session.session_name,
      cwd: session.cwd,
      state: session.state,
      output: session.output
    }
  end

  defp error_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp error_reason(reason) when is_binary(reason), do: reason
  defp error_reason(reason), do: inspect(reason)

  defp authorized?(%Socket{assigns: %{tracker_token_valid: true}}), do: true

  defp authorized?(%Socket{assigns: %{token: token}}) when is_binary(token) do
    TrackerAuth.valid_token?(token, System.get_env(Config.local_api_token_env()))
  end

  defp authorized?(_socket), do: false

  defp parse_topic(topic_rest, project_slug) do
    prefix = project_slug <> ":"

    cond do
      String.starts_with?(topic_rest, prefix) ->
        case String.replace_prefix(topic_rest, prefix, "") do
          "" -> {:error, "invalid_topic"}
          issue_identifier -> {:ok, issue_identifier}
        end

      true ->
        {:error, "invalid_topic"}
    end
  end
end
