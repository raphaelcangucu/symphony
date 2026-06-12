defmodule SymphonyElixir.Cursor.SessionLog do
  @moduledoc """
  Reads and parses Cursor Agent JSONL session logs for live UI streaming.

  Session files live under `~/.cursor/projects/<encoded-workspace>/agent-transcripts/`
  where the workspace path is encoded by replacing leading `/` and all subsequent `/`
  with `-` (e.g. `/home/foo/bar` → `home-foo-bar`, note: no leading dash unlike Claude).

  The most-recently-modified `.jsonl` file under that directory tree is used.
  Cursor transcript lines use a `role`/`message` shape (not Claude's `type`/`message`),
  and tool calls omit stable ids — both are normalized before UI parsing.
  """

  @default_projects_dir "~/.cursor/projects"
  @default_tail_bytes 65_536

  @spec resolve_log_path(Path.t(), keyword()) :: {:ok, Path.t()} | :error
  def resolve_log_path(workspace, opts \\ []) when is_binary(workspace) do
    dir = projects_dir(opts) |> Path.join(encode_workspace(workspace)) |> Path.join("agent-transcripts")

    dir
    |> Path.join("**/*.jsonl")
    |> Path.wildcard()
    |> Enum.filter(&File.regular?/1)
    |> Enum.sort_by(fn path ->
      case File.stat(path) do
        {:ok, %File.Stat{mtime: mtime}} -> mtime
        _ -> {{1970, 1, 1}, {0, 0, 0}}
      end
    end, :desc)
    |> case do
      [latest | _] -> {:ok, latest}
      [] -> :error
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

  @doc "Parses one Cursor JSONL line into a UI-facing entry map."
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
      {:ok, %{"role" => role, "message" => %{"content" => content}}}
      when role in ["user", "assistant"] and is_list(content) ->
        content
        |> Enum.map(&normalize_content_block/1)
        |> Enum.map(fn block ->
          claude_line = Jason.encode!(%{"type" => role, "message" => %{"content" => [block]}})
          SymphonyElixir.Claude.SessionLog.parse_line(claude_line)
        end)
        |> Enum.reject(&is_nil/1)
        |> Enum.map(&relabel_assistant/1)

      {:ok, _decoded} ->
        case SymphonyElixir.Claude.SessionLog.parse_line(line) do
          nil -> []
          entry -> [relabel_assistant(entry)]
        end

      :error ->
        []
    end
  end

  def parse_entries(_line), do: []

  @doc "Encodes a filesystem workspace path to the directory name used by Cursor."
  @spec encode_workspace(Path.t()) :: String.t()
  def encode_workspace(workspace) when is_binary(workspace) do
    workspace
    |> Path.expand()
    |> String.trim_leading("/")
    |> String.replace("/", "-")
  end

  defp projects_dir(opts) do
    Keyword.get(opts, :projects_dir) ||
      Application.get_env(:symphony_elixir, :cursor_projects_dir) ||
      Path.expand(@default_projects_dir)
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
      |> Enum.flat_map(&parse_entries/1)

    {:ok, entries, size}
  end

  defp decode_line(line) do
    trimmed = String.trim(line)

    cond do
      trimmed == "" ->
        :error

      true ->
        case Jason.decode(trimmed) do
          {:ok, decoded} -> {:ok, decoded}
          {:error, _} -> :error
        end
    end
  end

  defp normalize_content_block(%{"type" => "tool_use", "name" => name} = block) when is_binary(name) do
    id =
      Map.get(block, "id") ||
        Map.get(block, "call_id") ||
        synthetic_tool_id(name, Map.get(block, "input"))

    Map.put(block, "id", id)
  end

  defp normalize_content_block(block) when is_map(block), do: block
  defp normalize_content_block(_block), do: %{"type" => "text", "text" => ""}

  defp synthetic_tool_id(name, input) do
    payload = Jason.encode!(%{name: name, input: input})

    :crypto.hash(:sha256, payload)
    |> Base.encode16(case: :lower)
    |> String.slice(0, 12)
  end

  defp relabel_assistant(%{"kind" => "assistant"} = entry) do
    Map.put(entry, "title", "Cursor Agent")
  end

  defp relabel_assistant(entry), do: entry
end
