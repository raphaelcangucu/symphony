defmodule SymphonyElixir.KnowledgeBase do
  @moduledoc """
  Public read API for the Git-backed knowledge base.

  A project's knowledge base is a composition of per-repository `docs/` trees.
  Every page is addressed by `(repository, path-within-docs)`; there is no shared
  file root across repositories.
  """

  alias SymphonyElixir.KnowledgeBase.{
    GeneralKb,
    Indexer,
    MarkdownPage,
    Paths,
    RepoDocs,
    Search,
    SyncState,
    SyncSupervisor,
    SyncWorker,
    Tree,
    Workspace,
    Writer
  }

  alias SymphonyElixir.LocalTracker.Broadcaster
  alias SymphonyElixir.LocalTracker.Context

  @user_scope "@user"

  @type error ::
          :project_not_found
          | :repo_not_found
          | :repo_not_checked_out
          | :kb_invalid_path
          | :kb_page_not_found
          | :kb_frontmatter_invalid
          | :kb_unsupported_asset
          | :kb_asset_too_large
          | :kb_git_dirty
          | :kb_not_connected
          | {:kb_commit_failed, term()}
          | {:kb_search_failed, term()}
          | {:kb_repo_create_failed, term()}
          | {:kb_clone_failed, term()}

  @spec project_overview(String.t()) :: {:ok, map()} | {:error, :project_not_found}
  def project_overview(project_slug) when is_binary(project_slug) do
    with {:ok, project} <- Context.get_project(project_slug) do
      {:ok,
       %{
         project: %{slug: project.slug, name: project.name},
         repositories: RepoDocs.list_repositories(project_slug)
       }}
    end
  end

  @spec repo_tree(String.t(), String.t()) :: {:ok, map()} | {:error, error()}
  def repo_tree(project_slug, repo_slug) when is_binary(project_slug) and is_binary(repo_slug) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, repo} <- RepoDocs.fetch_repository(project_slug, repo_slug),
         {:ok, docs_root} <- ensure_docs_root(project_slug, repo) do
      {:ok,
       %{
         repository: repo_summary(repo),
         docs_present: File.dir?(docs_root),
         tree: Tree.build(docs_root)
       }}
    end
  end

  @spec read_page(String.t(), String.t(), [String.t()] | String.t()) ::
          {:ok, map()} | {:error, error()}
  def read_page(project_slug, repo_slug, rel)
      when is_binary(project_slug) and is_binary(repo_slug) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, repo} <- RepoDocs.fetch_repository(project_slug, repo_slug),
         {:ok, docs_root} <- ensure_docs_root(project_slug, repo),
         {:ok, abs} <- Paths.resolve_page_in(docs_root, rel),
         :ok <- ensure_regular_file(abs),
         {:ok, content} <- read_file(abs),
         {:ok, page} <- MarkdownPage.parse(content, default_title: default_title(rel)) do
      {:ok,
       %{
         repo_slug: Paths.repo_slug(repo.workspace_path),
         path: normalize_rel(rel),
         title: page.title,
         frontmatter: page.frontmatter,
         body: page.body,
         content: content
       }}
    end
  end

  @spec write_page(
          String.t(),
          String.t(),
          [String.t()] | String.t(),
          %{frontmatter: map(), body: String.t()}
        ) :: {:ok, map()} | {:error, error()}
  def write_page(project_slug, repo_slug, rel, page) do
    with {:ok, ws} <- ensure_workspace(project_slug, repo_slug),
         {:ok, result} <- Writer.write_page(ws, rel, page, push: true) do
      index_path(project_slug, repo_slug, ws, result.path)
      Broadcaster.kb_event(project_slug, "kb_page_saved", %{repo_slug: repo_slug, path: result.path})
      {:ok, result}
    end
  end

  @spec move_page(String.t(), String.t(), [String.t()] | String.t(), [String.t()] | String.t()) ::
          {:ok, map()} | {:error, error()}
  def move_page(project_slug, repo_slug, from, to) do
    with {:ok, ws} <- ensure_workspace(project_slug, repo_slug),
         {:ok, result} <- Writer.move_page(ws, from, to, push: true) do
      Indexer.remove_page(project_slug, repo_slug, result.from)
      index_path(project_slug, repo_slug, ws, result.path)

      Broadcaster.kb_event(project_slug, "kb_page_moved", %{
        repo_slug: repo_slug,
        from: result.from,
        path: result.path
      })

      {:ok, result}
    end
  end

  @spec delete_page(String.t(), String.t(), [String.t()] | String.t()) ::
          {:ok, map()} | {:error, error()}
  def delete_page(project_slug, repo_slug, rel) do
    with {:ok, ws} <- ensure_workspace(project_slug, repo_slug),
         {:ok, result} <- Writer.delete_page(ws, rel, push: true) do
      Indexer.remove_page(project_slug, repo_slug, result.path)

      Broadcaster.kb_event(project_slug, "kb_page_deleted", %{
        repo_slug: repo_slug,
        path: result.path
      })

      {:ok, result}
    end
  end

  @spec store_asset(String.t(), String.t(), String.t(), binary(), keyword()) ::
          {:ok, map()} | {:error, error()}
  def store_asset(project_slug, repo_slug, filename, bytes, opts \\ []) do
    with {:ok, ws} <- ensure_workspace(project_slug, repo_slug) do
      Writer.store_asset(ws, filename, bytes, Keyword.put(opts, :push, true))
    end
  end

  @spec rename_asset(String.t(), String.t(), String.t(), String.t()) ::
          {:ok, map()} | {:error, error()}
  def rename_asset(project_slug, repo_slug, from, name)
      when is_binary(from) and is_binary(name) do
    with {:ok, ws} <- ensure_workspace(project_slug, repo_slug),
         {:ok, result} <- Writer.rename_asset(ws, from, name, push: true) do
      Enum.each(result.pages, &index_path(project_slug, repo_slug, ws, &1))

      Broadcaster.kb_event(project_slug, "kb_asset_renamed", %{
        repo_slug: repo_slug,
        from: result.from,
        path: result.asset_path
      })

      {:ok, result}
    end
  end

  @spec delete_asset(String.t(), String.t(), [String.t()] | String.t()) ::
          {:ok, map()} | {:error, error()}
  def delete_asset(project_slug, repo_slug, rel) do
    with {:ok, ws} <- ensure_workspace(project_slug, repo_slug),
         {:ok, result} <- Writer.delete_asset(ws, rel, push: true) do
      Broadcaster.kb_event(project_slug, "kb_asset_deleted", %{
        repo_slug: repo_slug,
        path: result.path
      })

      {:ok, result}
    end
  end

  @spec read_asset(String.t(), String.t(), [String.t()] | String.t()) ::
          {:ok, binary(), String.t()} | {:error, error()}
  def read_asset(project_slug, repo_slug, rel)
      when is_binary(project_slug) and is_binary(repo_slug) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, repo} <- RepoDocs.fetch_repository(project_slug, repo_slug),
         {:ok, docs_root} <- ensure_docs_root(project_slug, repo),
         {:ok, abs} <- Paths.resolve_asset_in(docs_root, rel),
         :ok <- ensure_regular_file(abs),
         {:ok, bytes} <- read_file(abs) do
      {:ok, bytes, asset_content_type(abs)}
    end
  end

  @spec search_project(String.t(), String.t(), keyword()) ::
          {:ok, [map()]} | {:error, error()}
  def search_project(project_slug, query, opts \\ []) when is_binary(project_slug) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      Search.search_project(project_slug, query, opts)
    end
  end

  @spec search_general(String.t(), keyword()) :: {:ok, [map()]} | {:error, error()}
  def search_general(query, opts \\ []) do
    Search.search_global(@user_scope, query, opts)
  end

  @doc "Connects (cloning if needed) the user's personal `symphony-kb` repository."
  @spec general_connect() :: {:ok, map()} | {:error, error()}
  def general_connect, do: GeneralKb.connect(general_deps())

  @doc "Returns the general KB overview (connection state + page tree)."
  @spec general_overview() :: {:ok, map()} | {:error, error()}
  def general_overview, do: GeneralKb.overview(general_deps())

  @doc "Reads a single page from the general KB by its docs-relative path."
  @spec general_read_page(String.t()) :: {:ok, map()} | {:error, error()}
  def general_read_page(rel) when is_binary(rel), do: GeneralKb.read_page(rel, general_deps())

  @doc "Writes (create or update) a page in the general KB."
  @spec general_write_page(String.t(), %{frontmatter: map(), body: String.t()}) ::
          {:ok, map()} | {:error, error()}
  def general_write_page(rel, page) when is_binary(rel),
    do: GeneralKb.write_page(rel, page, general_deps())

  @doc "Regenerates the general KB home page from the current project list."
  @spec general_regenerate_home() :: {:ok, map()} | {:error, error()}
  def general_regenerate_home, do: GeneralKb.regenerate_home(general_deps())

  defp general_deps, do: Application.get_env(:symphony_elixir, :kb_general_deps, [])

  @spec reindex_repo(String.t(), String.t()) :: {:ok, non_neg_integer()} | {:error, error()}
  def reindex_repo(project_slug, repo_slug) do
    with {:ok, ws} <- ensure_workspace(project_slug, repo_slug) do
      Indexer.reindex_dir(project_slug, repo_slug, ws.docs_root)
    end
  end

  @doc """
  Resolves everything the sync worker needs for one repository: the GitHub
  `owner/name`, the default branch, the `%Project{}` (for merging), and the
  ensured `symphony-docs` workspace.
  """
  @spec resolve_sync_context(String.t(), String.t()) :: {:ok, map()} | {:error, error()}
  def resolve_sync_context(project_slug, repo_slug) do
    with {:ok, project} <- Context.get_project(project_slug),
         {:ok, repo} <- RepoDocs.fetch_repository(project_slug, repo_slug),
         {:ok, ws} <- ensure_workspace(project_slug, repo_slug) do
      {:ok,
       %{
         project: project,
         repo: repo.github_full_name,
         default_branch: repo.default_branch || "main",
         ws: ws
       }}
    end
  end

  @spec request_sync(String.t(), String.t()) :: :ok | {:error, term()}
  def request_sync(project_slug, repo_slug) do
    case SyncSupervisor.ensure_worker(project_slug, repo_slug) do
      {:ok, pid} -> SyncWorker.run_now(pid)
      error -> error
    end
  end

  @spec sync_status(String.t(), String.t()) :: {:ok, map()} | {:error, error()}
  def sync_status(project_slug, repo_slug) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      state = SyncState.get(project_slug, repo_slug)

      {:ok,
       %{
         status: state.status,
         pr_number: state.pr_number,
         pr_url: state.pr_url,
         last_error: state.last_error,
         last_synced_at: state.last_synced_at
       }}
    end
  end

  # Best-effort: re-read the just-written file from the worktree and refresh the
  # search index. Index failures never abort a successful Git write.
  defp index_path(project_slug, repo_slug, %{docs_root: docs_root}, rel) do
    case File.read(Path.join(docs_root, rel)) do
      {:ok, content} -> Indexer.index_page(project_slug, repo_slug, rel, content)
      _ -> :skip
    end

    :ok
  end

  defp ensure_workspace(project_slug, repo_slug) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, repo} <- RepoDocs.fetch_repository(project_slug, repo_slug),
         {:ok, checkout} <- ensure_checkout(project_slug, repo) do
      Workspace.ensure(checkout, base_branch: configured_branch(repo))
    end
  end

  defp ensure_docs_root(project_slug, repo) do
    with {:ok, checkout} <- ensure_checkout(project_slug, repo),
         {:ok, %{docs_root: docs_root}} <-
           Workspace.ensure(checkout, base_branch: configured_branch(repo)) do
      {:ok, docs_root}
    end
  end

  # Resolves the repository's local checkout, cloning it on demand (on its
  # configured branch) when Symphony has not materialized it yet. The KB then
  # branches `symphony-docs` from that configured branch.
  defp ensure_checkout(project_slug, repo) do
    checkout = Paths.repo_checkout(project_slug, repo.workspace_path)

    cond do
      File.dir?(Path.join(checkout, ".git")) -> {:ok, checkout}
      is_nil(clone_url(repo)) -> {:error, :repo_not_checked_out}
      true -> clone_checkout(repo, checkout)
    end
  end

  defp clone_checkout(repo, checkout) do
    case kb_git_clone().(clone_url(repo), checkout, branch: configured_branch(repo)) do
      {:ok, _} -> {:ok, checkout}
      {:error, reason} -> {:error, {:kb_clone_failed, reason}}
    end
  end

  defp clone_url(repo) do
    cond do
      is_binary(repo.clone_url) and repo.clone_url != "" ->
        repo.clone_url

      is_binary(repo.github_full_name) and repo.github_full_name != "" ->
        "https://github.com/#{repo.github_full_name}.git"

      true ->
        nil
    end
  end

  defp configured_branch(repo) do
    cond do
      is_binary(repo.selected_branch) and repo.selected_branch != "" -> repo.selected_branch
      is_binary(repo.default_branch) and repo.default_branch != "" -> repo.default_branch
      true -> nil
    end
  end

  defp kb_git_clone do
    Application.get_env(:symphony_elixir, :kb_git_clone, &SymphonyElixir.LocalTracker.Git.clone/3)
  end

  defp ensure_regular_file(abs) do
    case File.lstat(abs) do
      {:ok, %File.Stat{type: :regular}} -> :ok
      {:ok, %File.Stat{type: :symlink}} -> {:error, :kb_invalid_path}
      _ -> {:error, :kb_page_not_found}
    end
  end

  defp read_file(abs) do
    case File.read(abs) do
      {:ok, content} -> {:ok, content}
      {:error, _reason} -> {:error, :kb_page_not_found}
    end
  end

  defp repo_summary(repo) do
    %{
      repo_slug: Paths.repo_slug(repo.workspace_path),
      workspace_path: repo.workspace_path,
      github_full_name: repo.github_full_name,
      role: repo.role
    }
  end

  defp normalize_rel(rel) when is_list(rel), do: Enum.join(rel, "/")
  defp normalize_rel(rel) when is_binary(rel), do: rel

  defp default_title(rel) do
    rel |> normalize_rel() |> Path.basename() |> String.replace_suffix(".md", "")
  end

  defp asset_content_type(path) do
    case Path.extname(path) |> String.downcase() do
      ".png" -> "image/png"
      ".jpg" -> "image/jpeg"
      ".jpeg" -> "image/jpeg"
      ".gif" -> "image/gif"
      ".webp" -> "image/webp"
      _ -> "application/octet-stream"
    end
  end
end
