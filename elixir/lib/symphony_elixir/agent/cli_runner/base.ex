defmodule SymphonyElixir.Agent.CliRunner.Base do
  @moduledoc """
  Shared port/process plumbing for the agent CLI runners (Cursor, Claude,
  OpenCode). Owns only the transport concerns each runner used to duplicate:

  - prompt temp file + stdin redirect (Erlang ports cannot half-close stdin)
  - `setsid bash -lc ...` spawn so the whole process group can be killed
  - NDJSON line-buffered receive loop with turn timeout
  - process-group kill on timeout (`kill -9 -<pgid>`; legacy `pkill -P` +
    `kill -9` fallback on systems without setsid)
  - exit finalization (`turn/completed` / `turn/failed` / invalid-resume)
  - truncated logging of non-JSON stream lines

  Event parsing stays in each runner: the loop hands decoded payloads and raw
  non-JSON lines back through the `t:handlers/0` callbacks.

  Component rule (same as every CLI runner): NO tracker/Phoenix/Ecto imports —
  Jason + stdlib only.

  ### Timeout / process-kill strategy

  On Linux (setsid available) we spawn via `setsid bash -lc ...` so bash
  becomes a new process-group leader (pgid == bash's pid). On timeout we send
  `kill -9 -<pgid>` which kills the entire group — bash, its direct children,
  and any grandchildren the CLI spawns.

  On macOS / systems without setsid we fall back to the legacy two-step:
  1. `pkill -9 -P <pid>` — kill direct children of bash.
  2. `kill -9 <pid>`     — kill bash itself.
  This legacy path does NOT kill grandchildren spawned with a new process
  group, but it is the best we can do without setsid.
  """

  require Logger

  @port_line_bytes 1_048_576
  @max_stream_log_bytes 1_000

  # Exit statuses treated as a clean turn end (130 = SIGINT-style interrupt).
  @clean_exit_statuses [0, 130]

  @typedoc """
  Callbacks the receive loop dispatches to:

  - `:on_json` — decoded NDJSON payload; returns the updated runner state.
  - `:on_stray_line` — raw non-JSON line (CLI noise / plain-text errors);
    returns the updated runner state.
  - `:on_exit` — CLI exit status; returns the loop's final result.
  """
  @type handlers :: [
          on_json: (map(), map() -> map()),
          on_stray_line: (String.t(), map() -> map()),
          on_exit: (integer(), map() -> term())
        ]

  @doc """
  Writes the prompt to `<workspace>/.symphony/<prefix>-prompt-<session_uuid>.md`
  and returns its path. Callers must delete it when the turn ends.
  """
  @spec write_prompt_file(Path.t(), String.t(), String.t(), String.t()) :: Path.t()
  def write_prompt_file(workspace, prefix, session_uuid, prompt) do
    symphony_dir = Path.join(workspace, ".symphony")
    File.mkdir_p!(symphony_dir)
    prompt_path = Path.join(symphony_dir, "#{prefix}-prompt-#{session_uuid}.md")
    File.write!(prompt_path, prompt)
    prompt_path
  end

  @doc """
  Spawns `command <cli_args> < <prompt_path>` in `workspace` and returns the
  port. Uses `setsid --wait bash -lc ...` when setsid is available so bash
  becomes a process-group leader `kill_port/1` can kill as a group; plain
  `bash -lc ...` otherwise.
  """
  @spec open_cli_port(String.t(), String.t(), Path.t(), Path.t(), map()) :: port()
  def open_cli_port(command, cli_args, prompt_path, workspace, environment \\ %{}) do
    shell_line = "#{command} #{cli_args} < #{shell_escape(prompt_path)}"

    {executable, port_args} =
      case System.find_executable("setsid") do
        nil ->
          {System.find_executable("bash"), [~c"-lc", String.to_charlist(shell_line)]}

        setsid_path ->
          {setsid_path, [~c"--wait", ~c"bash", ~c"-lc", String.to_charlist(shell_line)]}
      end

    Port.open(
      {:spawn_executable, executable},
      [
        :binary,
        :exit_status,
        :stderr_to_stdout,
        args: port_args,
        cd: String.to_charlist(workspace),
        env: port_environment(environment),
        line: @port_line_bytes
      ]
    )
  end

  defp port_environment(environment) when is_map(environment) do
    Enum.map(environment, fn {name, value} ->
      {String.to_charlist(to_string(name)), String.to_charlist(to_string(value))}
    end)
  end

  @doc """
  Notifies the caller of the spawned OS pid (when `on_spawn` is given) so it
  can perform group kills on interrupt.
  """
  @spec notify_spawn(port(), (non_neg_integer() -> any()) | nil) :: :ok
  def notify_spawn(_port, nil), do: :ok

  def notify_spawn(port, on_spawn) when is_function(on_spawn, 1) do
    case :erlang.port_info(port, :os_pid) do
      {:os_pid, os_pid} -> on_spawn.(os_pid)
      _ -> :ok
    end

    :ok
  end

  @doc """
  Line-buffered NDJSON receive loop over `port`. Complete lines are decoded
  and dispatched to `:on_json` (valid JSON) or `:on_stray_line` (anything
  else); the CLI exit status goes to `:on_exit`, whose return value is the
  loop's result. When no port message arrives within `timeout_ms` the process
  tree is killed and `{:error, :turn_timeout}` is returned.
  """
  @spec receive_loop(port(), pos_integer(), String.t(), map(), handlers()) :: term()
  def receive_loop(port, timeout_ms, pending_line, state, handlers) do
    receive do
      {^port, {:data, {:eol, chunk}}} ->
        line = pending_line <> to_string(chunk)
        new_state = dispatch_line(line, state, handlers)
        receive_loop(port, timeout_ms, "", new_state, handlers)

      {^port, {:data, {:noeol, chunk}}} ->
        receive_loop(port, timeout_ms, pending_line <> to_string(chunk), state, handlers)

      {^port, {:exit_status, status}} ->
        Keyword.fetch!(handlers, :on_exit).(status, state)

      {:agent_interrupt} ->
        kill_port(port)
        {:error, :interrupted}

      {:kill_tool, _tool_call_id} ->
        kill_port_children(port)
        receive_loop(port, timeout_ms, pending_line, state, handlers)
    after
      timeout_ms ->
        kill_port(port)
        {:error, :turn_timeout}
    end
  end

  defp dispatch_line(line, state, handlers) do
    case Jason.decode(line) do
      {:ok, payload} -> Keyword.fetch!(handlers, :on_json).(payload, state)
      {:error, _reason} -> Keyword.fetch!(handlers, :on_stray_line).(line, state)
    end
  end

  @doc """
  Standard exit finalization shared by the runners. Expects the runner state
  to carry `:cli_session_id`, `:usage`, `:cost_usd`, `:error` and
  `:resume_invalid`.

  - Invalid resume + failure → `{:error, {:resume_session_not_found, id}}`
    with no `turn/failed` event, so the adapter can transparently retry the
    turn as a fresh session.
  - Captured error or unclean exit → emits `turn/failed`, returns
    `{:error, {:turn_failed, message}}`.
  - Clean exit → emits `turn/completed`, returns the turn result.

  Options:

  - `:exit_label` (required) — CLI name used in the default failure message,
    e.g. `"claude exited with code 1"`.
  - `:transform_usage` — optional fun applied to the accumulated usage before
    completing (Claude normalizes it via `usage_with_total/1`).
  """
  @spec finalize_exit((map() -> any()), integer(), map(), keyword()) ::
          {:ok, map()} | {:error, term()}
  def finalize_exit(on_event, status, state, opts) do
    exit_label = Keyword.fetch!(opts, :exit_label)
    transform_usage = Keyword.get(opts, :transform_usage, &Function.identity/1)

    has_error = not is_nil(state.error)
    clean_exit = status in @clean_exit_statuses

    cond do
      state.resume_invalid and (has_error or not clean_exit) ->
        {:error, {:resume_session_not_found, state.cli_session_id}}

      has_error or not clean_exit ->
        message = state.error || "#{exit_label} exited with code #{status}"

        on_event.(%{
          "method" => "turn/failed",
          "params" => %{"error" => message}
        })

        {:error, {:turn_failed, message}}

      true ->
        usage = transform_usage.(state.usage)

        on_event.(%{
          "method" => "turn/completed",
          "params" => %{
            "usage" => usage,
            "cost_usd" => state.cost_usd
          }
        })

        result =
          %{
            cli_session_id: state.cli_session_id,
            status: :completed,
            usage: usage,
            cost_usd: state.cost_usd
          }
          |> put_state_value(state, :resolved_model)
          |> put_state_value(state, :resolved_effort)
          |> put_state_value(state, :provider_model)

        {:ok, result}
    end
  end

  defp put_state_value(result, state, key) do
    case Map.get(state, key) do
      value when is_binary(value) and value != "" -> Map.put(result, key, value)
      _value -> result
    end
  end

  @doc """
  Kills the process tree spawned by the port (whole group when setsid was
  used at spawn time; legacy `pkill -P` + `kill -9` otherwise), then closes
  the port. Used on timeout.
  """
  @spec kill_port(port()) :: :ok
  def kill_port(port) when is_port(port) do
    case :erlang.port_info(port, :os_pid) do
      {:os_pid, os_pid} ->
        pid_str = to_string(os_pid)
        descendants = descendant_pids(os_pid)

        if System.find_executable("setsid") do
          # setsid was used at spawn time → pgid == os_pid → kill whole group
          System.cmd("kill", ["-9", "--", "-#{pid_str}"], stderr_to_stdout: true)
        end

        # `setsid --wait` may fork before exec when its own process is already a
        # group leader. Capture and kill the complete descendant tree as
        # explicit PIDs as well, so interpreter wrappers and grandchildren
        # cannot survive by moving into a child-owned process group.
        pids = Enum.map(descendants ++ [os_pid], &Integer.to_string/1)
        System.cmd("kill", ["-9", "--" | pids], stderr_to_stdout: true)

      _ ->
        :ok
    end

    stop_port(port)
  end

  defp descendant_pids(root_pid) when is_integer(root_pid) do
    case System.cmd("ps", ["-eo", "pid=,ppid="], stderr_to_stdout: true) do
      {output, 0} ->
        children_by_parent =
          output
          |> String.split("\n", trim: true)
          |> Enum.reduce(%{}, fn line, acc ->
            case line |> String.split() |> Enum.map(&Integer.parse/1) do
              [{pid, ""}, {parent, ""}] ->
                Map.update(acc, parent, [pid], &[pid | &1])

              _ ->
                acc
            end
          end)

        collect_descendants(children_by_parent, [root_pid], MapSet.new())
        |> MapSet.delete(root_pid)
        |> MapSet.to_list()

      _ ->
        []
    end
  end

  defp collect_descendants(_children_by_parent, [], seen), do: seen

  defp collect_descendants(children_by_parent, [pid | pending], seen) do
    if MapSet.member?(seen, pid) do
      collect_descendants(children_by_parent, pending, seen)
    else
      children = Map.get(children_by_parent, pid, [])
      collect_descendants(children_by_parent, children ++ pending, MapSet.put(seen, pid))
    end
  end

  defp kill_port_children(port) when is_port(port) do
    case :erlang.port_info(port, :os_pid) do
      {:os_pid, os_pid} ->
        System.cmd("pkill", ["-9", "-P", to_string(os_pid)], stderr_to_stdout: true)
        :ok

      _ ->
        :ok
    end
  end

  @doc """
  Closes the port if it is still open; safe to call on an already-closed port.
  """
  @spec stop_port(port()) :: :ok
  def stop_port(port) when is_port(port) do
    case :erlang.port_info(port) do
      :undefined ->
        :ok

      _ ->
        try do
          Port.close(port)
          :ok
        rescue
          ArgumentError ->
            :ok
        end
    end
  end

  @doc """
  Single-quote escapes a shell path: wraps in single quotes, escapes interior
  single quotes as `'\\''`.
  """
  @spec shell_escape(String.t()) :: String.t()
  def shell_escape(path) do
    "'" <> String.replace(path, "'", "'\\''") <> "'"
  end

  @doc """
  Logs a truncated non-JSON stream line at warning level when it looks like an
  error, debug otherwise. `label` prefixes the message, e.g.
  `"Cursor cli stream"`.
  """
  @spec log_stray_line(iodata(), String.t()) :: :ok
  def log_stray_line(data, label) do
    text =
      data
      |> to_string()
      |> String.trim()
      |> String.slice(0, @max_stream_log_bytes)

    if text != "" do
      if String.match?(text, ~r/\b(error|warn|warning|failed|fatal|panic|exception)\b/i) do
        Logger.warning("#{label} output: #{text}")
      else
        Logger.debug("#{label} output: #{text}")
      end
    end

    :ok
  end
end
