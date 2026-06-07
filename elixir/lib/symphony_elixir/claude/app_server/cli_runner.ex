defmodule SymphonyElixir.Claude.AppServer.CliRunner do
  @moduledoc """
  Runs ONE Claude Code CLI turn:
  `claude --print --output-format stream-json --verbose --include-partial-messages ...`
  with the prompt delivered via a temp file + stdin redirect (Erlang ports
  cannot half-close stdin), parses the NDJSON stream and emits bridge-style
  notifications (`item/progress`, `item/created`, `usage/update`,
  `turn/completed`, `turn/failed`, `rate_limit`) through `on_event`.

  Component rule: NO tracker/Phoenix/Ecto imports — Jason + stdlib only.

  ### Exec vs env-prefix decision
  The test passes `command` as `FAKE_CLAUDE_MODE=happy /path/to/fake_claude.sh`,
  which is an env-prefixed shell invocation. We do NOT use `exec` in the shell
  command because `exec VAR=val cmd` is not valid bash syntax. Instead we let
  bash spawn the child directly: `bash -lc "FAKE... cmd args < prompt_file"`.

  ### Timeout / process-kill strategy
  On Linux (setsid available) we spawn via `setsid bash -lc ...` so bash becomes
  a new process-group leader (pgid == bash's pid). On timeout we send
  `kill -9 -<pgid>` which kills the entire group — bash, its direct children,
  and any grandchildren the real Claude CLI spawns.

  On macOS / systems without setsid we fall back to the legacy two-step:
  1. `pkill -9 -P <pid>` — kill direct children of bash.
  2. `kill -9 <pid>`     — kill bash itself.
  This legacy path does NOT kill grandchildren spawned with a new process group,
  but it is the best we can do without setsid.

  In both paths the port is closed after the kill signals are sent.
  """

  require Logger

  @port_line_bytes 1_048_576
  @max_stream_log_bytes 1_000

  @type turn_args :: %{
          required(:command) => String.t(),
          required(:workspace) => Path.t(),
          required(:prompt) => String.t(),
          required(:session_uuid) => String.t(),
          required(:cli_session_id) => String.t() | nil,
          required(:model) => String.t() | nil,
          optional(:effort) => String.t() | nil,
          required(:mcp_config_path) => Path.t() | nil,
          required(:permission_mode) => String.t(),
          required(:timeout_ms) => pos_integer(),
          optional(:on_spawn) => (non_neg_integer() -> any())
        }

  @type turn_result :: %{
          cli_session_id: String.t() | nil,
          status: :completed,
          usage: map() | nil,
          cost_usd: number() | nil
        }

  @spec run_turn(turn_args(), (map() -> any())) :: {:ok, turn_result()} | {:error, term()}
  def run_turn(args, on_event) do
    %{
      command: command,
      workspace: workspace,
      prompt: prompt,
      session_uuid: session_uuid,
      timeout_ms: timeout_ms
    } = args

    workspace = Path.expand(workspace)

    # Write prompt to a temp file (ports can't half-close stdin)
    symphony_dir = Path.join(workspace, ".symphony")
    File.mkdir_p!(symphony_dir)
    prompt_path = Path.join(symphony_dir, "claude-prompt-#{session_uuid}.md")
    File.write!(prompt_path, prompt)

    cli_args = build_args(args)
    escaped_prompt_path = shell_escape(prompt_path)
    shell_line = "#{command} #{cli_args} < #{escaped_prompt_path}"

    # Use setsid when available (Linux) so bash becomes a new process-group
    # leader (pgid == bash pid). This lets kill_port send kill -9 -<pgid> to
    # eliminate grandchildren too. On macOS / systems without setsid we fall
    # back to spawning bash directly and use the legacy pkill-P + kill-9 path.
    {executable, port_args} =
      case System.find_executable("setsid") do
        nil ->
          {System.find_executable("bash"), [~c"-lc", String.to_charlist(shell_line)]}

        setsid_path ->
          {setsid_path, [~c"--wait", ~c"bash", ~c"-lc", String.to_charlist(shell_line)]}
      end

    port =
      Port.open(
        {:spawn_executable, executable},
        [
          :binary,
          :exit_status,
          :stderr_to_stdout,
          args: port_args,
          cd: String.to_charlist(workspace),
          line: @port_line_bytes
        ]
      )

    # Notify the caller of the OS pid so it can perform group kills on interrupt.
    case Map.get(args, :on_spawn) do
      nil ->
        :ok

      on_spawn ->
        case :erlang.port_info(port, :os_pid) do
          {:os_pid, os_pid} -> on_spawn.(os_pid)
          _ -> :ok
        end
    end

    initial_state = %{
      cli_session_id: args.cli_session_id,
      usage: nil,
      cost_usd: nil,
      partial_text: %{},
      error: nil,
      resume_invalid: false
    }

    try do
      receive_loop(port, on_event, timeout_ms, "", initial_state)
    after
      File.rm(prompt_path)
      stop_port(port)
    end
  end

  # Only printable alphanumeric + safe punctuation — no spaces, semicolons, etc.
  @safe_id_regex ~r/\A[A-Za-z0-9._-]+\z/

  @spec build_args(map()) :: String.t()
  def build_args(
        %{
          session_uuid: session_uuid,
          cli_session_id: cli_session_id,
          model: model,
          mcp_config_path: mcp_config_path,
          permission_mode: permission_mode
        } = args
      ) do
    base = "--print --output-format stream-json --verbose --include-partial-messages --permission-mode #{permission_mode}"

    model_flag =
      if model, do: " --model #{model}", else: ""

    effort_flag = effort_flag(Map.get(args, :effort))

    mcp_flag =
      if mcp_config_path, do: " --mcp-config #{mcp_config_path} --strict-mcp-config", else: ""

    # Sanitize both ids before interpolating into the shell command.
    safe_cli_session_id = validate_session_id(cli_session_id, "cli_session_id")
    safe_session_uuid = validate_session_id(session_uuid, "session_uuid")

    session_flag =
      if safe_cli_session_id do
        " --resume #{safe_cli_session_id}"
      else
        " --session-id #{safe_session_uuid}"
      end

    base <> model_flag <> effort_flag <> mcp_flag <> session_flag
  end

  # Reasoning effort is a closed set in the Claude CLI. Whitelist it before
  # interpolating into the shell command — unknown values (the CLI ignores
  # them anyway) and any injection attempt are dropped at the exec boundary.
  @valid_efforts ~w(low medium high xhigh max)

  defp effort_flag(effort) when effort in @valid_efforts, do: " --effort #{effort}"
  defp effort_flag(_effort), do: ""

  # Returns the id unchanged when it matches the safe pattern; logs a warning
  # and returns nil when it does not (callers treat nil as "start fresh").
  defp validate_session_id(nil, _label), do: nil

  defp validate_session_id(id, label) when is_binary(id) do
    if Regex.match?(@safe_id_regex, id) do
      id
    else
      Logger.warning("CliRunner: unsafe #{label} rejected (contains disallowed chars): #{inspect(id)}")
      nil
    end
  end

  # ────────────────────────────────────────────────────────────
  # Private helpers
  # ────────────────────────────────────────────────────────────

  # Single-quote escape a shell path: wrap in single quotes, escape interior
  # single quotes as '\''
  defp shell_escape(path) do
    "'" <> String.replace(path, "'", "'\\''") <> "'"
  end

  defp receive_loop(port, on_event, timeout_ms, pending_line, state) do
    receive do
      {^port, {:data, {:eol, chunk}}} ->
        complete_line = pending_line <> to_string(chunk)
        handle_line(port, on_event, complete_line, timeout_ms, state)

      {^port, {:data, {:noeol, chunk}}} ->
        receive_loop(port, on_event, timeout_ms, pending_line <> to_string(chunk), state)

      {^port, {:exit_status, status}} ->
        handle_exit(port, on_event, status, state)
    after
      timeout_ms ->
        kill_port(port)
        {:error, :turn_timeout}
    end
  end

  defp handle_line(port, on_event, line, timeout_ms, state) do
    case Jason.decode(line) do
      {:ok, payload} ->
        new_state = process_event(payload, on_event, state)
        receive_loop(port, on_event, timeout_ms, "", new_state)

      {:error, _reason} ->
        log_non_json_stream_line(line, "cli stream")
        receive_loop(port, on_event, timeout_ms, "", maybe_flag_invalid_resume(line, state))
    end
  end

  # The claude CLI reports a `--resume` to a session it no longer knows as a plain
  # (non-JSON) "No conversation found with session ID: <id>" line and then aborts.
  # Flag it so handle_exit can surface a distinct error the adapter can recover from.
  defp maybe_flag_invalid_resume(line, state) do
    if String.contains?(line, "No conversation found with session ID"), do: %{state | resume_invalid: true}, else: state
  end

  defp handle_exit(_port, on_event, status, state) do
    has_error = not is_nil(state.error)
    clean_exit = status in [0, 130]

    cond do
      state.resume_invalid and (has_error or not clean_exit) ->
        # The resume target no longer exists in claude's local session store. Return a
        # distinct error (no turn/failed event) so the adapter can transparently retry
        # the turn as a fresh session instead of hard-failing the thread forever.
        {:error, {:resume_session_not_found, state.cli_session_id}}

      has_error or not clean_exit ->
        message = state.error || "claude exited with code #{status}"

        on_event.(%{
          "method" => "turn/failed",
          "params" => %{"error" => message}
        })

        {:error, {:turn_failed, message}}

      true ->
        usage = usage_with_total(state.usage)

        on_event.(%{
          "method" => "turn/completed",
          "params" => %{
            "usage" => usage,
            "cost_usd" => state.cost_usd
          }
        })

        {:ok,
         %{
           cli_session_id: state.cli_session_id,
           status: :completed,
           usage: usage,
           cost_usd: state.cost_usd
         }}
    end
  end

  # ────────────────────────────────────────────────────────────
  # Event processing: translate NDJSON -> bridge events
  # ────────────────────────────────────────────────────────────

  defp process_event(%{"type" => "system", "subtype" => "init", "session_id" => sid}, _on_event, state) do
    %{state | cli_session_id: sid}
  end

  defp process_event(%{"type" => "assistant"} = payload, on_event, state) do
    is_partial = Map.get(payload, "is_partial", false)
    msg_id = get_in(payload, ["message", "id"])
    content_blocks = get_in(payload, ["message", "content"]) || []

    Enum.reduce(content_blocks, state, fn block, acc ->
      process_assistant_block(block, is_partial, msg_id, on_event, acc)
    end)
  end

  defp process_event(%{"type" => "user"} = payload, on_event, state) do
    content_blocks = get_in(payload, ["message", "content"]) || []

    Enum.each(content_blocks, fn block ->
      process_user_block(block, on_event)
    end)

    state
  end

  defp process_event(
         %{"type" => "stream_event", "stream_event" => %{"type" => "message_delta", "usage" => usage}},
         on_event,
         state
       ) do
    new_state = %{state | usage: usage}
    usage_total = usage_with_total(usage)

    on_event.(%{
      "method" => "usage/update",
      "params" => %{"usage" => usage_total}
    })

    new_state
  end

  defp process_event(%{"type" => "result"} = payload, _on_event, state) do
    new_cli_session_id = Map.get(payload, "session_id") || state.cli_session_id
    new_usage = Map.get(payload, "usage") || state.usage
    new_cost = Map.get(payload, "total_cost_usd") || Map.get(payload, "cost_usd") || state.cost_usd

    new_state = %{state | cli_session_id: new_cli_session_id, usage: new_usage, cost_usd: new_cost}

    case Map.get(payload, "subtype") do
      "error" ->
        error_msg = Map.get(payload, "error") || "unknown error"
        %{new_state | error: error_msg}

      _ ->
        new_state
    end
  end

  defp process_event(%{"type" => "rate_limit_event"} = payload, on_event, state) do
    on_event.(%{
      "method" => "rate_limit",
      "params" => payload
    })

    state
  end

  defp process_event(_unknown, _on_event, state) do
    state
  end

  # ────────────────────────────────────────────────────────────
  # Assistant content block handlers
  # ────────────────────────────────────────────────────────────

  defp process_assistant_block(%{"type" => "text", "text" => text} = _block, true, msg_id, on_event, state) do
    # Partial text delta: compute delta vs already-accumulated
    accumulated = Map.get(state.partial_text, msg_id, "")
    delta = String.slice(text, String.length(accumulated), String.length(text))

    on_event.(%{
      "method" => "item/progress",
      "params" => %{
        "delta" => %{"type" => "text", "text" => delta}
      }
    })

    new_partial = Map.put(state.partial_text, msg_id, text)
    %{state | partial_text: new_partial}
  end

  defp process_assistant_block(%{"type" => "text", "text" => text}, false, msg_id, on_event, state) do
    # Final text block
    on_event.(%{
      "method" => "item/created",
      "params" => %{
        "item" => %{"type" => "text", "text" => text}
      }
    })

    new_partial = Map.delete(state.partial_text, msg_id)
    %{state | partial_text: new_partial}
  end

  defp process_assistant_block(%{"type" => "thinking", "thinking" => thinking}, _is_partial, _msg_id, on_event, state) do
    on_event.(%{
      "method" => "item/created",
      "params" => %{
        "item" => %{"type" => "thinking", "thinking" => thinking}
      }
    })

    state
  end

  defp process_assistant_block(
         %{"type" => "tool_use", "id" => id, "name" => name, "input" => input},
         _is_partial,
         _msg_id,
         on_event,
         state
       ) do
    on_event.(%{
      "method" => "item/created",
      "params" => %{
        "item" => %{
          "type" => "tool_call",
          "tool_use_id" => id,
          "name" => name,
          "input" => input
        }
      }
    })

    state
  end

  defp process_assistant_block(_block, _is_partial, _msg_id, _on_event, state), do: state

  # ────────────────────────────────────────────────────────────
  # User (tool_result) content block handlers
  # ────────────────────────────────────────────────────────────

  defp process_user_block(
         %{"type" => "tool_result", "tool_use_id" => tool_use_id} = block,
         on_event
       ) do
    content = Map.get(block, "content", "")
    is_error = Map.get(block, "is_error", false)

    text_content = join_content(content)

    on_event.(%{
      "method" => "item/created",
      "params" => %{
        "item" => %{
          "type" => "tool_result",
          "tool_use_id" => tool_use_id,
          "content" => text_content,
          "is_error" => is_error
        }
      }
    })
  end

  defp process_user_block(_block, _on_event), do: :ok

  # Join content that may be a list of %{"text" => t} or a plain string
  defp join_content(content) when is_binary(content), do: content

  defp join_content(content) when is_list(content) do
    content
    |> Enum.map(fn
      %{"text" => t} -> t
      other when is_binary(other) -> other
      _ -> ""
    end)
    |> Enum.join("")
  end

  defp join_content(_), do: ""

  # ────────────────────────────────────────────────────────────
  # Usage helpers
  # ────────────────────────────────────────────────────────────

  @spec usage_with_total(map() | nil) :: map() | nil
  def usage_with_total(nil), do: nil

  def usage_with_total(usage) when is_map(usage) do
    input = Map.get(usage, "input_tokens", 0) || 0
    output = Map.get(usage, "output_tokens", 0) || 0
    cache_read = Map.get(usage, "cache_read_input_tokens", 0) || 0
    cache_creation = Map.get(usage, "cache_creation_input_tokens", 0) || 0

    %{
      input_tokens: input,
      output_tokens: output,
      total_tokens: input + output + cache_read + cache_creation
    }
  end

  # ────────────────────────────────────────────────────────────
  # Port management (copied from CodingAgent.stop_port/1 pattern)
  # ────────────────────────────────────────────────────────────

  # Kill the process tree spawned by the port, then close the port.
  # Used on timeout.
  #
  # setsid path (Linux, setsid available at spawn time): bash is the
  # process-group leader (pgid == bash's pid). Sending kill -9 -<pgid>
  # atomically kills bash, its direct children, and all grandchildren that
  # share the group — i.e. helpers spawned by the real Claude CLI.
  #
  # Legacy fallback (macOS / no setsid): bash was NOT placed in a new group,
  # so we do the two-step: pkill -P kills direct children, then kill -9 kills
  # bash itself. Grandchildren that escaped to a different group survive.
  defp kill_port(port) when is_port(port) do
    case :erlang.port_info(port, :os_pid) do
      {:os_pid, os_pid} ->
        pid_str = to_string(os_pid)

        if System.find_executable("setsid") do
          # setsid was used at spawn time → pgid == os_pid → kill whole group
          System.cmd("kill", ["-9", "-#{pid_str}"], stderr_to_stdout: true)
        else
          # Legacy path: kill direct children first, then bash itself
          System.cmd("pkill", ["-9", "-P", pid_str], stderr_to_stdout: true)
          System.cmd("kill", ["-9", pid_str], stderr_to_stdout: true)
        end

      _ ->
        :ok
    end

    stop_port(port)
  end

  defp stop_port(port) when is_port(port) do
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

  # ────────────────────────────────────────────────────────────
  # Logging helpers (same style as CodingAgent.log_non_json_stream_line/2)
  # ────────────────────────────────────────────────────────────

  defp log_non_json_stream_line(data, stream_label) do
    text =
      data
      |> to_string()
      |> String.trim()
      |> String.slice(0, @max_stream_log_bytes)

    if text != "" do
      if String.match?(text, ~r/\b(error|warn|warning|failed|fatal|panic|exception)\b/i) do
        Logger.warning("Claude #{stream_label} output: #{text}")
      else
        Logger.debug("Claude #{stream_label} output: #{text}")
      end
    end
  end
end
