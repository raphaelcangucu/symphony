defmodule SymphonyElixir.OpenCode.SessionLog do
  @moduledoc """
  Reads OpenCode session events written by Symphony under
  `<workspace>/.symphony/opencode-session.jsonl`.

  Each line is NDJSON emitted by `OpenCode.CliRunner` during orchestrator runs.
  """

  @default_tail_bytes 65_536
  @log_filename "opencode-session.jsonl"

  @spec resolve_log_path(Path.t(), keyword()) :: {:ok, Path.t()} | :error
  def resolve_log_path(workspace, _opts \\ []) when is_binary(workspace) do
    path = log_path(workspace)

    if File.regular?(path), do: {:ok, path}, else: :error
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

  @spec log_path(Path.t()) :: Path.t()
  def log_path(workspace) when is_binary(workspace) do
    Path.join([Path.expand(workspace), ".symphony", @log_filename])
  end

  @spec parse_line(String.t()) :: map() | nil
  def parse_line(line) when is_binary(line) do
    line
    |> parse_entries()
    |> List.first()
  end

  def parse_line(_line), do: nil

  @spec parse_entries(String.t()) :: [map()]
  def parse_entries(line) when is_binary(line) do
    case decode_line(line) do
      {:ok, %{"type" => "text", "part" => %{"text" => text}}} when is_binary(text) ->
        claude_line = Jason.encode!(%{"type" => "assistant", "message" => %{"content" => [%{"type" => "text", "text" => text}]}})

        case SymphonyElixir.Claude.SessionLog.parse_line(claude_line) do
          nil -> []
          entry -> [relabel_assistant(entry)]
        end

      {:ok, _decoded} ->
        []

      :error ->
        []
    end
  end

  def parse_entries(_line), do: []

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
      |> Enum.flat_map(&parse_entries/1)

    {:ok, entries, size}
  end

  defp decode_line(line) do
    trimmed = String.trim(line)

    cond do
      trimmed == "" -> :error
      true -> Jason.decode(trimmed)
    end
  end

  defp relabel_assistant(%{"kind" => "assistant"} = entry) do
    Map.put(entry, "title", "OpenCode")
  end

  defp relabel_assistant(entry), do: entry
end
