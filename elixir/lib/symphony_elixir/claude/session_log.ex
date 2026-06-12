defmodule SymphonyElixir.Claude.SessionLog do
  @moduledoc """
  Reads and parses Claude Code JSONL session logs for live UI streaming.

  Session files live under `~/.claude/projects/<encoded-workspace>/` where the
  workspace path is encoded by replacing `/` with `-` and stripping the leading
  separator (e.g. `/home/foo/bar` → `-home-foo-bar`).

  The most-recently-modified `.jsonl` file for the encoded workspace directory
  is used when no sidecar is present. Each JSONL line is one conversation event.
  """

  @default_projects_dir "~/.claude/projects"
  @default_tail_bytes 65_536

  @spec resolve_log_path(Path.t(), keyword()) :: {:ok, Path.t()} | :error
  def resolve_log_path(workspace, opts \\ []) when is_binary(workspace) do
    dir = projects_dir(opts) |> Path.join(encode_workspace(workspace))

    case File.ls(dir) do
      {:ok, files} ->
        files
        |> Enum.filter(&String.ends_with?(&1, ".jsonl"))
        |> Enum.map(&Path.join(dir, &1))
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

      {:error, _} ->
        :error
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

  @doc "Parses one Claude JSONL line into a UI-facing entry map."
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

  @doc "Encodes a filesystem workspace path to the directory name used by Claude."
  @spec encode_workspace(Path.t()) :: String.t()
  def encode_workspace(workspace) when is_binary(workspace) do
    workspace
    |> Path.expand()
    |> String.replace("/", "-")
  end

  defp projects_dir(opts) do
    Keyword.get(opts, :projects_dir) ||
      Application.get_env(:symphony_elixir, :claude_projects_dir) ||
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
      |> Enum.map(&parse_line/1)
      |> Enum.reject(&is_nil/1)

    {:ok, entries, size}
  end

  # Claude JSONL top-level types: assistant, user, queue-operation, summary
  defp parse_decoded(%{"type" => "assistant", "message" => message}) when is_map(message) do
    parse_assistant_message(message)
  end

  defp parse_decoded(%{"type" => "user", "message" => message}) when is_map(message) do
    parse_user_message(message)
  end

  defp parse_decoded(%{"type" => "queue-operation"}) do
    entry("event", "Queue operation", nil, collapsed: true)
  end

  defp parse_decoded(%{"type" => "summary", "summary" => summary}) when is_binary(summary) do
    entry("meta", "Summary", summary, collapsed: true)
  end

  defp parse_decoded(%{"type" => type}) when is_binary(type) do
    entry("event", humanize_type(type), nil, collapsed: true)
  end

  defp parse_decoded(_decoded), do: nil

  defp parse_assistant_message(%{"content" => content}) when is_list(content) do
    content
    |> Enum.map(&parse_content_block/1)
    |> Enum.reject(&is_nil/1)
    |> case do
      [single] -> single
      [first | _] -> first
      [] -> nil
    end
  end

  defp parse_assistant_message(_message), do: nil

  defp parse_user_message(%{"content" => content}) when is_list(content) do
    content
    |> Enum.map(&parse_content_block/1)
    |> Enum.reject(&is_nil/1)
    |> case do
      [single] -> single
      [first | _] -> first
      [] -> nil
    end
  end

  defp parse_user_message(%{"content" => content}) when is_binary(content) and content != "" do
    entry("user", "You", content, collapsed: byte_size(content) > 2_000)
  end

  defp parse_user_message(_message), do: nil

  defp parse_content_block(%{"type" => "text", "text" => text}) when is_binary(text) and text != "" do
    entry("assistant", "Claude Code", text, language: "markdown", collapsed: false)
  end

  defp parse_content_block(%{"type" => "thinking", "thinking" => thinking}) when is_binary(thinking) do
    entry("reasoning", "Reasoning", thinking, collapsed: true)
  end

  defp parse_content_block(%{"type" => "tool_use", "id" => id, "name" => name} = block) when is_binary(name) do
    input = Map.get(block, "input")

    entry("tool_call", name, format_tool_input(input),
      language: tool_language(name, input),
      status: "running",
      collapsed: false,
      call_id: id
    )
  end

  defp parse_content_block(%{"type" => "tool_result", "tool_use_id" => tool_use_id} = block) do
    output = extract_tool_result_content(Map.get(block, "content"))

    entry("tool_result", "Tool output", output,
      language: "text",
      status: "completed",
      collapsed: output_long?(output),
      call_id: tool_use_id
    )
  end

  defp parse_content_block(_block), do: nil

  defp extract_tool_result_content(content) when is_list(content) do
    content
    |> Enum.map(fn
      %{"type" => "text", "text" => text} when is_binary(text) -> text
      %{"text" => text} when is_binary(text) -> text
      _ -> nil
    end)
    |> Enum.reject(&is_nil/1)
    |> Enum.join("\n")
    |> case do
      "" -> nil
      text -> text
    end
  end

  defp extract_tool_result_content(content) when is_binary(content), do: content
  defp extract_tool_result_content(_content), do: nil

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

  defp tool_language("Bash", _input), do: "bash"
  defp tool_language("bash", _input), do: "bash"
  defp tool_language("Write", _input), do: "text"
  defp tool_language("Edit", _input), do: "diff"
  defp tool_language(_name, input) when is_map(input), do: "json"
  defp tool_language(_name, _input), do: "text"

  defp entry(kind, title, body, opts) do
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

  defp language_for(body) when is_binary(body) do
    cond do
      String.starts_with?(body, "```") -> "markdown"
      String.contains?(body, "\n## ") -> "markdown"
      true -> "text"
    end
  end

  defp language_for(_body), do: "text"

  defp output_long?(body) when is_binary(body), do: byte_size(body) > 700
  defp output_long?(_body), do: false

  defp humanize_type(type) when is_binary(type) do
    type
    |> String.replace("_", " ")
    |> String.replace("-", " ")
    |> String.split()
    |> Enum.map_join(" ", &String.capitalize/1)
  end
end
