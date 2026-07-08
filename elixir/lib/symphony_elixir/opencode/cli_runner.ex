defmodule SymphonyElixir.OpenCode.CliRunner do
  @moduledoc """
  Runs ONE OpenCode CLI turn:

      opencode run --format json [--model provider/model] [--session id]
                    [--agent plan|build] [--auto] < prompt

  Parses NDJSON events (`text`, `tool_use`, `error`) into the bridge vocabulary
  (`item/progress`, `item/created`, `turn/completed`, `turn/failed`).

  Component rule: NO tracker/Phoenix/Ecto imports — Jason + stdlib only.
  """

  require Logger

  alias SymphonyElixir.ExecutionMode

  @port_line_bytes 1_048_576
  @max_stream_log_bytes 1_000

  @type turn_args :: %{
          required(:command) => String.t(),
          required(:workspace) => Path.t(),
          required(:prompt) => String.t(),
          required(:session_uuid) => String.t(),
          required(:cli_session_id) => String.t() | nil,
          required(:model) => String.t() | nil,
          required(:timeout_ms) => pos_integer(),
          optional(:execution_mode) => String.t() | nil,
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

    symphony_dir = Path.join(workspace, ".symphony")
    File.mkdir_p!(symphony_dir)
    prompt_path = Path.join(symphony_dir, "opencode-prompt-#{session_uuid}.md")
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

  @safe_id_regex ~r/\A[A-Za-z0-9._-]+\z/
  @safe_model_regex ~r/\A[A-Za-z0-9._\/:-]+\z/
  @safe_agent_regex ~r/\A[A-Za-z0-9._-]+\z/

  @spec build_args(map()) :: String.t()
  def build_args(%{cli_session_id: cli_session_id, model: model} = args) do
    base = "run --format json"

    base
    <> model_flag(model)
    <> session_flag(cli_session_id)
    <> agent_flag(Map.get(args, :execution_mode))
    <> auto_flag(Map.get(args, :execution_mode))
  end

  defp model_flag(model) when is_binary(model) and model not in ["", "auto"] do
    if Regex.match?(@safe_model_regex, model) do
      " --model #{model}"
    else
      Logger.warning("OpenCode CliRunner: unsafe model rejected: #{inspect(model)}")
      ""
    end
  end

  defp model_flag(_model), do: ""

  defp session_flag(nil), do: ""

  defp session_flag(id) when is_binary(id) do
    if Regex.match?(@safe_id_regex, id) do
      " --session #{id}"
    else
      Logger.warning("OpenCode CliRunner: unsafe cli_session_id rejected: #{inspect(id)}")
      ""
    end
  end

  defp agent_flag(execution_mode) do
    agent = ExecutionMode.opencode_agent(execution_mode)

    if Regex.match?(@safe_agent_regex, agent) do
      " --agent #{agent}"
    else
      ""
    end
  end

  defp auto_flag("yolo"), do: " --auto"
  defp auto_flag(_execution_mode), do: ""

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
        handle_exit(on_event, status, state)
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
    if String.match?(line, ~r/(auth|authentication|credential|login)/i) do
      %{state | error: "Authentication required — run `opencode auth login`"}
    else
      state
    end
  end

  defp maybe_flag_invalid_resume(line, state) do
    if Regex.match?(~r/(session).*(not found|does not exist)/i, line) do
      %{state | resume_invalid: true}
    else
      state
    end
  end

  defp handle_exit(on_event, status, state) do
    has_error = not is_nil(state.error)
    clean_exit = status in [0, 130]

    cond do
      state.resume_invalid and (has_error or not clean_exit) ->
        {:error, {:resume_session_not_found, state.cli_session_id}}

      has_error or not clean_exit ->
        message = state.error || "opencode exited with code #{status}"

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

  defp process_event(%{"type" => "text", "part" => %{"text" => text}} = payload, on_event, state) do
    if is_binary(text) and text != "" do
      on_event.(%{
        "method" => "item/created",
        "params" => %{"item" => %{"type" => "text", "text" => text}}
      })
    end

    %{state | cli_session_id: Map.get(payload, "sessionID") || state.cli_session_id}
  end

  defp process_event(%{"type" => "tool_use", "part" => part} = payload, on_event, state) when is_map(part) do
    call_id = Map.get(part, "id") || Map.get(part, "callID") || synthetic_tool_id(part)
    tool_name = Map.get(part, "tool") || "unknown"
    input = Map.get(part, "input") || Map.get(part, "args") || %{}

    status =
      get_in(part, ["state", "status"]) ||
        get_in(part, ["state", "type"])

    case status do
      "running" ->
        on_event.(%{
          "method" => "item/created",
          "params" => %{
            "item" => %{
              "type" => "tool_call",
              "tool_use_id" => call_id,
              "name" => tool_name,
              "input" => input
            }
          }
        })

      status when status in ["completed", "error"] ->
        {content, is_error} = tool_result_content(part)

        on_event.(%{
          "method" => "item/created",
          "params" => %{
            "item" => %{
              "type" => "tool_result",
              "tool_use_id" => call_id,
              "name" => tool_name,
              "input" => input,
              "content" => content,
              "is_error" => is_error
            }
          }
        })

      _ ->
        :ok
    end

    %{state | cli_session_id: Map.get(payload, "sessionID") || state.cli_session_id}
  end

  defp process_event(%{"type" => "error", "error" => error} = payload, _on_event, state) do
    message =
      cond do
        is_binary(error) -> error
        is_map(error) -> Map.get(error, "message") || Jason.encode!(error)
        true -> "unknown error"
      end

    %{state | error: message, cli_session_id: Map.get(payload, "sessionID") || state.cli_session_id}
  end

  defp process_event(%{"sessionID" => session_id} = payload, _on_event, state) when is_binary(session_id) do
    usage = extract_usage(payload)

    %{
      state
      | cli_session_id: session_id,
        usage: usage || state.usage,
        cost_usd: Map.get(payload, "cost_usd") || state.cost_usd
    }
  end

  defp process_event(_unknown, _on_event, state), do: state

  defp tool_result_content(part) do
    state = Map.get(part, "state") || %{}

    cond do
      is_binary(Map.get(state, "error")) ->
        {Map.get(state, "error"), true}

      is_map(Map.get(state, "output")) ->
        {Jason.encode!(Map.get(state, "output")), false}

      is_binary(Map.get(state, "output")) ->
        {Map.get(state, "output"), false}

      true ->
        {Jason.encode!(state), Map.get(state, "status") == "error"}
    end
  end

  defp extract_usage(payload) do
    usage = Map.get(payload, "usage") || get_in(payload, ["part", "usage"])

    if is_map(usage) do
      %{
        "inputTokens" => token_value(usage, ~w(input input_tokens inputTokens prompt_tokens)),
        "outputTokens" => token_value(usage, ~w(output output_tokens outputTokens completion_tokens)),
        "totalTokens" => token_value(usage, ~w(total total_tokens totalTokens))
      }
    end
  end

  defp token_value(map, keys) do
    Enum.find_value(keys, fn key ->
      case Map.get(map, key) do
        v when is_integer(v) and v >= 0 -> v
        _ -> nil
      end
    end)
  end

  defp synthetic_tool_id(part) do
    part
    |> Jason.encode!()
    |> then(&:crypto.hash(:sha256, &1))
    |> Base.encode16(case: :lower)
    |> String.slice(0, 12)
  end

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
          ArgumentError -> :ok
        end
    end
  end

  defp log_non_json_stream_line(data, stream_label) do
    text =
      data
      |> to_string()
      |> String.trim()
      |> String.slice(0, @max_stream_log_bytes)

    if text != "" do
      if String.match?(text, ~r/\b(error|warn|warning|failed|fatal|panic|exception)\b/i) do
        Logger.warning("OpenCode #{stream_label} output: #{text}")
      else
        Logger.debug("OpenCode #{stream_label} output: #{text}")
      end
    end
  end
end
