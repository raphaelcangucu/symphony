defmodule SymphonyElixir.Assistant.ThreadFiles do
  @moduledoc "Sandboxed read access to source, markdown, and image files in assistant workspaces."

  alias SymphonyElixir.Assistant.{AgentSession, History}

  @max_depth 8
  @max_files 500
  @max_text_bytes 512_000
  @max_image_bytes 2_000_000
  @ignored_directories MapSet.new([".git", "_build", "build", "deps", "dist", "node_modules"])
  @image_extensions MapSet.new([".gif", ".jpeg", ".jpg", ".png", ".webp"])
  @text_extensions MapSet.new([
                     ".bash",
                     ".c",
                     ".cpp",
                     ".css",
                     ".eex",
                     ".ex",
                     ".exs",
                     ".go",
                     ".gql",
                     ".graphql",
                     ".h",
                     ".heex",
                     ".hpp",
                     ".html",
                     ".java",
                     ".js",
                     ".json",
                     ".jsx",
                     ".kt",
                     ".md",
                     ".py",
                     ".rb",
                     ".rs",
                     ".scss",
                     ".sh",
                     ".sql",
                     ".swift",
                     ".toml",
                     ".ts",
                     ".tsx",
                     ".txt",
                     ".yaml",
                     ".yml",
                     ".zsh"
                   ])
  @text_basenames MapSet.new(["Dockerfile", "LICENSE", "Makefile", "Procfile"])

  @type file_entry :: %{
          id: String.t(),
          kind: String.t(),
          name: String.t(),
          path: String.t(),
          size: non_neg_integer(),
          title: String.t(),
          updated_at: String.t() | nil
        }

  @spec list(integer()) :: %{available: boolean(), reason: String.t() | nil, files: [file_entry()]}
  def list(thread_id) when is_integer(thread_id) do
    with {:ok, thread} <- History.get_thread(thread_id),
         {:ok, workspace} <- resolve_workspace(thread),
         {:ok, %File.Stat{type: :directory}} <- File.lstat(workspace) do
      %{available: true, reason: nil, files: collect_files(workspace)}
    else
      {:error, :not_found} -> unavailable("thread_not_found")
      {:error, :workspace_not_found} -> unavailable("workspace_missing")
      {:ok, %File.Stat{}} -> unavailable("workspace_missing")
      {:error, _reason} -> unavailable("workspace_missing")
    end
  end

  @spec read(integer(), String.t()) :: {:ok, map()} | {:error, term()}
  def read(thread_id, rel_path) when is_integer(thread_id) and is_binary(rel_path) do
    with {:ok, thread} <- History.get_thread(thread_id),
         {:ok, workspace} <- resolve_workspace(thread),
         {:ok, abs} <- safe_join(workspace, rel_path),
         {:ok, kind} <- supported_kind(abs),
         {:ok, %File.Stat{type: :regular, size: size}} <- File.lstat(abs),
         :ok <- validate_size(kind, size),
         {:ok, body} <- File.read(abs),
         :ok <- validate_content(kind, body) do
      {:ok, content(abs, workspace, kind, body)}
    else
      {:error, :not_found} -> {:error, :workspace_file_not_found}
      {:error, :enoent} -> {:error, :workspace_file_not_found}
      {:ok, %File.Stat{}} -> {:error, :workspace_file_not_found}
      {:error, _reason} = error -> error
    end
  end

  defp unavailable(reason), do: %{available: false, reason: reason, files: []}

  defp resolve_workspace(%{scope: "freeform", id: thread_id, workspace_path: path})
       when is_integer(thread_id) do
    if is_binary(path) and String.trim(path) != "" and
         Path.expand(path) != Path.expand(AgentSession.freeform_workspace_root()) do
      {:ok, Path.expand(path)}
    else
      {:ok, AgentSession.freeform_workspace(thread_id)}
    end
  end

  defp resolve_workspace(%{workspace_path: path}) when is_binary(path) and path != "",
    do: {:ok, Path.expand(path)}

  defp resolve_workspace(_thread), do: {:error, :workspace_not_found}

  defp collect_files(workspace) do
    workspace
    |> Path.expand()
    |> walk_files(workspace, 0)
    |> Enum.sort_by(& &1.path)
    |> Enum.take(@max_files)
  end

  defp walk_files(current_dir, workspace, depth) when depth <= @max_depth do
    with :ok <- ensure_no_symlink_components(Path.expand(current_dir), Path.expand(workspace)),
         {:ok, entries} <- File.ls(current_dir) do
      entries
      |> Enum.sort()
      |> Enum.flat_map(fn entry ->
        path = Path.join(current_dir, entry)

        cond do
          String.starts_with?(entry, ".") ->
            []

          directory?(path) and ignored_directory?(entry) ->
            []

          depth < @max_depth and directory?(path) ->
            walk_files(path, workspace, depth + 1)

          regular_file?(path) and supported_file?(path) ->
            [to_file(path, workspace)]

          true ->
            []
        end
      end)
    else
      {:error, _reason} -> []
    end
  end

  defp walk_files(_current_dir, _workspace, _depth), do: []

  defp ignored_directory?(entry), do: MapSet.member?(@ignored_directories, entry)

  defp directory?(path) do
    match?({:ok, %File.Stat{type: :directory}}, File.lstat(path))
  end

  defp regular_file?(path) do
    match?({:ok, %File.Stat{type: :regular}}, File.lstat(path))
  end

  defp supported_file?(path), do: match?({:ok, _kind}, supported_kind(path))

  defp supported_kind(path) do
    extension = path |> Path.extname() |> String.downcase()

    cond do
      MapSet.member?(@image_extensions, extension) -> {:ok, :image}
      MapSet.member?(@text_extensions, extension) -> {:ok, text_kind(extension)}
      MapSet.member?(@text_basenames, Path.basename(path)) -> {:ok, :text}
      true -> {:error, :unsupported_workspace_file}
    end
  end

  defp text_kind(".md"), do: :markdown
  defp text_kind(_extension), do: :text

  defp to_file(abs, workspace) do
    rel = Path.relative_to(abs, Path.expand(workspace))
    {:ok, kind} = supported_kind(abs)
    {:ok, %File.Stat{size: size}} = File.stat(abs)
    name = Path.basename(abs)

    %{
      id: rel,
      kind: Atom.to_string(kind),
      name: name,
      path: rel,
      size: size,
      title: name,
      updated_at: mtime(abs)
    }
  end

  defp mtime(abs) do
    case File.stat(abs, time: :posix) do
      {:ok, %File.Stat{mtime: seconds}} -> seconds |> DateTime.from_unix!() |> DateTime.to_iso8601()
      {:error, _reason} -> nil
    end
  end

  defp validate_size(:image, size) when size <= @max_image_bytes, do: :ok
  defp validate_size(kind, size) when kind in [:markdown, :text] and size <= @max_text_bytes, do: :ok
  defp validate_size(_kind, _size), do: {:error, :workspace_file_too_large}

  defp validate_content(:image, _body), do: :ok

  defp validate_content(kind, body) when kind in [:markdown, :text] and is_binary(body) do
    if String.valid?(body), do: :ok, else: {:error, :unsupported_workspace_file}
  end

  defp content(abs, workspace, :image, body) do
    %{
      path: Path.relative_to(abs, Path.expand(workspace)),
      kind: "image",
      mime_type: mime_type(abs),
      content: nil,
      content_base64: Base.encode64(body)
    }
  end

  defp content(abs, workspace, kind, body) do
    %{
      path: Path.relative_to(abs, Path.expand(workspace)),
      kind: Atom.to_string(kind),
      mime_type: mime_type(abs),
      content: body,
      content_base64: nil
    }
  end

  defp mime_type(path) do
    case path |> Path.extname() |> String.downcase() do
      ".gif" -> "image/gif"
      ".jpeg" -> "image/jpeg"
      ".jpg" -> "image/jpeg"
      ".png" -> "image/png"
      ".webp" -> "image/webp"
      ".css" -> "text/css"
      ".html" -> "text/html"
      ".js" -> "text/javascript"
      ".json" -> "application/json"
      ".md" -> "text/markdown"
      ".tsx" -> "text/tsx"
      ".ts" -> "text/typescript"
      _extension -> "text/plain"
    end
  end

  defp safe_join(workspace, rel_path) do
    normalized_path = rel_path |> String.replace("\\", "/") |> String.trim()

    with :ok <- validate_relative_path(normalized_path) do
      expanded_workspace = Path.expand(workspace)
      candidate = Path.expand(normalized_path, expanded_workspace)

      with :ok <- ensure_inside(candidate, expanded_workspace),
           :ok <- ensure_no_symlink_components(candidate, expanded_workspace) do
        {:ok, candidate}
      end
    end
  end

  defp validate_relative_path(path) do
    segments = Path.split(path)

    cond do
      path == "" -> {:error, :invalid_workspace_file_path}
      Path.type(path) == :absolute -> {:error, :invalid_workspace_file_path}
      Enum.any?(segments, &(&1 in [".", "..", ""])) -> {:error, :invalid_workspace_file_path}
      true -> :ok
    end
  end

  defp ensure_inside(candidate, allowed) do
    if candidate != allowed and String.starts_with?(candidate, allowed <> "/") do
      :ok
    else
      {:error, :invalid_workspace_file_path}
    end
  end

  defp ensure_no_symlink_components(candidate, workspace) do
    candidate
    |> Path.relative_to(workspace)
    |> Path.split()
    |> Enum.reduce_while(workspace, fn segment, current_path ->
      next_path = Path.join(current_path, segment)

      case File.lstat(next_path) do
        {:ok, %File.Stat{type: :symlink}} ->
          {:halt, {:error, :invalid_workspace_file_path}}

        {:ok, _stat} ->
          {:cont, next_path}

        {:error, :enoent} ->
          {:halt, :ok}

        {:error, reason} ->
          {:halt, {:error, reason}}
      end
    end)
    |> case do
      :ok -> :ok
      {:error, _reason} = error -> error
      _final_path -> :ok
    end
  end
end
