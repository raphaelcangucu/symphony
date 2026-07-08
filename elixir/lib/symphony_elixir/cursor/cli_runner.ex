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

  Shared with the other CLI runners via `SymphonyElixir.Agent.CliRunner.Base`:
  spawn via `setsid bash -lc ...` when setsid is available so the whole process
  group can be killed with `kill -9 -<pgid>` on timeout; legacy `pkill -P` +
  `kill -9` fallback otherwise.
  """

  require Logger

  alias SymphonyElixir.Agent.CliRunner.Base

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

    prompt_path = Base.write_prompt_file(workspace, "cursor", session_uuid, prompt)
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
        Base.log_stray_line(line, "Cursor cli stream")
        capture_cli_stream_error(line, state)
      end,
      on_exit: fn status, state ->
        Base.finalize_exit(on_event, status, state, exit_label: "cursor-agent")
      end
    ]

    try do
      Base.receive_loop(port, timeout_ms, "", initial_state, handlers)
    after
      File.rm(prompt_path)
      Base.stop_port(port)
    end
  end

  # Only printable alphanumeric + safe punctuation — no spaces, semicolons, etc.
  @safe_id_regex ~r/\A[A-Za-z0-9._-]+\z/

  # Models the CLI accepts via --model are short slugs; whitelist the shape
  # before interpolating into the shell command.
  @safe_model_regex ~r/\A[A-Za-z0-9._-]+\z/

  @spec build_args(map()) :: String.t()
  def build_args(%{cli_session_id: cli_session_id, model: model} = args) do
    base = "--print --output-format stream-json --stream-partial-output"

    mode_flag = mode_flag(Map.get(args, :execution_mode))
    force_flag = force_flag(Map.get(args, :execution_mode))

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

    base <> mode_flag <> force_flag <> model_flag <> mcp_flag <> session_flag
  end

  # Cursor Agent supports a native read-only planning mode via `--mode plan`.
  # Kept inline (not via ExecutionMode) to honor this component's stdlib-only
  # boundary.
  defp mode_flag("plan"), do: " --mode plan"
  defp mode_flag(_execution_mode), do: ""

  # Only `yolo` enables --force (Run Everything / bypass command confirmation).
  defp force_flag("yolo"), do: " --force"
  defp force_flag(_execution_mode), do: ""

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

  defp capture_cli_stream_error(line, state) do
    state
    |> then(&maybe_flag_invalid_resume(line, &1))
    |> maybe_flag_auth_error(line)
  end

  defp maybe_flag_auth_error(state, line) do
    if String.contains?(line, "Authentication required") do
      %{
        state
        | error: "Authentication required — run `cursor agent login` or set CURSOR_API_KEY"
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
    tool_call = Map.get(payload, "tool_call") || %{}
    {name, input, result, is_error} = tool_call_completion(tool_call)

    on_event.(%{
      "method" => "item/created",
      "params" => %{
        "item" => %{
          "type" => "tool_result",
          "tool_use_id" => call_id,
          "name" => name,
          "input" => input,
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
    {display_tool_name(name), decode_arguments(Map.get(function, "arguments"))}
  end

  defp tool_call_details(tool_call) when is_map(tool_call) do
    case typed_tool_entry(tool_call) do
      {key, value} ->
        {display_tool_name(tool_name(key)), tool_args(value)}

      nil ->
        {infer_tool_name(tool_call), %{}}
    end
  end

  defp tool_call_completion(%{"function" => %{"name" => name} = function}) do
    result = Map.get(function, "result")

    {
      display_tool_name(name),
      decode_arguments(Map.get(function, "arguments")),
      encode_content(result),
      tool_result_error?(result)
    }
  end

  defp tool_call_completion(tool_call) when is_map(tool_call) do
    case typed_tool_entry(tool_call) do
      {key, value} ->
        result = Map.get(value, "result") || %{}

        {
          display_tool_name(tool_name(key)),
          tool_args(value),
          encode_content(result),
          tool_result_error?(result)
        }

      nil ->
        encoded = encode_content(tool_call)
        {infer_tool_name(tool_call), %{}, encoded, tool_result_error?(tool_call)}
    end
  end

  defp typed_tool_entry(tool_call) when is_map(tool_call) do
    case Enum.find(tool_call, fn {_key, value} -> is_map(value) end) do
      {key, value} -> {key, value}
      nil -> nil
    end
  end

  defp tool_args(value) when is_map(value) do
    Map.get(value, "args") || Map.get(value, "arguments") || %{}
  end

  defp tool_args(_value), do: %{}

  defp tool_result_error?(result) when is_map(result) do
    Map.has_key?(result, "error") or
      (not Map.has_key?(result, "success") and result != %{})
  end

  defp tool_result_error?(result) when is_binary(result) do
    case Jason.decode(result) do
      {:ok, decoded} when is_map(decoded) -> tool_result_error?(decoded)
      _ -> false
    end
  end

  defp tool_result_error?(_result), do: false

  defp infer_tool_name(tool_call) when is_map(tool_call) do
    tool_call
    |> Jason.encode!()
    |> infer_tool_name_from_text()
  end

  defp infer_tool_name_from_text(text) when is_binary(text) do
    cond do
      String.contains?(text, "Glob pattern") -> "Glob"
      String.contains?(text, "glob_pattern") -> "Glob"
      true -> "unknown"
    end
  end

  @cursor_tool_labels %{
    "glob" => "Glob",
    "grep" => "Grep",
    "read" => "Read",
    "write" => "Write",
    "edit" => "Edit",
    "shell" => "Bash",
    "semsearch" => "SemanticSearch",
    "ls" => "List",
    "delete" => "Delete"
  }

  defp display_tool_name(name) when is_binary(name) do
    normalized = String.downcase(name)

    cond do
      Map.has_key?(@cursor_tool_labels, normalized) ->
        Map.fetch!(@cursor_tool_labels, normalized)

      String.starts_with?(name, "mcp__") ->
        name

      true ->
        humanize_tool_name(name)
    end
  end

  defp display_tool_name(_name), do: "unknown"

  defp humanize_tool_name(name) when is_binary(name) do
    name
    |> String.replace("_", " ")
    |> String.split()
    |> Enum.filter(&(&1 != ""))
    |> case do
      [] -> name
      [first | rest] -> String.capitalize(first) <> Enum.map_join(rest, " ", &String.capitalize/1)
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
end
