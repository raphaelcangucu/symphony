defmodule SymphonyElixir.Cursor.CliRunner do
  @moduledoc """
  Runs ONE Cursor Agent CLI turn:
  `cursor-agent --print --output-format stream-json --stream-partial-output --force ...`
  with the prompt delivered via a temp file + stdin redirect (Erlang ports
  cannot half-close stdin), parses the NDJSON stream and emits bridge-style
  notifications (`item/progress`, `item/created`, `turn/completed`,
  `turn/failed`) through `on_event`.

  Component rule: NO tracker/Phoenix/Ecto imports — Jason + stdlib only.

  ### Stream vocabulary (cursor-agent stream-json)

  With `--stream-partial-output` the CLI emits three kinds of `assistant`
  events; only deltas carry new text:

  | `timestamp_ms` | `model_call_id` | Meaning                                 |
  |----------------|-----------------|-----------------------------------------|
  | present        | absent          | streaming delta (new text)              |
  | present        | present         | buffered flush before a tool call       |
  | absent         | absent          | final flush at end of turn              |

  Deltas become `item/progress`; flushes become `item/created` (one per
  message segment). `tool_call` started/completed events become
  `item/created` tool_call / tool_result items. The terminal `result` event
  carries the resumable `session_id` (chat id).

  ### Timeout / process-kill strategy

  Same as `SymphonyElixir.Claude.AppServer.CliRunner`: spawn via
  `setsid bash -lc ...` when setsid is available so the whole process group
  can be killed with `kill -9 -<pgid>` on timeout; legacy `pkill -P` +
  `kill -9` fallback otherwise.
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
          required(:mcp_config_path) => Path.t() | nil,
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
    prompt_path = Path.join(symphony_dir, "cursor-prompt-#{session_uuid}.md")
    File.write!(prompt_path, prompt)

    cli_args = build_args(args)
    escaped_prompt_path = shell_escape(prompt_path)
    shell_line = "#{command} #{cli_args} < #{escaped_prompt_path}"

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

  # Models the CLI accepts via --model are short slugs; whitelist the shape
  # before interpolating into the shell command.
  @safe_model_regex ~r/\A[A-Za-z0-9._-]+\z/

  @spec build_args(map()) :: String.t()
  def build_args(%{cli_session_id: cli_session_id, model: model} = args) do
    base = "--print --output-format stream-json --stream-partial-output --force"

    model_flag = model_flag(model)

    # The cursor-agent CLI reads MCP servers from <workspace>/.cursor/mcp.json;
    # there is no --mcp-config flag. When the adapter wrote a session config we
    # only need to auto-approve it for the headless run.
    mcp_flag =
      if Map.get(args, :mcp_config_path), do: " --approve-mcps", else: ""

    safe_cli_session_id = validate_session_id(cli_session_id, "cli_session_id")

    session_flag =
      if safe_cli_session_id do
        " --resume #{safe_cli_session_id}"
      else
        ""
      end

    base <> model_flag <> mcp_flag <> session_flag
  end

  # "auto" delegates to the CLI's own default model selection; passing it as a
  # --model value is not supported, so we omit the flag entirely.
  defp model_flag(model) when is_binary(model) and model not in ["", "auto"] do
    if Regex.match?(@safe_model_regex, model) do
      " --model #{model}"
    else
      Logger.warning("Cursor CliRunner: unsafe model rejected (contains disallowed chars): #{inspect(model)}")
      ""
    end
  end

  defp model_flag(_model), do: ""

  # Returns the id unchanged when it matches the safe pattern; logs a warning
  # and returns nil when it does not (callers treat nil as "start fresh").
  defp validate_session_id(nil, _label), do: nil

  defp validate_session_id(id, label) when is_binary(id) do
    if Regex.match?(@safe_id_regex, id) do
      id
    else
      Logger.warning("Cursor CliRunner: unsafe #{label} rejected (contains disallowed chars): #{inspect(id)}")
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
        receive_loop(port, on_event, timeout_ms, "", capture_cli_stream_error(line, state))
    end
  end

  defp capture_cli_stream_error(line, state) do
    state
    |> then(&maybe_flag_invalid_resume(line, &1))
    |> maybe_flag_auth_error(line)
  end

  defp maybe_flag_auth_error(state, line) do
    if String.contains?(line, "Authentication required") do
      %{
        state
        | error:
            "Authentication required — run `cursor agent login` or set CURSOR_API_KEY"
      }
    else
      state
    end
  end

  # A `--resume` to a chat the CLI no longer knows aborts with a plain (non-JSON)
  # error line. Flag it so handle_exit can surface a distinct error the adapter
  # can recover from by retrying with a fresh session.
  defp maybe_flag_invalid_resume(line, state) do
    if Regex.match?(~r/(chat|session|conversation).*(not found|does not exist)/i, line) do
      %{state | resume_invalid: true}
    else
      state
    end
  end

  defp handle_exit(_port, on_event, status, state) do
    has_error = not is_nil(state.error)
    clean_exit = status in [0, 130]

    cond do
      state.resume_invalid and (has_error or not clean_exit) ->
        {:error, {:resume_session_not_found, state.cli_session_id}}

      has_error or not clean_exit ->
        message = state.error || "cursor-agent exited with code #{status}"

        on_event.(%{
          "method" => "turn/failed",
          "params" => %{"error" => message}
        })

        {:error, {:turn_failed, message}}

      true ->
        on_event.(%{
          "method" => "turn/completed",
          "params" => %{
            "usage" => state.usage,
            "cost_usd" => state.cost_usd
          }
        })

        {:ok,
         %{
           cli_session_id: state.cli_session_id,
           status: :completed,
           usage: state.usage,
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
    text = assistant_text(payload)
    timestamp? = Map.has_key?(payload, "timestamp_ms")
    model_call_id? = Map.has_key?(payload, "model_call_id")

    cond do
      timestamp? and not model_call_id? ->
        # Streaming delta: contains only the new text chunk.
        on_event.(%{
          "method" => "item/progress",
          "params" => %{"delta" => %{"type" => "text", "text" => text}}
        })

      true ->
        # Buffered flush (before a tool call) or final flush at end of turn:
        # contains the complete message segment text.
        on_event.(%{
          "method" => "item/created",
          "params" => %{"item" => %{"type" => "text", "text" => text}}
        })
    end

    state
  end

  defp process_event(%{"type" => "tool_call", "subtype" => "started", "call_id" => call_id} = payload, on_event, state) do
    {name, input} = tool_call_details(Map.get(payload, "tool_call") || %{})

    on_event.(%{
      "method" => "item/created",
      "params" => %{
        "item" => %{
          "type" => "tool_call",
          "tool_use_id" => call_id,
          "name" => name,
          "input" => input
        }
      }
    })

    state
  end

  defp process_event(%{"type" => "tool_call", "subtype" => "completed", "call_id" => call_id} = payload, on_event, state) do
    {_name, result, is_error} = tool_call_result(Map.get(payload, "tool_call") || %{})

    on_event.(%{
      "method" => "item/created",
      "params" => %{
        "item" => %{
          "type" => "tool_result",
          "tool_use_id" => call_id,
          "content" => result,
          "is_error" => is_error
        }
      }
    })

    state
  end

  defp process_event(%{"type" => "result"} = payload, _on_event, state) do
    new_cli_session_id = Map.get(payload, "session_id") || state.cli_session_id
    new_usage = Map.get(payload, "usage") || state.usage

    new_cost =
      Map.get(payload, "total_cost_usd") || Map.get(payload, "cost_usd") || state.cost_usd

    new_state = %{state | cli_session_id: new_cli_session_id, usage: new_usage, cost_usd: new_cost}

    if Map.get(payload, "is_error", false) or Map.get(payload, "subtype") == "error" do
      %{new_state | error: Map.get(payload, "error") || Map.get(payload, "result") || "unknown error"}
    else
      new_state
    end
  end

  defp process_event(_unknown, _on_event, state) do
    state
  end

  defp assistant_text(payload) do
    (get_in(payload, ["message", "content"]) || [])
    |> Enum.map_join("", fn
      %{"type" => "text", "text" => text} -> text
      _ -> ""
    end)
  end

  # cursor-agent encodes the tool either as a typed key (`readToolCall`,
  # `writeToolCall`, ...) wrapping `args`/`result`, or as a generic
  # `function` with `name`/`arguments`.
  defp tool_call_details(%{"function" => %{"name" => name} = function}) do
    {name, decode_arguments(Map.get(function, "arguments"))}
  end

  defp tool_call_details(tool_call) when is_map(tool_call) do
    case Enum.find(tool_call, fn {_key, value} -> is_map(value) end) do
      {key, value} -> {tool_name(key), Map.get(value, "args") || %{}}
      nil -> {"unknown", %{}}
    end
  end

  defp tool_call_result(%{"function" => %{"name" => name} = function}) do
    {name, encode_content(Map.get(function, "result")), false}
  end

  defp tool_call_result(tool_call) when is_map(tool_call) do
    case Enum.find(tool_call, fn {_key, value} -> is_map(value) end) do
      {key, value} ->
        result = Map.get(value, "result") || %{}
        is_error = is_map(result) and not Map.has_key?(result, "success") and result != %{}
        {tool_name(key), encode_content(result), is_error}

      nil ->
        {"unknown", "", false}
    end
  end

  defp tool_name(key) when is_binary(key), do: String.replace_suffix(key, "ToolCall", "")

  defp decode_arguments(arguments) when is_binary(arguments) do
    case Jason.decode(arguments) do
      {:ok, decoded} when is_map(decoded) -> decoded
      _ -> %{"raw" => arguments}
    end
  end

  defp decode_arguments(arguments) when is_map(arguments), do: arguments
  defp decode_arguments(_arguments), do: %{}

  defp encode_content(nil), do: ""
  defp encode_content(content) when is_binary(content), do: content
  defp encode_content(content), do: Jason.encode!(content)

  # ────────────────────────────────────────────────────────────
  # Port management (same pattern as Claude CliRunner)
  # ────────────────────────────────────────────────────────────

  defp kill_port(port) when is_port(port) do
    case :erlang.port_info(port, :os_pid) do
      {:os_pid, os_pid} ->
        pid_str = to_string(os_pid)

        if System.find_executable("setsid") do
          System.cmd("kill", ["-9", "-#{pid_str}"], stderr_to_stdout: true)
        else
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
  # Logging helpers
  # ────────────────────────────────────────────────────────────

  defp log_non_json_stream_line(data, stream_label) do
    text =
      data
      |> to_string()
      |> String.trim()
      |> String.slice(0, @max_stream_log_bytes)

    if text != "" do
      if String.match?(text, ~r/\b(error|warn|warning|failed|fatal|panic|exception)\b/i) do
        Logger.warning("Cursor #{stream_label} output: #{text}")
      else
        Logger.debug("Cursor #{stream_label} output: #{text}")
      end
    end
  end
end
