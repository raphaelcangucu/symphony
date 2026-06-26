defmodule SymphonyElixir.KnowledgeBase.Paths do
  @moduledoc """
  Path resolution and validation for the Git-backed knowledge base.

  Knowledge base files live under a repository checkout's `docs/` directory:

      <workspace_root>/<project_slug>/<repo.workspace_path>/docs/<relative_path>

  Repositories are addressed in URLs by a reversible `repo_slug`. A workspace
  path may contain `/`, which a single route segment cannot hold, so `/` is
  encoded as `~` - a character the repository changeset forbids in
  `workspace_path` - keeping the mapping lossless and collision-free.
  """

  alias SymphonyElixir.Config

  @docs_dir "docs"
  @separator_encoding "~"
  @segment_regex ~r/^[a-zA-Z0-9._-]+$/

  @user_scope "@user"
  @general_repo_slug "@user~symphony-kb"

  @spec user_scope() :: String.t()
  def user_scope, do: @user_scope

  @spec general_repo_slug() :: String.t()
  def general_repo_slug, do: @general_repo_slug

  @spec general_kb_checkout() :: Path.t()
  def general_kb_checkout, do: Path.join(Config.workspace_root(), ".symphony-kb")

  @spec repo_slug(String.t()) :: String.t()
  def repo_slug(workspace_path) when is_binary(workspace_path),
    do: String.replace(workspace_path, "/", @separator_encoding)

  @spec workspace_path_from_slug(String.t()) :: String.t()
  def workspace_path_from_slug(repo_slug) when is_binary(repo_slug),
    do: String.replace(repo_slug, @separator_encoding, "/")

  @spec repo_checkout(String.t(), String.t()) :: Path.t()
  def repo_checkout(project_slug, workspace_path)
      when is_binary(project_slug) and is_binary(workspace_path) do
    Config.workspace_root()
    |> Path.expand()
    |> Path.join(project_slug)
    |> Path.join(workspace_path)
  end

  @spec docs_root(String.t(), String.t()) :: Path.t()
  def docs_root(project_slug, workspace_path),
    do: repo_checkout(project_slug, workspace_path) |> Path.join(@docs_dir)

  @spec docs_root_in(Path.t()) :: Path.t()
  def docs_root_in(base) when is_binary(base), do: Path.join(base, @docs_dir)

  @spec safe_relative_path([String.t()] | String.t()) ::
          {:ok, String.t()} | {:error, :kb_invalid_path}
  def safe_relative_path(segments) when is_list(segments) do
    cond do
      segments == [] -> {:error, :kb_invalid_path}
      Enum.any?(segments, &unsafe_segment?/1) -> {:error, :kb_invalid_path}
      not String.ends_with?(List.last(segments), ".md") -> {:error, :kb_invalid_path}
      true -> {:ok, Enum.join(segments, "/")}
    end
  end

  def safe_relative_path(path) when is_binary(path),
    do: path |> String.split("/", trim: false) |> safe_relative_path()

  @spec resolve_page_in(Path.t(), [String.t()] | String.t()) ::
          {:ok, Path.t()} | {:error, :kb_invalid_path}
  def resolve_page_in(docs_root, segments) when is_binary(docs_root) do
    with {:ok, rel} <- safe_relative_path(segments) do
      root = Path.expand(docs_root)
      full = root |> Path.join(rel) |> Path.expand()

      if full == root or String.starts_with?(full, root <> "/") do
        {:ok, full}
      else
        {:error, :kb_invalid_path}
      end
    end
  end

  @spec resolve_page(String.t(), String.t(), [String.t()] | String.t()) ::
          {:ok, Path.t()} | {:error, :kb_invalid_path}
  def resolve_page(project_slug, workspace_path, segments),
    do: resolve_page_in(docs_root(project_slug, workspace_path), segments)

  @spec safe_asset_relative_path([String.t()] | String.t()) ::
          {:ok, String.t()} | {:error, :kb_invalid_path}
  def safe_asset_relative_path(segments) when is_list(segments) do
    cond do
      segments == [] ->
        {:error, :kb_invalid_path}

      Enum.any?(segments, &unsafe_segment?/1) ->
        {:error, :kb_invalid_path}

      sensitive_asset_path?(segments) ->
        {:error, :kb_invalid_path}

      true ->
        {:ok, Enum.join(segments, "/")}
    end
  end

  def safe_asset_relative_path(path) when is_binary(path),
    do: path |> String.split("/", trim: false) |> safe_asset_relative_path()

  @spec safe_folder_relative_path([String.t()] | String.t()) ::
          {:ok, String.t()} | {:error, :kb_invalid_path}
  def safe_folder_relative_path(segments) when is_list(segments) do
    cond do
      segments == [] -> {:error, :kb_invalid_path}
      Enum.any?(segments, &unsafe_segment?/1) -> {:error, :kb_invalid_path}
      true -> {:ok, Enum.join(segments, "/")}
    end
  end

  def safe_folder_relative_path(path) when is_binary(path),
    do: path |> String.split("/", trim: false) |> safe_folder_relative_path()

  @spec resolve_folder_in(Path.t(), [String.t()] | String.t()) ::
          {:ok, Path.t()} | {:error, :kb_invalid_path}
  def resolve_folder_in(docs_root, segments) when is_binary(docs_root) do
    with {:ok, rel} <- safe_folder_relative_path(segments) do
      root = Path.expand(docs_root)
      full = root |> Path.join(rel) |> Path.expand()

      # A folder must live strictly under docs/ - deleting the docs root itself is rejected.
      if String.starts_with?(full, root <> "/") do
        {:ok, full}
      else
        {:error, :kb_invalid_path}
      end
    end
  end

  @spec resolve_asset_in(Path.t(), [String.t()] | String.t()) ::
          {:ok, Path.t()} | {:error, :kb_invalid_path}
  def resolve_asset_in(docs_root, segments) when is_binary(docs_root) do
    with {:ok, rel} <- safe_asset_relative_path(segments) do
      root = Path.expand(docs_root)
      full = root |> Path.join(rel) |> Path.expand()

      if full == root or String.starts_with?(full, root <> "/") do
        {:ok, full}
      else
        {:error, :kb_invalid_path}
      end
    end
  end

  defp unsafe_segment?(segment) do
    segment in ["", ".", ".."] or
      String.contains?(segment, "\0") or
      not Regex.match?(@segment_regex, segment)
  end

  # Project files are served from the repository worktree, but the git internals
  # and secret dotfiles must never be exposed - not even to authenticated
  # operators who can read the rest of the tree.
  defp sensitive_asset_path?(segments) do
    Enum.any?(segments, &(&1 == ".git")) or secret_dotfile?(List.last(segments))
  end

  defp secret_dotfile?(name) when is_binary(name),
    do: name == ".env" or String.starts_with?(name, ".env.")

  defp secret_dotfile?(_), do: false
end
