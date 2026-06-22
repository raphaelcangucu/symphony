defmodule SymphonyElixir.Assistant.IssueDocuments do
  @moduledoc "Sandboxed read access to docs/superpowers/* inside an issue working tree."

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.LocalTracker.{Context, Project, Repository}
  alias SymphonyElixir.{Repo, Workspace}

  @doc_root "docs/superpowers"
  @kind_dirs [{"specs", "spec"}, {"plans", "plan"}]
  @max_bytes 512_000
  @title_scan_bytes 16_384

  @type document :: %{
          id: String.t(),
          kind: String.t(),
          path: String.t(),
          title: String.t(),
          updated_at: String.t() | nil
        }

  @spec list(String.t()) :: %{available: boolean(), reason: String.t() | nil, documents: [document()]}
  def list(identifier) when is_binary(identifier) do
    collect_documents(identifier, &filter_referenced_documents(&1, identifier))
  end

  # Lists every doc under the issue working tree, bypassing the viewer's
  # referenced-document filter. Change detection (doc fingerprinting) needs the
  # full set: a turn that writes a brand-new, not-yet-referenced doc must still
  # register as a change so the UI gets told to refresh.
  @spec list_all(String.t()) :: %{available: boolean(), reason: String.t() | nil, documents: [document()]}
  def list_all(identifier) when is_binary(identifier) do
    collect_documents(identifier, &Function.identity/1)
  end

  defp collect_documents(identifier, filter) when is_function(filter, 1) do
    case resolve_document_workspace(identifier) do
      {:ok, workspace, base} ->
        documents =
          base
          |> collect(workspace)
          |> Kernel.++(handoff(base))
          |> filter.()

        %{available: true, reason: nil, documents: documents}

      {:error, _reason} ->
        %{available: false, reason: "workspace_missing", documents: []}
    end
  end

  @spec read(String.t(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def read(identifier, rel_path) when is_binary(identifier) and is_binary(rel_path) do
    with {:ok, workspace, _base} <- resolve_document_workspace(identifier),
         {:ok, abs} <- safe_join(workspace, rel_path),
         {:ok, %File.Stat{size: size}} when size <= @max_bytes <- File.stat(abs),
         {:ok, body} <- File.read(abs) do
      {:ok, body}
    else
      {:ok, %File.Stat{}} -> {:error, :too_large}
      {:error, :enoent} -> {:error, :not_found}
      {:error, _reason} = error -> error
    end
  end

  # The active issue thread records the working tree where docs were written. Prefer it so the
  # viewer keeps finding docs even if the path computation later changes; fall back to the
  # computed path when no thread exists yet (first turn) or persistence is unavailable.
  #
  # Always expand the resolved path: persisted thread workspace paths (and older configs) can
  # contain a literal `~`, which `File.*` operations never resolve to the home directory. An
  # unexpanded tilde makes reads land on a stray `~/...` tree instead of the real workspace, so
  # the viewer reports `workspace_missing` even though the documents exist on disk.
  defp resolve_workspace(identifier) do
    case issue_context(identifier) do
      %{workspace_path: path} when is_binary(path) and path != "" -> Path.expand(path)
      _ -> Path.expand(Workspace.path_for_issue(identifier))
    end
  end

  defp resolve_document_workspace(identifier) do
    root = resolve_workspace(identifier)

    identifier
    |> candidate_workspaces(root)
    |> Enum.find_value(fn workspace ->
      base = Path.join(workspace, @doc_root)

      case safe_directory(base, workspace) do
        :ok -> {:ok, workspace, base}
        {:error, _reason} -> nil
      end
    end)
    |> case do
      {:ok, _workspace, _base} = ok -> ok
      nil -> {:error, :workspace_missing}
    end
  end

  defp candidate_workspaces(identifier, root) do
    [root | repository_workspaces(identifier, root)]
    |> Enum.map(&Path.expand/1)
    |> Enum.uniq()
  end

  defp repository_workspaces(identifier, root) do
    identifier
    |> project_slug()
    |> case do
      slug when is_binary(slug) and slug != "" ->
        slug
        |> repositories_for_project()
        |> Enum.map(&Path.join(root, &1.workspace_path))
        |> Enum.filter(&safe_child_directory?(&1, root))

      _ ->
        []
    end
  end

  defp project_slug(identifier) do
    case issue_context(identifier) do
      %{project_slug: slug} when is_binary(slug) and slug != "" -> slug
      _ -> Context.find_project_slug(identifier)
    end
  end

  defp issue_context(identifier) do
    case History.issue_workspace_context(identifier) do
      %{workspace_path: _path} = context -> context
      _ -> nil
    end
  end

  defp repositories_for_project(slug) do
    case Repo.get_by(Project, slug: slug) do
      %Project{} = project ->
        project
        |> Repo.preload(:repositories)
        |> Map.fetch!(:repositories)
        |> Enum.sort_by(&repository_sort_key/1)

      _ ->
        []
    end
  rescue
    _error -> []
  catch
    :exit, _reason -> []
  end

  defp repository_sort_key(%Repository{role: "primary", workspace_path: path}), do: {0, path}
  defp repository_sort_key(%Repository{workspace_path: path}), do: {1, path}

  defp safe_child_directory?(candidate, root) do
    candidate = Path.expand(candidate)
    root = Path.expand(root)

    with :ok <- ensure_inside(candidate, root),
         :ok <- ensure_no_symlink_components(candidate, root),
         {:ok, %File.Stat{type: :directory}} <- File.lstat(candidate) do
      true
    else
      _ -> false
    end
  end

  defp collect(base, workspace) do
    Enum.flat_map(@kind_dirs, fn {dir, kind} ->
      base
      |> Path.join(dir)
      |> list_markdown(workspace)
      |> Enum.map(&to_document(&1, kind, Path.join([@doc_root, dir, Path.basename(&1)])))
    end)
  end

  defp filter_referenced_documents(documents, identifier) do
    case issue_context(identifier) do
      %{thread_id: thread_id} when is_integer(thread_id) ->
        %{paths: referenced_paths, basenames: referenced_basenames} = referenced_documents(thread_id)
        issue_token = issue_filename_token(identifier)

        Enum.filter(documents, fn document ->
          MapSet.member?(referenced_paths, document.path) or
            MapSet.member?(referenced_basenames, Path.basename(document.path)) or
            filename_matches_issue?(document.path, issue_token)
        end)

      _ ->
        documents
    end
  end

  defp referenced_documents(thread_id) when is_integer(thread_id) do
    references =
      thread_id
      |> History.list_messages_for_thread()
      |> Enum.flat_map(&extract_document_references(&1.content))

    %{
      paths: references |> Enum.filter(&String.starts_with?(&1, @doc_root <> "/")) |> MapSet.new(),
      basenames: references |> Enum.map(&Path.basename/1) |> MapSet.new()
    }
  rescue
    _error -> %{paths: MapSet.new(), basenames: MapSet.new()}
  catch
    :exit, _reason -> %{paths: MapSet.new(), basenames: MapSet.new()}
  end

  defp extract_document_references(content) when is_binary(content) do
    ~r/(?:docs\/superpowers\/(?:(?:specs|plans)\/[A-Za-z0-9._\/-]+\.md|handoff\.md)|[A-Za-z0-9._-]+\.md)/
    |> Regex.scan(content)
    |> Enum.map(fn [reference] -> reference end)
  end

  defp extract_document_references(_content), do: []

  defp issue_filename_token(identifier) when is_binary(identifier) do
    identifier
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9]+/, "-")
    |> String.trim("-")
  end

  defp issue_filename_token(_identifier), do: ""

  defp filename_matches_issue?(_path, ""), do: false

  defp filename_matches_issue?(path, issue_token) do
    path
    |> Path.basename()
    |> String.downcase()
    |> String.contains?(issue_token)
  end

  defp handoff(base) do
    path = Path.join(base, "handoff.md")

    if regular_file?(path) do
      [to_document(path, "handoff", Path.join(@doc_root, "handoff.md"))]
    else
      []
    end
  end

  defp list_markdown(dir, workspace) do
    with :ok <- safe_directory(dir, workspace),
         {:ok, entries} <- File.ls(dir) do
      entries
      |> Enum.filter(&String.ends_with?(&1, ".md"))
      |> Enum.map(&Path.join(dir, &1))
      |> Enum.filter(&regular_file?/1)
      |> Enum.sort()
    else
      {:error, _reason} -> []
    end
  end

  defp regular_file?(path) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :regular}} -> true
      _ -> false
    end
  end

  defp to_document(abs, kind, rel) do
    %{id: rel, kind: kind, path: rel, title: title_from(abs), updated_at: mtime(abs)}
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
      allowed = Path.expand(@doc_root, expanded_workspace)
      candidate = Path.expand(normalized_path, expanded_workspace)

      with :ok <- ensure_inside(candidate, allowed),
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

  defp safe_directory(dir, workspace) do
    with :ok <- ensure_no_symlink_components(Path.expand(dir), Path.expand(workspace)),
         {:ok, %File.Stat{type: :directory}} <- File.lstat(dir) do
      :ok
    else
      {:ok, %File.Stat{}} -> {:error, :not_directory}
      {:error, _reason} = error -> error
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

  defp ensure_inside(candidate, allowed) do
    if candidate == allowed or String.starts_with?(candidate, allowed <> "/") do
      :ok
    else
      {:error, :invalid_path}
    end
  end
end
