defmodule SymphonyElixir.Claude.AppServer.Server do
  @moduledoc """
  GenServer implementing the JSON-RPC 2.0 app-server protocol for the
  standalone stdio drop-in (`bin/symphony-claude`).

  Handles three JSON-RPC message classes:
  1. Requests (has "method" + "id") → dispatch and reply via sender.
  2. Notifications (has "method", no "id") → ignore (no reply).
  3. Client responses (has "id", no "method") → resolve pending tool calls.

  Component rule: NO tracker/Phoenix/Ecto imports — Jason + stdlib only.
  """

  use GenServer

  require Logger

  alias SymphonyElixir.Claude.AppServer.CliRunner
  alias SymphonyElixir.Claude.AppServer.ToolGateway
  alias SymphonyElixir.Claude.ModelCatalog

  @vsn Mix.Project.config()[:version]

  # ── Public API ───────────────────────────────────────────────────────────────

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  @spec handle_message(pid(), map()) :: :ok
  def handle_message(server, msg) when is_map(msg) do
    GenServer.cast(server, {:message, msg})
  end

  @doc false
  @spec tool_executor_for_test(pid(), String.t()) :: (String.t(), map() -> map())
  def tool_executor_for_test(server, thread_id) do
    build_tool_executor(server, thread_id)
  end

  # ── GenServer init ────────────────────────────────────────────────────────────

  @impl GenServer
  def init(opts) do
    sender = Keyword.fetch!(opts, :sender)
    command = Keyword.get(opts, :command, SymphonyElixir.Claude.Config.command())

    state = %{
      sender: sender,
      command: command,
      initialized: false,
      threads: %{},
      pending_tool_calls: %{},
      next_out_id: 1000
    }

    {:ok, state}
  end

  # ── handle_cast ──────────────────────────────────────────────────────────────

  @impl GenServer
  def handle_cast({:message, msg}, state) do
    new_state = dispatch_message(msg, state)
    {:noreply, new_state}
  end

  def handle_cast({:turn_finished, thread_id, result}, state) do
    new_state =
      state
      |> update_in([:threads, thread_id], fn thread ->
        if thread do
          if thread.runner_ref, do: Process.demonitor(thread.runner_ref, [:flush])

          cli_session_id = Map.get(result, :cli_session_id) || thread.cli_session_id

          thread
          |> Map.put(:cli_session_id, cli_session_id)
          |> Map.put(:active_turn, nil)
          |> Map.put(:runner_pid, nil)
          |> Map.put(:runner_ref, nil)
        else
          thread
        end
      end)

    {:noreply, new_state}
  end

  def handle_cast({:turn_failed, thread_id}, state) do
    new_state =
      state
      |> update_in([:threads, thread_id], fn thread ->
        if thread do
          if thread.runner_ref, do: Process.demonitor(thread.runner_ref, [:flush])

          thread
          |> Map.put(:active_turn, nil)
          |> Map.put(:runner_pid, nil)
          |> Map.put(:runner_ref, nil)
        else
          thread
        end
      end)

    {:noreply, new_state}
  end

  def handle_cast({:runner_os_pid, thread_id, os_pid}, state) do
    new_state =
      update_in(state, [:threads, thread_id], fn thread ->
        if thread, do: Map.put(thread, :runner_os_pid, os_pid), else: thread
      end)

    {:noreply, new_state}
  end

  # ── handle_info ──────────────────────────────────────────────────────────────

  @impl GenServer
  def handle_info({:DOWN, ref, :process, _pid, reason}, state) do
    # Find the thread whose runner just crashed unexpectedly.
    thread_entry =
      Enum.find(state.threads, fn {_id, t} ->
        t.runner_ref == ref
      end)

    case thread_entry do
      {thread_id, thread} when not is_nil(thread.active_turn) ->
        turn_id = thread.active_turn

        # Emit a synthetic turn/failed so the client is not left waiting.
        try do
          state.sender.(%{
            "jsonrpc" => "2.0",
            "method" => "turn/failed",
            "params" => %{
              "thread_id" => thread_id,
              "turn_id" => turn_id,
              "error" => "turn runner crashed: #{inspect(reason)}"
            }
          })
        rescue
          _ -> :ok
        end

        updated_thread =
          thread
          |> Map.put(:active_turn, nil)
          |> Map.put(:runner_pid, nil)
          |> Map.put(:runner_ref, nil)
          |> Map.put(:runner_os_pid, nil)

        {:noreply, put_in(state, [:threads, thread_id], updated_thread)}

      _ ->
        {:noreply, state}
    end
  end

  def handle_info(_msg, state), do: {:noreply, state}

  # ── handle_call ──────────────────────────────────────────────────────────────

  @impl GenServer
  def handle_call({:tool_call, thread_id, name, arguments}, from, state) do
    out_id = state.next_out_id

    state.sender.(%{
      "jsonrpc" => "2.0",
      "id" => out_id,
      "method" => "item/tool/call",
      "params" => %{
        "name" => name,
        "arguments" => arguments,
        "threadId" => thread_id
      }
    })

    new_state =
      state
      |> Map.put(:next_out_id, out_id + 1)
      |> Map.put(:pending_tool_calls, Map.put(state.pending_tool_calls, out_id, from))

    {:noreply, new_state}
  end

  # ── Message dispatch ─────────────────────────────────────────────────────────

  defp dispatch_message(msg, state) do
    method = Map.get(msg, "method")
    id = Map.get(msg, "id")

    cond do
      # Client response to an item/tool/call reverse request
      not is_nil(id) and is_nil(method) ->
        handle_client_response(id, msg, state)

      # JSON-RPC request (has both method and id)
      not is_nil(method) and not is_nil(id) ->
        handle_request(id, method, Map.get(msg, "params", %{}), state)

      # Notification (has method, no id) — ignore
      not is_nil(method) ->
        state

      true ->
        state
    end
  end

  defp handle_client_response(id, msg, state) do
    case Map.get(state.pending_tool_calls, id) do
      nil ->
        state

      from ->
        result = Map.get(msg, "result") || Map.get(msg, "error")
        GenServer.reply(from, result)

        Map.put(state, :pending_tool_calls, Map.delete(state.pending_tool_calls, id))
    end
  end

  defp handle_request(id, method, params, state) do
    if not state.initialized and method != "initialize" do
      send_error(state, id, -32_002, "Not initialized. Send initialize first.")
      state
    else
      dispatch_method(id, method, params, state)
    end
  end

  # ── Method handlers ──────────────────────────────────────────────────────────

  defp dispatch_method(id, "initialize", _params, state) do
    {:ok, catalog} = ModelCatalog.list_models()
    model_ids = Enum.map(catalog.models, & &1.id)

    send_result(state, id, %{
      "server" => %{"name" => "symphony-claude", "version" => @vsn},
      "capabilities" => %{
        "threads" => ["start", "resume"],
        "turns" => ["start", "steer", "interrupt"],
        "models" => model_ids
      }
    })

    state.sender.(%{
      "jsonrpc" => "2.0",
      "method" => "initialized",
      "params" => %{"server" => "symphony-claude"}
    })

    %{state | initialized: true}
  end

  defp dispatch_method(id, "thread/start", params, state) do
    thread_id = uuid()
    cwd = params |> Map.get("cwd", File.cwd!()) |> Path.expand()

    permission_mode =
      Map.get(params, "permissionMode") ||
        Map.get(params, "permission_mode") ||
        "bypassPermissions"

    dynamic_tools = Map.get(params, "dynamicTools", [])

    {gateway_token, mcp_config_path} =
      if dynamic_tools != [] do
        executor = build_tool_executor(self(), thread_id)
        {:ok, token, url} = ToolGateway.register_session(dynamic_tools, executor)
        config_path = ToolGateway.write_mcp_config!(cwd, url)
        {token, config_path}
      else
        {nil, nil}
      end

    thread = %{
      id: thread_id,
      cwd: cwd,
      permission_mode: permission_mode,
      cli_session_id: nil,
      dynamic_tools: dynamic_tools,
      gateway_token: gateway_token,
      mcp_config_path: mcp_config_path,
      steer_queue: [],
      active_turn: nil,
      runner_pid: nil,
      runner_ref: nil,
      runner_os_pid: nil
    }

    new_state = put_in(state, [:threads, thread_id], thread)
    send_result(new_state, id, %{"thread" => %{"id" => thread_id}})
    new_state
  end

  defp dispatch_method(id, "thread/resume", params, state) do
    thread_id = Map.get(params, "threadId") || Map.get(params, "id", "")

    case Map.get(state.threads, thread_id) do
      nil ->
        send_error(state, id, -32_004, "Thread not found: #{thread_id}")
        state

      thread ->
        send_result(state, id, %{
          "thread" => %{
            "id" => thread.id,
            "cwd" => thread.cwd,
            "cli_session_id" => thread.cli_session_id
          }
        })

        state
    end
  end

  defp dispatch_method(id, "turn/start", params, state) do
    thread_id = Map.get(params, "threadId", "")

    case Map.get(state.threads, thread_id) do
      nil ->
        send_error(state, id, -32_004, "Thread not found: #{thread_id}")
        state

      %{active_turn: active} when not is_nil(active) ->
        send_error(state, id, -32_005, "Thread already has an active turn. Interrupt it first.")
        state

      thread ->
        turn_id = uuid()

        prompt = build_prompt(params, thread)

        send_result(state, id, %{"turn" => %{"id" => turn_id}})

        server = self()

        on_event = fn notification ->
          augmented = augment_notification(notification, turn_id, thread_id)
          state.sender.(Map.put_new(augmented, "jsonrpc", "2.0"))
        end

        turn_args = %{
          command: state.command,
          workspace: thread.cwd,
          prompt: prompt,
          session_uuid: thread.id,
          cli_session_id: thread.cli_session_id,
          model: Map.get(params, "model"),
          mcp_config_path: thread.mcp_config_path,
          permission_mode: thread.permission_mode,
          timeout_ms: SymphonyElixir.Config.agent_turn_timeout_ms(),
          on_spawn: fn os_pid -> GenServer.cast(server, {:runner_os_pid, thread_id, os_pid}) end
        }

        pid = spawn(fn -> run_turn_task(server, thread_id, turn_args, on_event) end)
        ref = Process.monitor(pid)

        updated_thread =
          thread
          |> Map.put(:active_turn, turn_id)
          |> Map.put(:steer_queue, [])
          |> Map.put(:runner_pid, pid)
          |> Map.put(:runner_ref, ref)
          |> Map.put(:runner_os_pid, nil)

        put_in(state, [:threads, thread_id], updated_thread)
    end
  end

  defp dispatch_method(id, "turn/steer", params, state) do
    thread_id = Map.get(params, "threadId", "")
    content = Map.get(params, "content", "")

    case Map.get(state.threads, thread_id) do
      %{active_turn: active} = thread when not is_nil(active) ->
        updated_thread = Map.update!(thread, :steer_queue, &(&1 ++ [content]))
        new_state = put_in(state, [:threads, thread_id], updated_thread)

        send_result(new_state, id, %{
          "turn_id" => active,
          "note" => "queued: will be prepended to the next user message"
        })

        new_state

      _ ->
        send_error(state, id, -32_006, "No active turn to steer.")
        state
    end
  end

  defp dispatch_method(id, "turn/interrupt", params, state) do
    thread_id = Map.get(params, "threadId", "")

    case Map.get(state.threads, thread_id) do
      %{active_turn: active, runner_pid: runner_pid, runner_ref: runner_ref, runner_os_pid: runner_os_pid} =
          thread
      when not is_nil(active) ->
        # Best-effort group kill first (tears down grandchildren via setsid group).
        if runner_os_pid do
          try do
            System.cmd("kill", ["-9", "-#{runner_os_pid}"], stderr_to_stdout: true)
          rescue
            _ -> :ok
          end
        end

        if runner_pid && Process.alive?(runner_pid) do
          Process.exit(runner_pid, :kill)
        end

        if runner_ref, do: Process.demonitor(runner_ref, [:flush])

        updated_thread =
          thread
          |> Map.put(:active_turn, nil)
          |> Map.put(:runner_pid, nil)
          |> Map.put(:runner_ref, nil)
          |> Map.put(:runner_os_pid, nil)
          # Interrupt abandons queued steers — they belonged to the abandoned direction.
          |> Map.put(:steer_queue, [])

        new_state = put_in(state, [:threads, thread_id], updated_thread)

        send_result(new_state, id, %{"turn_id" => active, "status" => "interrupted"})
        new_state

      _ ->
        send_error(state, id, -32_006, "No active turn to interrupt.")
        state
    end
  end

  defp dispatch_method(id, "model/list", _params, state) do
    {:ok, catalog} = ModelCatalog.list_models()

    models =
      Enum.map(catalog.models, fn m ->
        %{"id" => m.id, "name" => m.label}
      end)

    send_result(state, id, %{"models" => models})
    state
  end

  defp dispatch_method(id, method, _params, state) do
    send_error(state, id, -32_601, "Method not found: #{method}")
    state
  end

  # ── Helpers ──────────────────────────────────────────────────────────────────

  defp send_result(state, id, result) do
    state.sender.(%{
      "jsonrpc" => "2.0",
      "id" => id,
      "result" => result
    })
  end

  defp send_error(state, id, code, message) do
    state.sender.(%{
      "jsonrpc" => "2.0",
      "id" => id,
      "error" => %{"code" => code, "message" => message}
    })
  end

  defp build_prompt(params, thread) do
    base =
      case Map.get(params, "input") do
        items when is_list(items) ->
          items
          |> Enum.flat_map(fn
            %{"type" => "text", "text" => t} -> [t]
            _ -> []
          end)
          |> Enum.join("\n")

        _ ->
          Map.get(params, "content", "")
      end

    steer_prefix =
      case thread.steer_queue do
        [] -> ""
        queue -> Enum.join(queue, "\n") <> "\n"
      end

    steer_prefix <> base
  end

  defp augment_notification(notification, turn_id, thread_id) do
    Map.update(notification, "params", %{}, fn p ->
      p |> Map.put("turn_id", turn_id) |> Map.put("thread_id", thread_id)
    end)
  end

  defp run_turn_task(server, thread_id, turn_args, on_event) do
    case CliRunner.run_turn(turn_args, on_event) do
      {:ok, result} -> GenServer.cast(server, {:turn_finished, thread_id, result})
      {:error, _reason} -> GenServer.cast(server, {:turn_failed, thread_id})
    end
  end

  defp build_tool_executor(server, thread_id) do
    fn name, arguments ->
      try do
        GenServer.call(server, {:tool_call, thread_id, name, arguments}, 65_000)
      catch
        :exit, _ ->
          %{
            "success" => false,
            "contentItems" => [%{"type" => "inputText", "text" => "tool call timed out"}]
          }
      end
    end
  end

  defp uuid do
    :crypto.strong_rand_bytes(16)
    |> Base.encode16(case: :lower)
    |> then(fn hex ->
      <<a::binary-size(8), b::binary-size(4), c::binary-size(4), d::binary-size(4), e::binary-size(12)>> = hex

      "#{a}-#{b}-#{c}-#{d}-#{e}"
    end)
  end
end
