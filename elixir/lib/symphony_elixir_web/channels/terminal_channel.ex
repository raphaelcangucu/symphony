defmodule SymphonyElixirWeb.TerminalChannel do
  @moduledoc "Issue-scoped terminal channel for local tracker tmux sessions."

  use Phoenix.Channel
  use Gettext, backend: SymphonyElixirWeb.Gettext

  alias Gettext, as: GettextCore
  alias Phoenix.Socket
  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.Config
  alias SymphonyElixir.Terminal.{ErrorMessages, Registry}
  alias SymphonyElixirWeb.TrackerAuth

  @capture_delays_ms [50, 250, 750]
  @dev_capture_tick_ms 1_000

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

  def join("terminal:thread:" <> raw_thread_id, payload, socket) when is_map(payload) do
    with :ok <- authorize(socket),
         {:ok, thread_id} <- parse_thread_id(raw_thread_id),
         {:ok, thread} <- History.get_thread(thread_id),
         :ok <- validate_thread_project(thread, Map.get(payload, "project_slug")),
         {:ok, workspace_path} <- thread_workspace_path(thread),
         {:ok, session} <- Registry.open_workspace_session(thread.project_slug, workspace_path) do
      socket =
        socket
        |> assign(:project_slug, thread.project_slug)
        |> assign(:thread_id, thread_id)
        |> assign(:workspace_path, session.cwd)
        |> assign(:thread_terminal, true)

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

  # Interactive attach to one dev server's tmux session (the same session the
  # preview dock streams). Lets an operator send keystrokes — cancel a boot
  # with Ctrl+C and take over from the same shell.
  def join("terminal:dev:" <> topic_rest, _payload, socket) do
    with :ok <- authorize(socket),
         {:ok, project_slug, issue_identifier, slug} <- parse_dev_topic(topic_rest),
         true <- Registry.dev_session_exists?(project_slug, issue_identifier, slug) do
      socket =
        socket
        |> assign(:project_slug, project_slug)
        |> assign(:issue_identifier, issue_identifier)
        |> assign(:dev_slug, slug)
        |> assign(:dev, true)

      output =
        case Registry.capture_dev_session(project_slug, issue_identifier, slug) do
          {:ok, captured} -> captured
          {:error, _reason} -> ""
        end

      # Keep the attached terminal live even without keystrokes (builds/logs
      # stream while the operator just watches).
      Process.send_after(self(), :dev_capture_tick, @dev_capture_tick_ms)

      {:ok, %{session: dev_session_payload(project_slug, issue_identifier, slug, output)}, socket}
    else
      false -> {:error, %{reason: localized_message(socket, "dev server session not found")}}
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

  def handle_in(
        "input",
        %{"data" => data},
        %{assigns: %{thread_terminal: true, project_slug: project_slug, workspace_path: workspace_path}} = socket
      )
      when is_binary(data) do
    case Registry.send_input_workspace(project_slug, workspace_path, data) do
      :ok ->
        push_workspace_capture(socket, project_slug, workspace_path)
        schedule_followup_workspace_captures(project_slug, workspace_path)
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

  def handle_in(
        "input",
        %{"data" => data},
        %{assigns: %{dev: true, project_slug: project_slug, issue_identifier: issue_identifier, dev_slug: slug}} = socket
      )
      when is_binary(data) do
    case Registry.send_input_dev(project_slug, issue_identifier, slug, data) do
      :ok ->
        push_dev_capture(socket, project_slug, issue_identifier, slug)
        schedule_followup_dev_captures(project_slug, issue_identifier, slug)
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

  def handle_in(
        "resize",
        %{"cols" => cols, "rows" => rows},
        %{assigns: %{thread_terminal: true, project_slug: project_slug, workspace_path: workspace_path}} = socket
      )
      when is_integer(cols) and is_integer(rows) do
    case Registry.resize_workspace(project_slug, workspace_path, cols, rows) do
      :ok ->
        push_workspace_capture(socket, project_slug, workspace_path)
        {:noreply, socket}

      {:error, message} ->
        push(socket, "error", %{message: present_error(socket, message)})
        {:noreply, socket}
    end
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

  def handle_in(
        "resize",
        %{"cols" => cols, "rows" => rows},
        %{assigns: %{dev: true, project_slug: project_slug, issue_identifier: issue_identifier, dev_slug: slug}} = socket
      )
      when is_integer(cols) and is_integer(rows) do
    case Registry.resize_dev(project_slug, issue_identifier, slug, cols, rows) do
      :ok ->
        push_dev_capture(socket, project_slug, issue_identifier, slug)
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

  def handle_info({:capture_workspace_terminal, project_slug, workspace_path}, socket) do
    push_workspace_capture(socket, project_slug, workspace_path)
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

  def handle_info({:capture_dev, project_slug, issue_identifier, slug}, socket) do
    push_dev_capture(socket, project_slug, issue_identifier, slug)
    {:noreply, socket}
  end

  def handle_info(
        :dev_capture_tick,
        %{assigns: %{dev: true, project_slug: project_slug, issue_identifier: issue_identifier, dev_slug: slug}} = socket
      ) do
    push_dev_capture(socket, project_slug, issue_identifier, slug)
    Process.send_after(self(), :dev_capture_tick, @dev_capture_tick_ms)
    {:noreply, socket}
  end

  def handle_info(:dev_capture_tick, socket), do: {:noreply, socket}

  defp schedule_followup_captures(project_slug, issue_identifier) do
    Enum.each(@capture_delays_ms, fn delay_ms ->
      Process.send_after(self(), {:capture_terminal, project_slug, issue_identifier}, delay_ms)
    end)
  end

  defp schedule_followup_workspace_captures(project_slug, workspace_path) do
    Enum.each(@capture_delays_ms, fn delay_ms ->
      Process.send_after(self(), {:capture_workspace_terminal, project_slug, workspace_path}, delay_ms)
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

  defp push_workspace_capture(socket, project_slug, workspace_path) do
    case Registry.capture_workspace(project_slug, workspace_path) do
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

  defp push_dev_capture(socket, project_slug, issue_identifier, slug) do
    case Registry.capture_dev_session(project_slug, issue_identifier, slug) do
      {:ok, output} -> push(socket, "output", %{data: output})
      {:error, message} -> push(socket, "error", %{message: present_error(socket, message)})
    end
  end

  defp schedule_followup_dev_captures(project_slug, issue_identifier, slug) do
    Enum.each(@capture_delays_ms, fn delay_ms ->
      Process.send_after(self(), {:capture_dev, project_slug, issue_identifier, slug}, delay_ms)
    end)
  end

  defp dev_session_payload(project_slug, issue_identifier, slug, output) do
    %{
      project_slug: project_slug,
      issue_identifier: issue_identifier,
      server_slug: slug,
      session_name: Registry.dev_session_name(project_slug, issue_identifier, slug),
      state: "running",
      output: output
    }
  end

  defp parse_dev_topic(topic_rest) do
    case String.split(topic_rest, ":", parts: 3) do
      [project_slug, issue_identifier, slug]
      when project_slug != "" and issue_identifier != "" and slug != "" ->
        {:ok, project_slug, issue_identifier, slug}

      _invalid ->
        {:error, "invalid_topic"}
    end
  end

  defp session_payload(session) do
    %{
      project_slug: session.project_slug,
      issue_identifier: session.issue_identifier,
      session_name: session.session_name,
      cwd: session.cwd,
      state: session.state,
      output: session.output,
      workspace_path: Map.get(session, :workspace_path)
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

  defp parse_thread_id(raw_thread_id) do
    case Integer.parse(raw_thread_id) do
      {thread_id, ""} when thread_id > 0 -> {:ok, thread_id}
      _invalid -> {:error, "invalid_topic"}
    end
  end

  defp validate_thread_project(%{project_slug: project_slug}, nil)
       when is_binary(project_slug) and project_slug != "",
       do: :ok

  defp validate_thread_project(%{project_slug: project_slug}, project_slug)
       when is_binary(project_slug) and project_slug != "",
       do: :ok

  defp validate_thread_project(_thread, _payload_project_slug), do: {:error, "project_mismatch"}

  defp thread_workspace_path(%{workspace_path: workspace_path})
       when is_binary(workspace_path) and workspace_path != "",
       do: {:ok, workspace_path}

  defp thread_workspace_path(_thread), do: {:error, :workspace_missing}
end
