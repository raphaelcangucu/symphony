defmodule SymphonyElixirWeb.SessionLogChannel do
  @moduledoc "Streams agent session logs for an issue workspace, routing to the correct backend by agent_kind."

  use Phoenix.Channel

  alias Phoenix.Socket
  alias SymphonyElixir.AgentRunner
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.IssueMapper
  alias SymphonyElixir.Orchestrator
  alias SymphonyElixir.SessionEvents
  alias SymphonyElixir.SessionLog
  alias SymphonyElixir.Workspace
  alias SymphonyElixirWeb.TrackerAuth

  @poll_ms 500

  @impl true
  def join("session_log:" <> topic_rest, %{"project_slug" => project_slug} = params, socket)
      when is_binary(project_slug) and project_slug != "" do
    case Integer.parse(topic_rest) do
      {session_id, ""} -> join_session(session_id, project_slug, socket)
      _ -> join_by_issue(topic_rest, project_slug, params, socket)
    end
  end

  def join(_topic, _payload, _socket), do: {:error, %{reason: "invalid_topic"}}

  defp join_by_issue(topic_rest, project_slug, params, socket) do
    with :ok <- authorize(socket),
         {:ok, issue_identifier} <- parse_topic(topic_rest, project_slug),
         preferred_agent_kind <- preferred_agent_kind(params, project_slug, issue_identifier),
         workspace <- run_log_workspace(project_slug, issue_identifier),
         {:ok, log_agent_kind, path} <- SessionLog.resolve_log_source(preferred_agent_kind, workspace) do
      log_opts = SessionLog.join_tail_opts() |> Keyword.put(:workspace, workspace)
      {:ok, lines, offset} = SessionLog.tail(log_agent_kind, path, log_opts)
      {:ok, _, symphony_offset} = SessionEvents.tail(workspace)

      socket =
        socket
        |> assign(:issue_identifier, issue_identifier)
        |> assign(:project_slug, project_slug)
        |> assign(:workspace, workspace)
        |> assign(:path, path)
        |> assign(:offset, offset)
        |> assign(:symphony_offset, symphony_offset)
        |> assign(:agent_kind, log_agent_kind)
        |> assign(:preferred_agent_kind, preferred_agent_kind)

      send(self(), :poll)

      {:ok,
       %{
         entries: lines,
         offset: offset,
         path: path,
         agent_kind: log_agent_kind,
         preferred_agent_kind: preferred_agent_kind,
         log_fallback: log_agent_kind != preferred_agent_kind
       }, socket}
    else
      :error -> {:error, %{reason: "session_log_unavailable"}}
      {:error, reason} -> {:error, %{reason: error_reason(reason)}}
    end
  end

  defp join_session(session_id, project_slug, socket) do
    with :ok <- authorize(socket),
         {:ok, thread} <- SymphonyElixir.Assistant.History.get_thread(session_id),
         {:ok, log_agent_kind, path} <- SessionLog.resolve_for_session(thread) do
      workspace = thread.workspace_path
      log_opts = SessionLog.join_tail_opts() |> Keyword.put(:workspace, workspace)
      {:ok, lines, offset} = SessionLog.tail(log_agent_kind, path, log_opts)
      {:ok, _, symphony_offset} = SessionEvents.tail(workspace)

      socket =
        socket
        |> assign(:session_id, session_id)
        |> assign(:issue_identifier, thread.issue_identifier)
        |> assign(:project_slug, project_slug)
        |> assign(:workspace, workspace)
        |> assign(:path, path)
        |> assign(:offset, offset)
        |> assign(:symphony_offset, symphony_offset)
        |> assign(:agent_kind, log_agent_kind)
        |> assign(:preferred_agent_kind, thread.agent_kind)

      send(self(), :poll)

      {:ok,
       %{
         entries: lines,
         offset: offset,
         path: path,
         agent_kind: log_agent_kind,
         preferred_agent_kind: thread.agent_kind,
         log_fallback: log_agent_kind != (thread.agent_kind || "codex")
       }, socket}
    else
      :error -> {:error, %{reason: "session_log_unavailable"}}
      {:error, reason} -> {:error, %{reason: error_reason(reason)}}
    end
  end

  @impl true
  def handle_in("steer_turn", payload, socket) when is_map(payload) do
    message = Map.get(payload, "message", "")
    attachments = Map.get(payload, "attachments", [])
    context_refs = Map.get(payload, "context_refs", [])
    trimmed = if is_binary(message), do: String.trim(message), else: ""

    if trimmed == "" and attachments == [] do
      {:reply, {:error, %{reason: "message is required"}}, socket}
    else
      message = inject_context_refs(socket, message, context_refs)

      case Orchestrator.steer(
             socket.assigns.issue_identifier,
             message,
             self(),
             attachments: attachments,
             project_slug: socket.assigns.project_slug
           ) do
        :ok ->
          {:reply, :ok, assign(socket, :last_steer_text, trimmed)}

        {:error, reason} ->
          push(socket, "steer_failed", %{
            reason: steer_error_reason(reason),
            message: trimmed
          })

          {:reply, {:error, %{reason: steer_error_reason(reason)}}, socket}
      end
    end
  end

  def handle_in("steer_turn", _payload, socket),
    do: {:reply, {:error, %{reason: "message is required"}}, socket}

  defp inject_context_refs(_socket, message, []), do: message

  defp inject_context_refs(socket, message, context_refs) when is_list(context_refs) do
    scope =
      SymphonyElixir.AttachedContexts.execution_scope(
        socket.assigns.project_slug,
        socket.assigns.issue_identifier
      )

    SymphonyElixir.AttachedContexts.append_to_instructions(scope, message, context_refs: context_refs)
  end

  defp inject_context_refs(_socket, message, _context_refs), do: message

  @impl true
  def handle_info({:steer_ok, _result}, socket), do: {:noreply, push(socket, "steer_ok", %{})}

  def handle_info({:steer_error, error}, socket) do
    push(socket, "steer_failed", %{
      reason: steer_error_reason(error),
      message: socket.assigns[:last_steer_text] || ""
    })

    {:noreply, socket}
  end

  @impl true
  def handle_info(:poll, %{assigns: assigns} = socket) do
    socket = poll_agent_log(socket, assigns)
    socket = poll_symphony_events(socket, assigns)

    Process.send_after(self(), :poll, @poll_ms)
    {:noreply, socket}
  end

  defp poll_agent_log(socket, %{path: path, offset: offset, agent_kind: agent_kind, workspace: workspace}) do
    log_opts = [workspace: workspace]

    case SessionLog.read_from(agent_kind, path, offset, log_opts) do
      {:ok, lines, new_offset} when lines != [] ->
        push(socket, "entries", %{entries: lines, offset: new_offset})
        assign(socket, :offset, new_offset)

      {:ok, _lines, new_offset} ->
        assign(socket, :offset, new_offset)

      {:error, _reason} ->
        socket
    end
  end

  defp poll_symphony_events(socket, %{workspace: workspace, symphony_offset: symphony_offset}) do
    case SessionEvents.read_from(workspace, symphony_offset) do
      {:ok, lines, new_offset} when lines != [] ->
        push(socket, "entries", %{entries: lines, offset: new_offset, source: "symphony"})
        assign(socket, :symphony_offset, new_offset)

      {:ok, _lines, new_offset} ->
        assign(socket, :symphony_offset, new_offset)

      {:error, _reason} ->
        socket
    end
  end

  @known_agent_kinds ["codex", "claude", "cursor", "opencode"]

  # The client tells us which agent the operator is actually viewing (the
  # selected/running agent in the UI). Honor it so the session log shows that
  # agent's live transcript instead of a stale log from a previously-used agent.
  # Fall back to the issue's persisted agent kind when the client omits it.
  defp preferred_agent_kind(%{"agent_kind" => kind}, _project_slug, _issue_identifier)
       when kind in @known_agent_kinds,
       do: kind

  defp preferred_agent_kind(_params, project_slug, issue_identifier),
    do: resolve_agent_kind(project_slug, issue_identifier)

  defp resolve_agent_kind(project_slug, issue_identifier) do
    case Context.get_issue(project_slug, issue_identifier) do
      {:ok, record} -> record |> IssueMapper.to_issue() |> AgentRunner.issue_agent_kind()
      {:error, _} -> AgentRunner.issue_agent_kind(%{})
    end
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

  # A bundle `child_run` executes in an isolated git worktree
  # (`<repo>/.worktrees/<slug>`), where the coding agent writes its session
  # sidecar + rollout log. The standard per-issue workspace holds no log for such
  # a run, so the execution transcript would never stream. Resolve the child's
  # worktree — reusing the exact run context the orchestrator dispatches with —
  # and tail its log there; standalone runs keep the standard per-issue workspace.
  defp run_log_workspace(project_slug, issue_identifier) do
    fallback = Workspace.path_for_issue(issue_identifier)
    worktree_log_workspace(run_opts_for(project_slug, issue_identifier), fallback)
  end

  defp run_opts_for(project_slug, issue_identifier) do
    with {:ok, record} <- Context.get_issue(project_slug, issue_identifier),
         %Issue{} = issue <- IssueMapper.to_issue(record) do
      Orchestrator.bundle_run_context(issue).run_opts
    else
      _ -> []
    end
  rescue
    _ -> []
  end

  @doc false
  @spec worktree_log_workspace(keyword(), String.t()) :: String.t()
  def worktree_log_workspace(run_opts, fallback) when is_list(run_opts) and is_binary(fallback) do
    SessionLog.worktree_log_workspace(fallback, run_opts)
  end

  def worktree_log_workspace(_run_opts, fallback) when is_binary(fallback), do: fallback

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

  defp steer_error_reason(:ActiveTurnNotSteerable), do: "ActiveTurnNotSteerable"
  defp steer_error_reason(:empty_message), do: "message is required"
  defp steer_error_reason(:attachment_processing_failed), do: "attachment_processing_failed"
  defp steer_error_reason(:unavailable), do: "orchestrator_unavailable"
  defp steer_error_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp steer_error_reason(%{"message" => message}) when is_binary(message), do: message
  defp steer_error_reason(reason) when is_binary(reason), do: reason
  defp steer_error_reason(reason), do: inspect(reason)
end
