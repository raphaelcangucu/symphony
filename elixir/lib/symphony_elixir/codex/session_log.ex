defmodule SymphonyElixir.Codex.SessionLog do
  @moduledoc """
  Reads and formats Codex rollout JSONL session logs for live UI streaming.

  Rollout files live under `~/.codex/sessions/**/rollout-*.jsonl`. The workspace
  sidecar (`.symphony/codex-session.json`) holds the active `thread_id`.
  """

  @default_tail_bytes 65_536
  @max_line_bytes 1_048_576

  @spec resolve_rollout_path(Path.t(), keyword()) :: {:ok, Path.t()} | :error
  def resolve_rollout_path(workspace, opts \\ []) when is_binary(workspace) do
    with {:ok, thread_id} <- SymphonyElixir.Codex.Session.resolve(workspace, opts),
         {:ok, path} <- rollout_path_for_thread(thread_id, opts) do
      {:ok, path}
    else
      _ -> :error
    end
  end

  @spec tail(Path.t(), keyword()) :: {:ok, [String.t()], non_neg_integer()}
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

  @spec read_from(Path.t(), non_neg_integer()) :: {:ok, [String.t()], non_neg_integer()} | {:error, term()}
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

  @spec format_line(String.t()) :: String.t() | nil
  def format_line(line) when is_binary(line) do
    trimmed = String.trim(line)

    if trimmed == "" do
      nil
    else
      case Jason.decode(trimmed) do
        {:ok, decoded} -> format_decoded(decoded)
        {:error, _} -> trim_display(trimmed)
      end
    end
  end

  def format_line(_line), do: nil

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
            {:ok, binary} -> split_lines(binary, offset, size)
            {:error, reason} -> {:error, reason}
          end
        after
          File.close(io)
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp split_lines(binary, offset, size) when is_binary(binary) do
    lines =
      binary
      |> String.split("\n", trim: false)
      |> Enum.map(&format_line/1)
      |> Enum.reject(&is_nil/1)

    {:ok, lines, size}
  end

  defp format_decoded(%{"type" => "session_meta", "payload" => payload}) when is_map(payload) do
    cwd = Map.get(payload, "cwd") || Map.get(payload, "workspace")
    "session started cwd=#{cwd}"
  end

  defp format_decoded(%{"type" => "turn_context"}) do
    "turn context updated"
  end

  defp format_decoded(%{"type" => "event_msg", "payload" => payload}) when is_map(payload) do
    type = Map.get(payload, "type") || Map.get(payload, "event")
    message = Map.get(payload, "message") || Map.get(payload, "text")
    prefix = if is_binary(type), do: type, else: "event"

    case message do
      msg when is_binary(msg) and msg != "" -> "#{prefix}: #{trim_display(msg)}"
      _ -> prefix
    end
  end

  defp format_decoded(%{"type" => "response_item", "payload" => payload}) when is_map(payload) do
    type = Map.get(payload, "type") || "item"
    role = Map.get(payload, "role")

    summary =
      payload
      |> Map.get("content", [])
      |> content_summary()

    prefix =
      [type, role]
      |> Enum.reject(&is_nil/1)
      |> Enum.join("/")

    if summary == "" do
      prefix
    else
      "#{prefix}: #{summary}"
    end
  end

  defp format_decoded(%{"type" => type}) when is_binary(type), do: type
  defp format_decoded(_decoded), do: "log entry"

  defp content_summary(content) when is_list(content) do
    content
    |> Enum.find_value("", fn
      %{"type" => "input_text", "text" => text} when is_binary(text) -> trim_display(text)
      %{"type" => "output_text", "text" => text} when is_binary(text) -> trim_display(text)
      %{"text" => text} when is_binary(text) -> trim_display(text)
      _ -> nil
    end)
  end

  defp content_summary(_content), do: ""

  defp trim_display(text) when is_binary(text) do
    text
    |> String.replace(~r/\s+/, " ")
    |> String.trim()
    |> String.slice(0, 240)
  end
end
