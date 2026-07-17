defmodule SymphonyElixir.Claude.SessionLog do
  @moduledoc """
  Reads and parses Claude Code JSONL session logs for live UI streaming.

  Resolution prefers `<workspace>/.symphony/claude-session.jsonl` (or a sidecar
  `path`) when present, then falls back to
  `~/.claude/projects/<encoded-workspace>/` where the workspace path is encoded
  by replacing `/` with `-` and stripping the leading separator
  (e.g. `/home/foo/bar` → `-home-foo-bar`).

  The most-recently-modified external `.jsonl` file for the encoded workspace
  directory is used as fallback. Each JSONL line is one conversation event.

  Subagent layout (verified under `~/.claude/projects/`):

      <dir>/<sessionId>.jsonl
      <dir>/<sessionId>/subagents/agent-<id>.jsonl
      <dir>/<sessionId>/subagents/agent-<id>.meta.json

  Sidecar meta links to the parent's TaskCreate `tool_use` id via `toolUseId`.
  """

  @behaviour SymphonyElixir.SessionLogBackend

  alias SymphonyElixir.Agent.SessionTranscript

  @default_projects_dir "~/.claude/projects"
  @default_tail_bytes 65_536
  @id_pattern ~r/^[A-Za-z0-9-]+$/
  @label_max_chars 120

  @spec resolve_log_path(Path.t(), keyword()) :: {:ok, Path.t()} | :error
  def resolve_log_path(workspace, opts \\ []) when is_binary(workspace) do
    symphony = SessionTranscript.path(:claude, workspace)

    cond do
      File.regular?(symphony) ->
        {:ok, symphony}

      true ->
        case SessionTranscript.read_sidecar(:claude, workspace) do
          {:ok, %{"path" => path}} when is_binary(path) ->
            if File.regular?(path), do: {:ok, path}, else: resolve_external(workspace, opts)

          _ ->
            resolve_external(workspace, opts)
        end
    end
  end

  defp resolve_external(workspace, opts) do
    dir = projects_dir(opts) |> Path.join(encode_workspace(workspace))

    case File.ls(dir) do
      {:ok, files} ->
        files
        |> Enum.filter(&String.ends_with?(&1, ".jsonl"))
        |> Enum.map(&Path.join(dir, &1))
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

  @impl true
  def resolve_subagent_path(id, opts) when is_binary(id) do
    parent_path = Keyword.get(opts, :parent_path)
    tool_use_id = Keyword.get(opts, :tool_use_id)

    cond do
      not is_binary(parent_path) ->
        :error

      true ->
        case resolve_by_agent_id(parent_path, id) do
          {:ok, _} = ok ->
            ok

          :error when is_binary(tool_use_id) and tool_use_id != "" ->
            resolve_by_tool_use_id(parent_path, tool_use_id)

          :error ->
            :error
        end
    end
  end

  def resolve_subagent_path(_id, _opts), do: :error

  @impl true
  def list_subagents(parent_path, _opts) when is_binary(parent_path) do
    parent_path
    |> subagents_dir()
    |> Path.join("agent-*.jsonl")
    |> Path.wildcard()
    |> Enum.filter(&File.regular?/1)
    |> Enum.sort_by(&mtime/1, :asc)
    |> Enum.map(&subagent_entry/1)
  end

  def list_subagents(_parent_path, _opts), do: []

  @impl true
  def subagent_meta(path) when is_binary(path), do: subagent_entry(path)

  def subagent_meta(_path), do: %{}

  defp resolve_by_agent_id(parent_path, id) do
    if Regex.match?(@id_pattern, id) do
      bare_id = String.replace_prefix(id, "agent-", "")
      path = Path.join(subagents_dir(parent_path), "agent-#{bare_id}.jsonl")

      if File.regular?(path), do: {:ok, path}, else: :error
    else
      :error
    end
  end

  defp resolve_by_tool_use_id(parent_path, tool_use_id) do
    parent_path
    |> subagents_dir()
    |> Path.join("*.meta.json")
    |> Path.wildcard()
    |> Enum.find_value(:error, fn meta_path ->
      case read_meta_json(meta_path) do
        {:ok, %{"toolUseId" => ^tool_use_id}} ->
          jsonl = String.replace_suffix(meta_path, ".meta.json", ".jsonl")
          if File.regular?(jsonl), do: {:ok, jsonl}

        _ ->
          nil
      end
    end)
  end

  # Verified: children live at Path.rootname(parent_path)/subagents/
  defp subagents_dir(parent_path), do: Path.join(Path.rootname(parent_path), "subagents")

  defp subagent_entry(path) do
    bare_id =
      path
      |> Path.basename()
      |> Path.rootname(".jsonl")
      |> String.replace_prefix("agent-", "")

    sidecar = read_sidecar_meta(path)

    %{
      "id" => bare_id,
      "label" => subagent_label(path, sidecar),
      "nickname" => nil,
      "role" => Map.get(sidecar, "agentType"),
      "tool_use_id" => Map.get(sidecar, "toolUseId"),
      "path" => path
    }
  end

  defp subagent_label(path, sidecar) do
    case Map.get(sidecar, "description") do
      description when is_binary(description) and description != "" ->
        description

      _ ->
        prompt_label(path)
    end
  end

  defp read_sidecar_meta(jsonl_path) do
    meta_path = Path.rootname(jsonl_path, ".jsonl") <> ".meta.json"

    case read_meta_json(meta_path) do
      {:ok, meta} -> meta
      :error -> %{}
    end
  end

  defp read_meta_json(meta_path) do
    with true <- File.regular?(meta_path),
         {:ok, body} <- File.read(meta_path),
         {:ok, decoded} when is_map(decoded) <- Jason.decode(body) do
      {:ok, decoded}
    else
      _ -> :error
    end
  end

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

  defp prompt_text(%{"type" => "user", "message" => message}), do: message_content_text(message)
  defp prompt_text(%{"role" => "user", "message" => message}), do: message_content_text(message)
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

    # `is_error: true` marks a denied/failed tool call (e.g. a Bash command that hit a
    # permission wall). Reflect it as "failed" so the UI matches Codex/Cursor instead of
    # rendering every errored tool as "completed".
    status = if Map.get(block, "is_error") == true, do: "failed", else: "completed"

    entry("tool_result", "Tool output", output,
      language: "text",
      status: status,
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
