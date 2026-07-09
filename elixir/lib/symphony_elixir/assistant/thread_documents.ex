defmodule SymphonyElixir.Assistant.ThreadDocuments do
  @moduledoc "Sandboxed read access to markdown files in a freeform assistant thread workspace."

  alias SymphonyElixir.Assistant.{AgentSession, History}

  @max_bytes 512_000
  @max_depth 8
  @title_scan_bytes 16_384

  @type document :: %{
          id: String.t(),
          kind: String.t(),
          path: String.t(),
          title: String.t(),
          updated_at: String.t() | nil
        }

  @spec list(integer()) :: %{available: boolean(), reason: String.t() | nil, documents: [document()]}
  def list(thread_id) when is_integer(thread_id) do
    with {:ok, thread} <- History.get_thread(thread_id),
         workspace <- resolve_workspace(thread) do
      case File.lstat(workspace) do
        {:ok, %File.Stat{type: :directory}} ->
          %{available: true, reason: nil, documents: collect_markdown(workspace)}

        {:ok, %File.Stat{}} ->
          %{available: false, reason: "workspace_missing", documents: []}

        {:error, _reason} ->
          %{available: false, reason: "workspace_missing", documents: []}
      end
    else
      {:error, :not_found} ->
        %{available: false, reason: "thread_not_found", documents: []}
    end
  end

  @spec read(integer(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def read(thread_id, rel_path) when is_integer(thread_id) and is_binary(rel_path) do
    with {:ok, thread} <- History.get_thread(thread_id),
         workspace <- resolve_workspace(thread),
         {:ok, abs} <- safe_join(workspace, rel_path),
         {:ok, %File.Stat{size: size}} when size <= @max_bytes <- File.stat(abs),
         {:ok, body} <- File.read(abs) do
      {:ok, body}
    else
      {:error, :not_found} -> {:error, :not_found}
      {:ok, %File.Stat{}} -> {:error, :too_large}
      {:error, :enoent} -> {:error, :not_found}
      {:error, _reason} = error -> error
    end
  end

  defp resolve_workspace(%{scope: "freeform", id: thread_id, workspace_path: path})
       when is_integer(thread_id) do
    # Never walk the shared freeform root: early threads were created with the
    # parent `assistant/freeform` directory as a placeholder workspace_path, which
    # would surface every sibling thread's drafts here. Always scope to the
    # per-thread directory in that case so reads match where turns actually write.
    cond do
      is_binary(path) and path != "" and not shared_freeform_root?(path) and File.dir?(path) ->
        Path.expand(path)

      true ->
        AgentSession.freeform_workspace(thread_id)
    end
  end

  defp resolve_workspace(%{id: thread_id}) when is_integer(thread_id) do
    AgentSession.freeform_workspace(thread_id)
  end

  defp shared_freeform_root?(path) do
    Path.expand(path) == Path.expand(AgentSession.freeform_workspace_root())
  end

  defp collect_markdown(workspace) do
    workspace
    |> Path.expand()
    |> walk_markdown(workspace, 0)
    |> Enum.sort_by(& &1.path)
  end

  defp walk_markdown(current_dir, workspace, depth) when depth <= @max_depth do
    with :ok <- ensure_no_symlink_components(Path.expand(current_dir), Path.expand(workspace)),
         {:ok, entries} <- File.ls(current_dir) do
      entries
      |> Enum.sort()
      |> Enum.flat_map(fn entry ->
        path = Path.join(current_dir, entry)

        cond do
          String.starts_with?(entry, ".") ->
            []

          markdown_file?(path) ->
            [to_document(path, workspace)]

          depth < @max_depth and directory?(path) ->
            walk_markdown(path, workspace, depth + 1)

          true ->
            []
        end
      end)
    else
      {:error, _reason} -> []
    end
  end

  defp walk_markdown(_current_dir, _workspace, _depth), do: []

  defp markdown_file?(path) do
    regular_file?(path) and Path.extname(path) == ".md"
  end

  defp directory?(path) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :directory}} -> true
      _ -> false
    end
  end

  defp regular_file?(path) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :regular}} -> true
      _ -> false
    end
  end

  defp to_document(abs, workspace) do
    rel = Path.relative_to(abs, Path.expand(workspace))

    %{
      id: rel,
      kind: "draft",
      path: rel,
      title: title_from(abs),
      updated_at: mtime(abs)
    }
  end

  defp title_from(abs) do
    case File.open(abs, [:read, :binary], &IO.binread(&1, @title_scan_bytes)) do
      {:ok, body} when is_binary(body) ->
        body
        |> :binary.split("\n", [:global])
        |> Enum.find_value(fn line ->
          if String.valid?(line) do
            case Regex.run(~r/^#\s+(.+)$/, String.trim(line)) do
              [_, title] -> String.trim(title)
              _ -> nil
            end
          end
        end) || Path.basename(abs)

      {:error, _reason} ->
        Path.basename(abs)

      _other ->
        Path.basename(abs)
    end
  end

  defp mtime(abs) do
    case File.stat(abs, time: :posix) do
      {:ok, %File.Stat{mtime: seconds}} ->
        seconds
        |> DateTime.from_unix!()
        |> DateTime.to_iso8601()

      {:error, _reason} ->
        nil
    end
  end

  defp safe_join(workspace, rel_path) do
    normalized_path =
      rel_path
      |> String.replace("\\", "/")
      |> String.trim()

    with :ok <- validate_relative_markdown_path(normalized_path) do
      expanded_workspace = Path.expand(workspace)
      candidate = Path.expand(normalized_path, expanded_workspace)

      with :ok <- ensure_inside(candidate, expanded_workspace),
           :ok <- ensure_no_symlink_components(candidate, expanded_workspace) do
        {:ok, candidate}
      end
    end
  end

  defp validate_relative_markdown_path(path) do
    cond do
      path == "" -> {:error, :invalid_path}
      Path.type(path) == :absolute -> {:error, :invalid_path}
      Path.extname(path) != ".md" -> {:error, :invalid_path}
      true -> :ok
    end
  end

  defp ensure_inside(candidate, allowed) do
    if candidate == allowed or String.starts_with?(candidate, allowed <> "/") do
      :ok
    else
      {:error, :invalid_path}
    end
  end

  defp ensure_no_symlink_components(candidate, workspace) do
    candidate
    |> Path.relative_to(workspace)
    |> Path.split()
    |> Enum.reduce_while(workspace, fn segment, current_path ->
      next_path = Path.join(current_path, segment)

      case File.lstat(next_path) do
        {:ok, %File.Stat{type: :symlink}} -> {:halt, {:error, :invalid_path}}
        {:ok, _stat} -> {:cont, next_path}
        {:error, :enoent} -> {:halt, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      :ok -> :ok
      {:error, _reason} = error -> error
      _final_path -> :ok
    end
  end
end
