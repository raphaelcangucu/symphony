defmodule SymphonyElixir.Codex.SessionLog do
  @moduledoc """
  Reads and parses Codex rollout JSONL session logs for live UI streaming.

  Rollout files live under `~/.codex/sessions/**/rollout-*.jsonl`. The workspace
  sidecar (`.symphony/codex-session.json`) holds the active `thread_id`.
  """

  @default_tail_bytes 65_536

  @spec resolve_rollout_path(Path.t(), keyword()) :: {:ok, Path.t()} | :error
  def resolve_rollout_path(workspace, opts \\ []) when is_binary(workspace) do
    with {:ok, thread_id} <- SymphonyElixir.Codex.Session.resolve(workspace, opts),
         {:ok, path} <- rollout_path_for_thread(thread_id, opts) do
      {:ok, path}
    else
      _ -> :error
    end
  end

  @spec tail(Path.t(), keyword()) :: {:ok, [map()], non_neg_integer()}
  def tail(path, opts \\ []) when is_binary(path) do
    max_bytes = Keyword.get(opts, :max_bytes, @default_tail_bytes)

    case File.stat(path) do
      {:ok, %File.Stat{size: size}} when size > 0 ->
        start = max(size - max_bytes, 0)
        read_chunk(path, start, size)

      _ ->
        {:ok, [], 0}
    end
  end

  @spec read_from(Path.t(), non_neg_integer()) :: {:ok, [map()], non_neg_integer()} | {:error, term()}
  def read_from(path, offset) when is_binary(path) and is_integer(offset) and offset >= 0 do
    case File.stat(path) do
      {:ok, %File.Stat{size: size}} when size > offset ->
        read_chunk(path, offset, size)

      {:ok, %File.Stat{size: size}} ->
        {:ok, [], size}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc "Parses one rollout JSONL line into a UI-facing entry map."
  @spec parse_line(String.t()) :: map() | nil
  def parse_line(line) when is_binary(line) do
    trimmed = String.trim(line)

    if trimmed == "" do
      nil
    else
      case Jason.decode(trimmed) do
        {:ok, decoded} -> parse_decoded(decoded)
        {:error, _} -> nil
      end
    end
  end

  def parse_line(_line), do: nil

  @doc false
  @spec format_line(String.t()) :: String.t() | nil
  def format_line(line), do: line |> parse_line() |> entry_summary()

  defp entry_summary(%{"title" => title, "body" => body})
       when is_binary(title) and is_binary(body) and body != "" do
    "#{title}: #{trim_display(body, 240)}"
  end

  defp entry_summary(%{"title" => title}) when is_binary(title), do: title
  defp entry_summary(_entry), do: nil

  defp rollout_path_for_thread(thread_id, opts) when is_binary(thread_id) do
    sessions_dir(opts)
    |> Path.join("**/*.jsonl")
    |> Path.wildcard()
    |> Enum.find_value(:error, fn file ->
      if String.contains?(Path.basename(file), thread_id), do: {:ok, file}
    end)
  end

  defp sessions_dir(opts) do
    Keyword.get(opts, :sessions_dir) ||
      Application.get_env(:symphony_elixir, :codex_sessions_dir) ||
      Path.expand("~/.codex/sessions")
  end

  defp read_chunk(path, offset, size) do
    case File.open(path, [:read, :binary]) do
      {:ok, io} ->
        try do
          :file.pread(io, offset, size - offset)
          |> case do
            {:ok, binary} -> split_lines(binary, size)
            {:error, reason} -> {:error, reason}
          end
        after
          File.close(io)
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp split_lines(binary, size) when is_binary(binary) do
    entries =
      binary
      |> String.split("\n", trim: false)
      |> Enum.map(&parse_line/1)
      |> Enum.reject(&is_nil/1)

    {:ok, entries, size}
  end

  defp parse_decoded(%{"type" => "session_meta", "payload" => payload}) when is_map(payload) do
    cwd = Map.get(payload, "cwd") || Map.get(payload, "workspace")

    entry("meta", "Session started", cwd, language: "text", collapsed: false)
  end

  defp parse_decoded(%{"type" => "turn_context"}) do
    entry("meta", "Turn context updated", nil, collapsed: true)
  end

  defp parse_decoded(%{"type" => "event_msg", "payload" => payload}) when is_map(payload) do
    parse_event_msg(payload)
  end

  defp parse_decoded(%{"type" => "response_item", "payload" => payload}) when is_map(payload) do
    parse_response_item(payload)
  end

  defp parse_decoded(%{"type" => type}) when is_binary(type) do
    entry("event", humanize_type(type), nil)
  end

  defp parse_decoded(_decoded), do: entry("event", "Log entry", nil)

  defp parse_event_msg(%{"type" => "task_started"} = payload) do
    model = Map.get(payload, "model_context_window")

    body =
      case model do
        n when is_integer(n) -> "Context window: #{n} tokens"
        _ -> nil
      end

    entry("event", "Task started", body, collapsed: false)
  end

  defp parse_event_msg(%{"type" => "turn_aborted"} = payload) do
    entry("event", "Turn aborted", format_turn_abort_body(payload),
      collapsed: false,
      status: "failed"
    )
  end

  defp parse_event_msg(%{"type" => type, "message" => message}) when is_binary(message) and message != "" do
    entry("event", humanize_type(type), message, collapsed: String.length(message) > 280)
  end

  defp parse_event_msg(%{"type" => type}) when is_binary(type) do
    entry("event", humanize_type(type), nil)
  end

  defp parse_event_msg(_payload), do: nil

  defp parse_response_item(%{"type" => "message", "role" => role, "content" => content}) when is_list(content) do
    body = content_text(content)

    cond do
      role == "developer" ->
        entry("system", "System instructions", body, collapsed: true)

      role == "user" and byte_size(body || "") > 2_000 ->
        entry("user", "Initial prompt", body, collapsed: true)

      role == "user" ->
        entry("user", "You", body, collapsed: false)

      role == "assistant" ->
        entry("assistant", "Codex", body, language: "markdown", collapsed: false)

      true ->
        entry("message", humanize_type(role || "message"), body, collapsed: byte_size(body || "") > 600)
    end
  end

  defp parse_response_item(%{"type" => "reasoning"}) do
    entry("reasoning", "Reasoning", "The model worked through the next step internally.", collapsed: true)
  end

  defp parse_response_item(%{"type" => "function_call", "name" => name} = payload) when is_binary(name) do
    args = Map.get(payload, "arguments")

    entry("tool_call", name, format_tool_input(args),
      language: tool_language(name, args),
      status: "running",
      collapsed: false,
      call_id: Map.get(payload, "call_id")
    )
  end

  defp parse_response_item(%{"type" => "function_call_output", "output" => output} = payload) when is_binary(output) do
    entry("tool_result", "Command output", output,
      language: "text",
      status: "completed",
      collapsed: output_long?(output),
      call_id: Map.get(payload, "call_id")
    )
  end

  defp parse_response_item(%{"type" => "custom_tool_call", "name" => name} = payload) when is_binary(name) do
    input = Map.get(payload, "input")
    status = Map.get(payload, "status")

    entry("tool_call", name, format_tool_input(input),
      language: tool_language(name, input),
      status: normalize_status(status),
      collapsed: false,
      call_id: Map.get(payload, "call_id")
    )
  end

  defp parse_response_item(%{"type" => "custom_tool_call_output", "output" => output} = payload) when is_binary(output) do
    entry("tool_result", "Tool output", output,
      language: "text",
      status: "completed",
      collapsed: output_long?(output),
      call_id: Map.get(payload, "call_id")
    )
  end

  defp parse_response_item(%{"type" => type} = payload) when is_binary(type) do
    body =
      payload
      |> Map.drop(["type"])
      |> Enum.reject(fn {_key, value} -> is_nil(value) or value == "" or value == %{} or value == [] end)
      |> case do
        [] -> nil
        fields -> inspect(fields, pretty: true, limit: 12)
      end

    entry("event", humanize_type(type), body, collapsed: true)
  end

  defp parse_response_item(_payload), do: nil

  defp entry(kind, title, body, opts \\ []) do
    body = if is_binary(body), do: String.trim(body), else: nil

    %{
      "kind" => kind,
      "title" => title,
      "body" => if(body in [nil, ""], do: nil, else: body),
      "language" => Keyword.get(opts, :language, language_for(body)),
      "status" => Keyword.get(opts, :status),
      "collapsed" => Keyword.get(opts, :collapsed, output_long?(body)),
      "call_id" => Keyword.get(opts, :call_id)
    }
  end

  defp content_text(content) when is_list(content) do
    content
    |> Enum.map(fn
      %{"type" => "input_text", "text" => text} when is_binary(text) -> text
      %{"type" => "output_text", "text" => text} when is_binary(text) -> text
      %{"text" => text} when is_binary(text) -> text
      _ -> nil
    end)
    |> Enum.reject(&is_nil/1)
    |> Enum.join("\n\n")
    |> case do
      "" -> nil
      joined -> joined
    end
  end

  defp content_text(_content), do: nil

  defp format_tool_input(input) when is_binary(input) do
    input =
      case Jason.decode(input) do
        {:ok, decoded} -> Jason.encode!(decoded, pretty: true)
        {:error, _} -> input
      end

    String.trim(input)
  end

  defp format_tool_input(input) when is_map(input) or is_list(input), do: Jason.encode!(input, pretty: true)
  defp format_tool_input(input) when not is_nil(input), do: to_string(input)
  defp format_tool_input(_input), do: nil

  defp tool_language("exec_command", arguments) when is_binary(arguments) do
    case Jason.decode(arguments) do
      {:ok, %{"cmd" => cmd}} when is_binary(cmd) -> "bash"
      _ -> "json"
    end
  end

  defp tool_language("apply_patch", _input), do: "diff"
  defp tool_language(_name, arguments) when is_binary(arguments), do: "json"
  defp tool_language(_name, _input), do: "text"

  defp language_for(body) when is_binary(body) do
    cond do
      String.starts_with?(body, "```") -> "markdown"
      String.contains?(body, "\n## ") -> "markdown"
      true -> "text"
    end
  end

  defp language_for(_body), do: "text"

  defp normalize_status("completed"), do: "completed"
  defp normalize_status("failed"), do: "failed"
  defp normalize_status("in_progress"), do: "running"
  defp normalize_status(_status), do: nil

  defp output_long?(body) when is_binary(body), do: byte_size(body) > 700
  defp output_long?(_body), do: false

  defp humanize_type(type) when is_binary(type) do
    type
    |> String.replace("_", " ")
    |> String.split()
    |> Enum.map_join(" ", &String.capitalize/1)
  end

  defp format_turn_abort_body(payload) when is_map(payload) do
    reason = Map.get(payload, "reason") || Map.get(payload, "message")

    lines =
      [
        if(is_binary(reason) and reason != "", do: "Reason: #{reason}", else: nil),
        turn_abort_turn_id_line(payload),
        turn_abort_duration_line(payload)
      ]
      |> Enum.reject(&is_nil/1)

    case lines do
      [] -> nil
      _ -> Enum.join(lines, "\n")
    end
  end

  defp turn_abort_turn_id_line(%{"turn_id" => turn_id}) when is_binary(turn_id) and turn_id != "",
    do: "Turn: #{turn_id}"

  defp turn_abort_turn_id_line(_payload), do: nil

  defp turn_abort_duration_line(%{"duration_ms" => duration_ms}) when is_integer(duration_ms) and duration_ms > 0 do
    "Duration: #{format_duration_ms(duration_ms)}"
  end

  defp turn_abort_duration_line(_payload), do: nil

  defp format_duration_ms(duration_ms) when is_integer(duration_ms) and duration_ms >= 0 do
    total_seconds = div(duration_ms, 1000)
    hours = div(total_seconds, 3600)
    minutes = div(rem(total_seconds, 3600), 60)
    seconds = rem(total_seconds, 60)

    cond do
      hours > 0 -> "#{hours}h #{minutes}m #{seconds}s"
      minutes > 0 -> "#{minutes}m #{seconds}s"
      true -> "#{seconds}s"
    end
  end

  defp trim_display(text, max) when is_binary(text) and is_integer(max) do
    text
    |> String.replace(~r/\s+/, " ")
    |> String.trim()
    |> String.slice(0, max)
  end
end
