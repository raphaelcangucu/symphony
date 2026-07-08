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
  Shared with the other CLI runners via `SymphonyElixir.Agent.CliRunner.Base`:
  setsid process-group kill on Linux, legacy `pkill -P` + `kill -9` fallback on
  macOS / systems without setsid. In both paths the port is closed after the
  kill signals are sent.
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

    prompt_path = Base.write_prompt_file(workspace, "claude", session_uuid, prompt)
    port = Base.open_cli_port(command, build_args(args), prompt_path, workspace)
    Base.notify_spawn(port, Map.get(args, :on_spawn))

    initial_state = %{
      cli_session_id: args.cli_session_id,
      usage: nil,
      cost_usd: nil,
      partial_text: %{},
      error: nil,
      resume_invalid: false
    }

    handlers = [
      on_json: fn payload, state -> process_event(payload, on_event, state) end,
      on_stray_line: fn line, state ->
        Base.log_stray_line(line, "Claude cli stream")
        maybe_flag_invalid_resume(line, state)
      end,
      on_exit: fn status, state ->
        Base.finalize_exit(on_event, status, state,
          exit_label: "claude",
          transform_usage: &usage_with_total/1
        )
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

  # The claude CLI reports a `--resume` to a session it no longer knows as a plain
  # (non-JSON) "No conversation found with session ID: <id>" line and then aborts.
  # Flag it so handle_exit can surface a distinct error the adapter can recover from.
  defp maybe_flag_invalid_resume(line, state) do
    if String.contains?(line, "No conversation found with session ID"), do: %{state | resume_invalid: true}, else: state
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
end
