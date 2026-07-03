defmodule SymphonyElixirWeb.TerminalChannel do
  @moduledoc "Issue-scoped terminal channel for local tracker tmux sessions."

  use Phoenix.Channel
  use Gettext, backend: SymphonyElixirWeb.Gettext

  alias Gettext, as: GettextCore
  alias Phoenix.Socket
  alias SymphonyElixir.Config
  alias SymphonyElixir.Terminal.{ErrorMessages, Registry}
  alias SymphonyElixirWeb.TrackerAuth

  @capture_delays_ms [50, 250, 750]

  @impl true
  def join("terminal:devenv:" <> project_slug, _payload, socket)
      when is_binary(project_slug) and project_slug != "" do
    with :ok <- authorize(socket),
         {:ok, session} <- Registry.open_project_session(project_slug) do
      socket =
        socket
        |> assign(:project_slug, project_slug)
        |> assign(:devenv, true)

      {:ok, %{session: session_payload(session)}, socket}
    else
      {:error, reason} -> {:error, %{reason: error_reason(socket, reason)}}
    end
  end

  def join("terminal:tab:" <> topic_rest, _payload, socket) do
    with :ok <- authorize(socket),
         {:ok, project_slug, tab_id} <- parse_tab_topic(topic_rest),
         {:ok, session} <- Registry.open_tab_session(project_slug, tab_id) do
      socket =
        socket
        |> assign(:project_slug, project_slug)
        |> assign(:tab_id, tab_id)
        |> assign(:tab, true)

      {:ok, %{session: tab_session_payload(session)}, socket}
    else
      {:error, reason} -> {:error, %{reason: error_reason(socket, reason)}}
    end
  end

  def join("terminal:" <> topic_rest, %{"project_slug" => project_slug}, socket)
      when is_binary(project_slug) and project_slug != "" do
    with :ok <- authorize(socket),
         {:ok, issue_identifier} <- parse_topic(topic_rest, project_slug),
         {:ok, session} <- Registry.open_project_issue_session(project_slug, issue_identifier) do
      socket =
        socket
        |> assign(:issue_identifier, issue_identifier)
        |> assign(:project_slug, project_slug)

      {:ok, %{session: session_payload(session)}, socket}
    else
      {:error, reason} -> {:error, %{reason: error_reason(socket, reason)}}
    end
  end

  def join(_topic, _payload, _socket), do: {:error, %{reason: "invalid_topic"}}

  @impl true
  def handle_in("input", %{"data" => data}, %{assigns: %{devenv: true, project_slug: project_slug}} = socket)
      when is_binary(data) do
    case Registry.send_input_project(project_slug, data) do
      :ok ->
        push_devenv_capture(socket, project_slug)
        Enum.each(@capture_delays_ms, fn d -> Process.send_after(self(), {:capture_devenv, project_slug}, d) end)
        {:noreply, socket}

      {:error, message} ->
        push(socket, "error", %{message: present_error(socket, message)})
        {:noreply, socket}
    end
  end

  def handle_in("input", %{"data" => data}, %{assigns: %{tab: true, project_slug: project_slug, tab_id: tab_id}} = socket)
      when is_binary(data) do
    case Registry.send_input_tab(project_slug, tab_id, data) do
      :ok ->
        push_tab_capture(socket, project_slug, tab_id)
        schedule_followup_tab_captures(project_slug, tab_id)
        {:noreply, socket}

      {:error, message} ->
        push(socket, "error", %{message: present_error(socket, message)})
        {:noreply, socket}
    end
  end

  def handle_in("input", %{"data" => data}, socket) when is_binary(data) do
    issue_identifier = socket.assigns.issue_identifier
    project_slug = socket.assigns.project_slug

    case Registry.send_input(project_slug, issue_identifier, data) do
      :ok ->
        push_capture(socket, project_slug, issue_identifier)
        schedule_followup_captures(project_slug, issue_identifier)
        {:noreply, socket}

      {:error, message} ->
        push(socket, "error", %{message: present_error(socket, message)})
        {:noreply, socket}
    end
  end

  def handle_in("input", _payload, socket) do
    push(socket, "error", %{message: localized_message(socket, "terminal input data is required")})
    {:noreply, socket}
  end

  def handle_in("resize", _payload, %{assigns: %{devenv: true}} = socket) do
    {:noreply, socket}
  end

  def handle_in("resize", %{"cols" => cols, "rows" => rows}, %{assigns: %{tab: true, project_slug: project_slug, tab_id: tab_id}} = socket)
      when is_integer(cols) and is_integer(rows) do
    case Registry.resize_tab(project_slug, tab_id, cols, rows) do
      :ok ->
        push_tab_capture(socket, project_slug, tab_id)
        {:noreply, socket}

      {:error, message} ->
        push(socket, "error", %{message: present_error(socket, message)})
        {:noreply, socket}
    end
  end

  def handle_in("resize", %{"cols" => cols, "rows" => rows}, socket) when is_integer(cols) and is_integer(rows) do
    issue_identifier = socket.assigns.issue_identifier
    project_slug = socket.assigns.project_slug

    case Registry.resize(project_slug, issue_identifier, cols, rows) do
      :ok ->
        push_capture(socket, project_slug, issue_identifier)
        {:noreply, socket}

      {:error, message} ->
        push(socket, "error", %{message: present_error(socket, message)})
        {:noreply, socket}
    end
  end

  def handle_in("resize", _payload, socket) do
    push(socket, "error", %{message: localized_message(socket, "terminal resize cols and rows are required")})
    {:noreply, socket}
  end

  @impl true
  def handle_info({:capture_terminal, project_slug, issue_identifier}, socket) do
    push_capture(socket, project_slug, issue_identifier)
    {:noreply, socket}
  end

  def handle_info({:capture_devenv, project_slug}, socket) do
    push_devenv_capture(socket, project_slug)
    {:noreply, socket}
  end

  def handle_info({:capture_tab, project_slug, tab_id}, socket) do
    push_tab_capture(socket, project_slug, tab_id)
    {:noreply, socket}
  end

  defp schedule_followup_captures(project_slug, issue_identifier) do
    Enum.each(@capture_delays_ms, fn delay_ms ->
      Process.send_after(self(), {:capture_terminal, project_slug, issue_identifier}, delay_ms)
    end)
  end

  defp schedule_followup_tab_captures(project_slug, tab_id) do
    Enum.each(@capture_delays_ms, fn delay_ms ->
      Process.send_after(self(), {:capture_tab, project_slug, tab_id}, delay_ms)
    end)
  end

  defp push_capture(socket, project_slug, issue_identifier) do
    case Registry.capture(project_slug, issue_identifier) do
      {:ok, output} -> push(socket, "output", %{data: output})
      {:error, message} -> push(socket, "error", %{message: present_error(socket, message)})
    end
  end

  defp push_devenv_capture(socket, project_slug) do
    case Registry.capture_project(project_slug) do
      {:ok, output} -> push(socket, "output", %{data: output})
      {:error, message} -> push(socket, "error", %{message: present_error(socket, message)})
    end
  end

  defp push_tab_capture(socket, project_slug, tab_id) do
    case Registry.capture_tab(project_slug, tab_id) do
      {:ok, output} -> push(socket, "output", %{data: output})
      {:error, message} -> push(socket, "error", %{message: present_error(socket, message)})
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

  defp tab_session_payload(session) do
    %{
      id: session.id,
      project_slug: session.project_slug,
      issue_identifier: session.issue_identifier,
      title: session.title,
      cwd: session.cwd,
      command: session.command,
      session_name: session.session_name,
      state: session.state,
      channel_topic: session.channel_topic,
      output: session.output
    }
  end

  defp error_reason(socket, reason), do: present_error(socket, reason)

  defp present_error(socket, reason) do
    ErrorMessages.localize(reason, Map.get(socket.assigns, :gettext_locale, "en"))
  end

  defp localized_message(socket, msgid, bindings \\ %{}) when is_binary(msgid) and is_map(bindings) do
    localized_gettext(socket, msgid, bindings)
  end

  defp localized_gettext(socket, msgid, bindings) do
    locale = Map.get(socket.assigns, :gettext_locale, "en")

    GettextCore.with_locale(SymphonyElixirWeb.Gettext, locale, fn ->
      GettextCore.dgettext(SymphonyElixirWeb.Gettext, "errors", msgid, bindings)
    end)
  end

  defp authorized?(%Socket{assigns: %{tracker_token_valid: true}}), do: true

  defp authorized?(%Socket{assigns: %{token: token}}) when is_binary(token) do
    TrackerAuth.valid_token?(token, System.get_env(Config.local_api_token_env()))
  end

  defp authorized?(_socket), do: false

  defp authorize(socket) do
    if authorized?(socket), do: :ok, else: {:error, "unauthorized"}
  end

  defp parse_tab_topic(topic_rest) do
    case String.split(topic_rest, ":", parts: 2) do
      [project_slug, tab_id] when project_slug != "" and tab_id != "" ->
        {:ok, project_slug, tab_id}

      _ ->
        {:error, "invalid_topic"}
    end
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
end
