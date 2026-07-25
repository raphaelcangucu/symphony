defmodule SymphonyElixir.MobileRpc.OrcaSessionService do
  @moduledoc """
  Presents Symphony sessions and terminals through Orca's production RPC shapes.

  Domain state remains owned by `Assistant.History`, `Terminal.Registry` and
  `ThreadDocuments`. This module resolves selectors and translates DTOs only.
  """

  alias SymphonyElixir.Assistant.{History, ThreadDocuments}
  alias SymphonyElixir.MobileRpc.{OrcaSubscription, TerminalBridge}
  alias SymphonyElixir.Terminal.Registry

  @state_table :symphony_mobile_rpc_orca_session_preferences
  @max_terminal_input_bytes 256 * 1024

  @spec call(String.t(), map(), map()) :: {:ok, term()} | {:error, term()}
  def call("session.tabs.list", %{"worktree" => selector}, context) do
    with {:ok, thread} <- resolve_worktree(selector, context) do
      session_snapshot(thread, context)
    end
  end

  def call(
        "session.tabs.activate",
        %{"worktree" => selector, "tabId" => tab_id},
        context
      ) do
    with {:ok, thread} <- resolve_worktree(selector, context),
         {:ok, snapshot} <- session_snapshot(thread, context),
         true <- Enum.any?(snapshot["tabs"], &(&1["id"] == tab_id)),
         {:ok, updated} <- persist_tab_state(thread, tab_id, context) do
      session_snapshot(updated, context)
    else
      false -> rpc_error("not_found", "Session tab was not found")
      error -> error
    end
  end

  def call("session.tabs.createTerminal", %{"worktree" => selector} = params, context) do
    with {:ok, thread} <- resolve_worktree(selector, context),
         {:ok, tab} <-
           terminal_registry(context).create_tab(
             thread.project_slug,
             to_string(thread.id),
             create_terminal_attrs(thread, params)
           ),
         tab_id = dynamic_handle(thread, tab),
         {:ok, updated} <-
           persist_tab_state(
             thread,
             if(Map.get(params, "activate", true), do: tab_id, else: active_tab_id(thread)),
             context
           ),
         {:ok, snapshot} <- session_snapshot(updated, context),
         created when is_map(created) <- Enum.find(snapshot["tabs"], &(&1["id"] == tab_id)) do
      {:ok, %{"tab" => created}}
    else
      nil -> {:error, :terminal_create_failed}
      error -> error
    end
  end

  def call(
        "session.tabs.close",
        %{"worktree" => selector, "tabId" => tab_id},
        context
      ) do
    with {:ok, thread} <- resolve_worktree(selector, context),
         {:ok, target} <- resolve_handle(tab_id, context),
         :ok <- ensure_same_thread(thread, target.thread),
         :ok <- close_target(target, context),
         {:ok, updated} <- persist_tab_state(thread, primary_handle(thread), context) do
      {:ok,
       %{
         "closed" => true,
         "tabId" => tab_id,
         "snapshot" => elem(session_snapshot(updated, context), 1)
       }}
    end
  end

  def call("terminal.list", %{"worktree" => selector} = params, context) do
    with {:ok, thread} <- resolve_worktree(selector, context),
         {:ok, snapshot} <- session_snapshot(thread, context) do
      limit = bounded_limit(Map.get(params, "limit", 200))

      terminals =
        snapshot["tabs"]
        |> Enum.filter(&(&1["type"] == "terminal" and is_binary(&1["terminal"])))
        |> Enum.map(fn tab ->
          %{
            "handle" => tab["terminal"],
            "title" => tab["title"],
            "isActive" => tab["isActive"],
            "worktreeId" => to_string(thread.id),
            "hasRunningProcess" => tab["status"] == "ready"
          }
        end)

      visible = Enum.take(terminals, limit)

      {:ok,
       %{
         "terminals" => visible,
         "totalCount" => length(terminals),
         "truncated" => length(visible) < length(terminals)
       }}
    end
  end

  def call("terminal.send", %{"terminal" => handle} = params, context) do
    text = Map.get(params, "text", "")
    suffix = terminal_suffix(params)
    input = text <> suffix

    cond do
      not is_binary(text) ->
        {:error, :invalid_params}

      byte_size(input) > @max_terminal_input_bytes ->
        rpc_error("invalid_params", "Terminal input is too large")

      true ->
        with {:ok, target} <- resolve_handle(handle, context),
             :ok <- send_terminal_input(target, input, context) do
          {:ok,
           %{
             "send" => %{
               "handle" => handle,
               "accepted" => true,
               "bytesWritten" => byte_size(input)
             }
           }}
        end
    end
  end

  def call(
        "terminal.updateViewport",
        %{"terminal" => handle, "viewport" => %{"cols" => cols, "rows" => rows}},
        context
      )
      when is_integer(cols) and cols >= 20 and cols <= 240 and is_integer(rows) and
             rows >= 8 and rows <= 120 do
    with {:ok, target} <- resolve_handle(handle, context),
         :ok <- resize_terminal(target, cols, rows, context) do
      {:ok,
       %{
         "terminal" => handle,
         "cols" => cols,
         "rows" => rows,
         "displayMode" => display_mode(context, handle)
       }}
    end
  end

  def call("terminal.updateViewport", _params, _context), do: {:error, :invalid_params}

  def call("terminal.focus", %{"terminal" => handle}, context) do
    with {:ok, target} <- resolve_handle(handle, context),
         {:ok, _thread} <- persist_tab_state(target.thread, handle, context) do
      {:ok, %{"focus" => %{"handle" => handle, "focused" => true}}}
    end
  end

  def call("terminal.rename", %{"terminal" => handle} = params, context) do
    title = params |> Map.get("title", "") |> to_string() |> String.trim()

    with {:ok, target} <- resolve_handle(handle, context),
         {:ok, renamed} <- rename_target(target, title, context),
         {:ok, _updated} <-
           persist_tab_state(target.thread, active_tab_id(target.thread), context) do
      {:ok,
       %{
         "rename" => %{
           "handle" => handle,
           "title" => tab_value(renamed, :title, title)
         }
       }}
    end
  end

  def call("terminal.close", %{"terminal" => handle}, context) do
    with {:ok, target} <- resolve_handle(handle, context),
         :ok <- close_target(target, context),
         {:ok, _thread} <-
           persist_tab_state(target.thread, primary_handle(target.thread), context) do
      {:ok, %{"close" => %{"handle" => handle, "closed" => true}}}
    end
  end

  def call("terminal.clearBuffer", %{"terminal" => handle}, context) do
    with {:ok, _target} <- resolve_handle(handle, context) do
      {:ok, %{"clear" => %{"handle" => handle, "cleared" => true}}}
    end
  end

  def call(
        "terminal.setDisplayMode",
        %{"terminal" => handle, "mode" => mode} = params,
        context
      )
      when mode in ["auto", "desktop"] do
    with {:ok, target} <- resolve_handle(handle, context),
         :ok <- maybe_resize_for_auto(target, mode, Map.get(params, "viewport"), context) do
      put_preference(context, {:display_mode, handle}, mode)
      {:ok, %{"mode" => mode}}
    end
  end

  def call("terminal.getAutoRestoreFit", _params, context) do
    {:ok, %{"ms" => preference(context, :auto_restore_fit_ms, nil)}}
  end

  def call("terminal.setAutoRestoreFit", %{"ms" => value}, context)
      when is_nil(value) or is_number(value) do
    normalized =
      if is_nil(value),
        do: nil,
        else: value |> round() |> max(5_000) |> min(3_600_000)

    put_preference(context, :auto_restore_fit_ms, normalized)
    {:ok, %{"ms" => normalized}}
  end

  def call(
        "markdown.readTab",
        %{"worktree" => selector, "tabId" => tab_id},
        context
      ) do
    with {:ok, thread} <- resolve_worktree(selector, context),
         {:ok, content} <- thread_documents(context).read(thread.id, tab_id) do
      {:ok,
       %{
         "tabId" => tab_id,
         "content" => content,
         "baseVersion" => content_version(content),
         "editable" => false,
         "readOnlyReason" => "Symphony markdown tabs are read-only on mobile"
       }}
    end
  end

  def call("markdown.saveTab", _params, _context) do
    rpc_error("read_only", "Symphony markdown tabs are read-only on mobile")
  end

  def call(_method, _params, _context), do: {:error, :unsupported_orca_session_method}

  @spec subscribe(String.t(), map(), map()) :: {:ok, term()} | {:error, term()}
  def subscribe("session.tabs.subscribe", %{"worktree" => selector}, context) do
    with {:ok, thread} <- resolve_worktree(selector, context),
         connection_pid when is_pid(connection_pid) <- Map.get(context, :connection_pid) do
      subscription_id = unique_subscription_id("tabs", thread.id)

      OrcaSubscription.subscribe(
        connection_pid: connection_pid,
        subscription_id: subscription_id,
        event_prefix: "session.tabs",
        load: fn -> session_snapshot_by_id(thread.id, context) end
      )
    else
      _reason -> {:error, :session_tabs_subscription_failed}
    end
  end

  def subscribe("terminal.subscribe", %{"terminal" => handle}, context) do
    with connection_pid when is_pid(connection_pid) <- Map.get(context, :connection_pid),
         {:ok, target} <- resolve_handle(handle, context),
         subscription_id = unique_subscription_id("terminal", target.thread.id),
         {:ok, bridge} <-
           terminal_bridge(context).subscribe_handle(
             connection_pid,
             Map.put(target, :handle, handle),
             subscription_id
           ) do
      cleanup = fn ->
        if Process.alive?(bridge), do: GenServer.stop(bridge, :normal)
      end

      {:ok, {:subscription, subscription_id, %{"subscription_id" => subscription_id}, cleanup, fn -> SymphonyElixir.MobileRpc.SessionBridge.activate(bridge) end}}
    else
      _reason -> {:error, :terminal_subscription_failed}
    end
  end

  def subscribe(_method, _params, _context), do: {:error, :unsupported_subscription}

  defp session_snapshot_by_id(id, context) do
    with {:ok, thread} <- history(context).get_thread(id) do
      session_snapshot(thread, context)
    end
  end

  defp session_snapshot(thread, context) do
    with {:ok, dynamic_tabs} <-
           terminal_registry(context).list_tabs(thread.project_slug, to_string(thread.id)) do
      active_id = active_tab_id(thread)
      primary = present_primary_tab(thread, active_id)
      rest = Enum.map(dynamic_tabs, &present_dynamic_tab(thread, &1, active_id))
      tabs = [primary | rest]
      effective_active = if Enum.any?(tabs, &(&1["id"] == active_id)), do: active_id, else: primary["id"]

      {:ok,
       %{
         "worktree" => to_string(thread.id),
         "publicationEpoch" => "#{Map.get(context, :host_id, "host")}:#{thread.id}",
         "snapshotVersion" => snapshot_version(thread),
         "tabs" => mark_active(tabs, effective_active),
         "activeTabId" => effective_active,
         "activeTabType" => "terminal"
       }}
    end
  end

  defp present_primary_tab(thread, active_id) do
    handle = primary_handle(thread)

    %{
      "type" => "terminal",
      "id" => handle,
      "title" => thread.title || agent_title(thread.agent_kind),
      "terminal" => handle,
      "launchAgent" => thread.agent_kind,
      "status" => "ready",
      "isActive" => active_id == handle
    }
    |> drop_nil_values()
  end

  defp present_dynamic_tab(thread, tab, active_id) do
    handle = dynamic_handle(thread, tab)

    %{
      "type" => "terminal",
      "id" => handle,
      "title" => tab_value(tab, :title, "Terminal"),
      "terminal" => handle,
      "status" => "ready",
      "isActive" => active_id == handle
    }
  end

  defp mark_active(tabs, active_id) do
    Enum.map(tabs, &Map.put(&1, "isActive", &1["id"] == active_id))
  end

  defp resolve_worktree(selector, context) do
    with {:ok, id} <- parse_worktree_id(selector),
         {:ok, thread} <- history(context).get_thread(id) do
      {:ok, thread}
    else
      _error -> rpc_error("not_found", "Symphony session was not found")
    end
  end

  defp resolve_handle("thread:" <> raw_id, context) do
    with {id, ""} when id > 0 <- Integer.parse(raw_id),
         {:ok, thread} <- history(context).get_thread(id) do
      {:ok, %{kind: :thread, thread: thread}}
    else
      _error -> rpc_error("not_found", "Terminal was not found")
    end
  end

  defp resolve_handle("tab:" <> rest, context) do
    with [raw_thread_id, encoded_project, tab_id] <-
           String.split(rest, ":", parts: 3),
         {thread_id, ""} when thread_id > 0 <- Integer.parse(raw_thread_id),
         {:ok, project_slug} <- Base.url_decode64(encoded_project, padding: false),
         {:ok, thread} <- history(context).get_thread(thread_id),
         true <- thread.project_slug == project_slug,
         true <- tab_id != "" do
      {:ok, %{kind: :tab, thread: thread, tab_id: tab_id}}
    else
      _error -> rpc_error("not_found", "Terminal was not found")
    end
  end

  defp resolve_handle(_handle, _context), do: rpc_error("not_found", "Terminal was not found")

  defp persist_tab_state(thread, active_id, context) do
    metadata =
      (thread.metadata || %{})
      |> Map.put("mobileActiveTabId", active_id)
      |> Map.put("mobileSessionSnapshotVersion", snapshot_version(thread) + 1)

    history(context).update_thread(thread, %{metadata: metadata})
  end

  defp close_target(%{kind: :thread}, _context) do
    rpc_error("protected_terminal", "The primary Symphony terminal cannot be closed")
  end

  defp close_target(%{kind: :tab, thread: thread, tab_id: tab_id}, context) do
    terminal_registry(context).close_tab(thread.project_slug, to_string(thread.id), tab_id)
  end

  defp rename_target(%{kind: :thread, thread: thread}, title, context) do
    next_title = if title == "", do: "Terminal", else: title
    history(context).update_thread(thread, %{title: next_title})
  end

  defp rename_target(%{kind: :tab, thread: thread, tab_id: tab_id}, title, context) do
    terminal_registry(context).rename_tab(
      thread.project_slug,
      to_string(thread.id),
      tab_id,
      if(title == "", do: "Terminal", else: title)
    )
  end

  defp send_terminal_input(%{kind: :thread, thread: thread}, input, context) do
    terminal_registry(context).send_input_workspace(
      thread.project_slug,
      thread.workspace_path,
      input
    )
  end

  defp send_terminal_input(%{kind: :tab, thread: thread, tab_id: tab_id}, input, context) do
    terminal_registry(context).send_input_tab(thread.project_slug, tab_id, input)
  end

  defp resize_terminal(%{kind: :thread, thread: thread}, cols, rows, context) do
    terminal_registry(context).resize_workspace(
      thread.project_slug,
      thread.workspace_path,
      cols,
      rows
    )
  end

  defp resize_terminal(%{kind: :tab, thread: thread, tab_id: tab_id}, cols, rows, context) do
    terminal_registry(context).resize_tab(thread.project_slug, tab_id, cols, rows)
  end

  defp maybe_resize_for_auto(_target, "desktop", _viewport, _context), do: :ok

  defp maybe_resize_for_auto(
         target,
         "auto",
         %{"cols" => cols, "rows" => rows},
         context
       )
       when is_integer(cols) and is_integer(rows) do
    resize_terminal(target, cols, rows, context)
  end

  defp maybe_resize_for_auto(_target, "auto", _viewport, _context), do: :ok

  defp ensure_same_thread(%{id: id}, %{id: id}), do: :ok
  defp ensure_same_thread(_expected, _actual), do: {:error, :terminal_scope_mismatch}

  defp create_terminal_attrs(thread, params) do
    agent = Map.get(params, "launchAgent") || Map.get(params, "agent")
    command = Map.get(params, "command") || agent

    %{
      "title" => if(is_binary(agent), do: agent_title(agent), else: "Terminal"),
      "cwd" => Map.get(params, "cwd") || thread.workspace_path,
      "command" => command
    }
  end

  defp terminal_suffix(%{"interrupt" => true}), do: <<3>>
  defp terminal_suffix(%{"enter" => true}), do: "\r"
  defp terminal_suffix(_params), do: ""

  defp active_tab_id(thread) do
    Map.get(thread.metadata || %{}, "mobileActiveTabId") || primary_handle(thread)
  end

  defp snapshot_version(thread) do
    case Map.get(thread.metadata || %{}, "mobileSessionSnapshotVersion", 0) do
      version when is_integer(version) and version >= 0 -> version
      _invalid -> 0
    end
  end

  defp primary_handle(thread), do: "thread:#{thread.id}"

  defp dynamic_handle(thread, tab) do
    project = Base.url_encode64(thread.project_slug, padding: false)
    "tab:#{thread.id}:#{project}:#{tab_value(tab, :id, "")}"
  end

  defp display_mode(context, handle),
    do: preference(context, {:display_mode, handle}, "auto")

  defp preference(context, key, default) do
    ensure_state_table()
    :ets.lookup_element(@state_table, {Map.get(context, :host_id, "host"), key}, 2, default)
  end

  defp put_preference(context, key, value) do
    ensure_state_table()
    :ets.insert(@state_table, {{Map.get(context, :host_id, "host"), key}, value})
    value
  end

  defp ensure_state_table do
    case :ets.whereis(@state_table) do
      :undefined ->
        try do
          :ets.new(@state_table, [:named_table, :public, :set, read_concurrency: true])
        rescue
          ArgumentError -> @state_table
        end

      table ->
        table
    end
  end

  defp parse_worktree_id(selector) do
    raw = selector |> to_string() |> String.replace_prefix("id:", "")

    case Integer.parse(raw) do
      {id, ""} when id > 0 -> {:ok, id}
      _invalid -> {:error, :invalid_worktree}
    end
  end

  defp bounded_limit(value) when is_integer(value), do: value |> max(1) |> min(500)
  defp bounded_limit(_value), do: 200

  defp content_version(content) do
    :crypto.hash(:sha256, content)
    |> Base.url_encode64(padding: false)
  end

  defp unique_subscription_id(prefix, thread_id) do
    "#{prefix}:#{thread_id}:#{System.unique_integer([:positive, :monotonic])}"
  end

  defp tab_value(tab, key, default) do
    Map.get(tab, key, Map.get(tab, Atom.to_string(key), default))
  end

  defp drop_nil_values(map) do
    map
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp agent_title(nil), do: "Terminal"

  defp agent_title(agent) do
    agent
    |> to_string()
    |> String.replace(["-", "_"], " ")
    |> String.capitalize()
  end

  defp history(context), do: Map.get(context, :orca_history, History)
  defp terminal_registry(context), do: Map.get(context, :orca_terminal_registry, Registry)
  defp thread_documents(context), do: Map.get(context, :orca_thread_documents, ThreadDocuments)
  defp terminal_bridge(context), do: Map.get(context, :orca_terminal_bridge, TerminalBridge)

  defp rpc_error(code, message),
    do: {:error, {:rpc_error, code, message, false, nil}}
end
