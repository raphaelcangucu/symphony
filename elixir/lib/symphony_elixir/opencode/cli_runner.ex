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

  alias SymphonyElixir.Agent.CliRunner.Base
  alias SymphonyElixir.ExecutionMode

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

    prompt_path = Base.write_prompt_file(workspace, "opencode", session_uuid, prompt)
    port = Base.open_cli_port(command, build_args(args), prompt_path, workspace)
    Base.notify_spawn(port, Map.get(args, :on_spawn))

    initial_state = %{
      cli_session_id: args.cli_session_id,
      usage: nil,
      cost_usd: nil,
      error: nil,
      resume_invalid: false
    }

    handlers = [
      on_json: fn payload, state -> process_event(payload, on_event, state) end,
      on_stray_line: fn line, state ->
        Base.log_stray_line(line, "OpenCode cli stream")
        capture_cli_stream_error(line, state)
      end,
      on_exit: fn status, state ->
        Base.finalize_exit(on_event, status, state, exit_label: "opencode")
      end
    ]

    try do
      Base.receive_loop(port, timeout_ms, "", initial_state, handlers)
    after
      File.rm(prompt_path)
      Base.stop_port(port)
    end
  end

  @safe_id_regex ~r/\A[A-Za-z0-9._-]+\z/
  @safe_model_regex ~r/\A[A-Za-z0-9._\/:-]+\z/
  @safe_agent_regex ~r/\A[A-Za-z0-9._-]+\z/

  @spec build_args(map()) :: String.t()
  def build_args(%{cli_session_id: cli_session_id, model: model} = args) do
    base = "run --format json"

    base <>
      model_flag(model) <>
      session_flag(cli_session_id) <>
      agent_flag(Map.get(args, :execution_mode)) <>
      auto_flag(Map.get(args, :execution_mode))
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
    |> Elixir.Base.encode16(case: :lower)
    |> String.slice(0, 12)
  end
end
