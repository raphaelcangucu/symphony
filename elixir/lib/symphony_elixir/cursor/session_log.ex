defmodule SymphonyElixir.Cursor.SessionLog do
  @moduledoc """
  Reads and parses Cursor Agent JSONL session logs for live UI streaming.

  Resolution prefers `<workspace>/.symphony/cursor-session.jsonl` (or a sidecar
  `path`) when present, then falls back to
  `~/.cursor/projects/<encoded-workspace>/agent-transcripts/` where the workspace
  path is encoded by replacing leading `/` and all subsequent `/` with `-`
  (e.g. `/home/foo/bar` → `home-foo-bar`, note: no leading dash unlike Claude).

  The most-recently-modified external `.jsonl` file under that directory tree is
  used as fallback. Cursor transcript lines use a `role`/`message` shape (not
  Claude's `type`/`message`), and tool calls omit stable ids — both are
  normalized before UI parsing. Symphony-owned lines may use Claude-style
  `type`/`message` which this module already accepts.

  Subagent layout (verified on disk under `~/.cursor/projects/*/agent-transcripts/`):

      <dir>/<parent-uuid>/<parent-uuid>.jsonl
      <dir>/<parent-uuid>/subagents/<child-uuid>.jsonl

  So the children directory is `Path.join(Path.dirname(parent_path), "subagents")`,
  not `Path.rootname(parent_path)/subagents`.
  """

  @behaviour SymphonyElixir.SessionLogBackend

  alias SymphonyElixir.Agent.SessionTranscript

  @default_projects_dir "~/.cursor/projects"
  @default_tail_bytes 65_536
  @id_pattern ~r/^[A-Za-z0-9-]+$/
  @label_max_chars 120

  @spec resolve_log_path(Path.t(), keyword()) :: {:ok, Path.t()} | :error
  def resolve_log_path(workspace, opts \\ []) when is_binary(workspace) do
    symphony = SessionTranscript.path(:cursor, workspace)

    cond do
      File.regular?(symphony) ->
        {:ok, symphony}

      true ->
        case SessionTranscript.read_sidecar(:cursor, workspace) do
          {:ok, %{"path" => path}} when is_binary(path) ->
            if File.regular?(path), do: {:ok, path}, else: resolve_external(workspace, opts)

          _ ->
            resolve_external(workspace, opts)
        end
    end
  end

  defp resolve_external(workspace, opts) do
    dir = projects_dir(opts) |> Path.join(encode_workspace(workspace)) |> Path.join("agent-transcripts")

    dir
    |> Path.join("**/*.jsonl")
    |> Path.wildcard()
    |> Enum.filter(&File.regular?/1)
    |> Enum.sort_by(
      fn path ->
        case File.stat(path) do
          {:ok, %File.Stat{mtime: mtime}} -> mtime
          _ -> {{1970, 1, 1}, {0, 0, 0}}
        end
      end,
      :desc
    )
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

  @impl true
  def resolve_subagent_path(id, opts) when is_binary(id) do
    parent_path = Keyword.get(opts, :parent_path)

    with true <- Regex.match?(@id_pattern, id),
         true <- is_binary(parent_path),
         path <- Path.join(subagents_dir(parent_path), "#{id}.jsonl"),
         true <- File.regular?(path) do
      {:ok, path}
    else
      _ -> :error
    end
  end

  def resolve_subagent_path(_id, _opts), do: :error

  @impl true
  def list_subagents(parent_path, _opts) when is_binary(parent_path) do
    parent_path
    |> subagents_dir()
    |> Path.join("*.jsonl")
    |> Path.wildcard()
    |> Enum.filter(&File.regular?/1)
    |> Enum.sort_by(&mtime/1, :asc)
    |> Enum.map(&subagent_meta/1)
  end

  def list_subagents(_parent_path, _opts), do: []

  @impl true
  def subagent_meta(path) when is_binary(path) do
    id = path |> Path.basename() |> Path.rootname(".jsonl")

    %{
      "id" => id,
      "label" => prompt_label(path),
      "nickname" => nil,
      "role" => nil,
      "tool_use_id" => nil,
      "path" => path
    }
  end

  def subagent_meta(_path), do: %{}

  # Verified: children live beside the parent uuid directory, not under Path.rootname(parent).
  defp subagents_dir(parent_path), do: Path.join(Path.dirname(parent_path), "subagents")

  defp prompt_label(path) do
    case read_first_json_line(path) do
      {:ok, decoded} ->
        decoded
        |> prompt_text()
        |> truncate_label()

      :error ->
        nil
    end
  end

  defp prompt_text(%{"role" => "user", "message" => message}), do: message_content_text(message)
  defp prompt_text(%{"type" => "user", "message" => message}), do: message_content_text(message)
  defp prompt_text(_decoded), do: nil

  defp message_content_text(%{"content" => content}) when is_binary(content), do: content

  defp message_content_text(%{"content" => content}) when is_list(content) do
    Enum.find_value(content, fn
      %{"type" => "text", "text" => text} when is_binary(text) and text != "" -> text
      %{"text" => text} when is_binary(text) and text != "" -> text
      _ -> nil
    end)
  end

  defp message_content_text(_message), do: nil

  defp truncate_label(nil), do: nil

  defp truncate_label(text) when is_binary(text) do
    text
    |> String.split("\n", parts: 2)
    |> List.first()
    |> String.trim()
    |> String.slice(0, @label_max_chars)
    |> case do
      "" -> nil
      label -> label
    end
  end

  defp read_first_json_line(path) do
    case File.open(path, [:read, :utf8]) do
      {:ok, io} ->
        try do
          case IO.read(io, :line) do
            line when is_binary(line) ->
              case Jason.decode(String.trim(line)) do
                {:ok, decoded} when is_map(decoded) -> {:ok, decoded}
                _ -> :error
              end

            _ ->
              :error
          end
        after
          File.close(io)
        end

      {:error, _} ->
        :error
    end
  end

  defp mtime(path) do
    case File.stat(path) do
      {:ok, %File.Stat{mtime: mtime}} -> mtime
      _ -> {{1970, 1, 1}, {0, 0, 0}}
    end
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
