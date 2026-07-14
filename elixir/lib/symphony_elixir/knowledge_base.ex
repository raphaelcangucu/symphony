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
    Tree,
    Workspace,
    Writer
  }

  alias SymphonyElixir.LocalTracker.Broadcaster
  alias SymphonyElixir.LocalTracker.Context

  @user_scope "@user"
  @general_repo_workspace "symphony-kb"
  @general_project_name "Personal"

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
  # The personal KB is exposed as a single-repository pseudo-project under the
  # `@user` scope so it can reuse every project-KB component, endpoint, and the
  # assistant. Connection state is inferred from the local checkout without
  # cloning, so loading the overview has no side effects.
  def project_overview(@user_scope) do
    {:ok,
     %{
       project: %{slug: @user_scope, name: @general_project_name},
       repositories: [general_repo_info(general_docs_present?())]
     }}
  end

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
  def repo_tree(@user_scope, _repo_slug) do
    with {:ok, ws} <- general_workspace() do
      {:ok,
       %{
         repository: general_repo_summary(),
         docs_present: File.dir?(ws.docs_root),
         tree: Tree.build(ws.docs_root)
       }}
    end
  end

  def repo_tree(project_slug, repo_slug) when is_binary(project_slug) and is_binary(repo_slug) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, repo} <- RepoDocs.fetch_repository(project_slug, repo_slug),
         {:ok, docs_root} <- ensure_docs_root(project_slug, repo) do
      reindex_docs_root(project_slug, repo_slug, docs_root)

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
  def read_page(@user_scope, _repo_slug, rel) do
    with {:ok, ws} <- general_workspace(),
         {:ok, abs} <- Paths.resolve_page_in(ws.docs_root, rel),
         :ok <- ensure_regular_file(abs),
         {:ok, content} <- read_file(abs),
         {:ok, page} <- MarkdownPage.parse(content, default_title: default_title(rel)) do
      {:ok,
       %{
         repo_slug: Paths.general_repo_slug(),
         path: normalize_rel(rel),
         title: page.title,
         frontmatter: page.frontmatter,
         body: page.body,
         content: content
       }}
    end
  end

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

  @spec delete_folder(String.t(), String.t(), [String.t()] | String.t()) ::
          {:ok, map()} | {:error, error()}
  def delete_folder(project_slug, repo_slug, rel) do
    with {:ok, ws} <- ensure_workspace(project_slug, repo_slug),
         {:ok, result} <- Writer.delete_folder(ws, rel, push: true) do
      Enum.each(result.pages, &Indexer.remove_page(project_slug, repo_slug, &1))

      Broadcaster.kb_event(project_slug, "kb_folder_deleted", %{
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
  def read_asset(@user_scope, _repo_slug, rel) do
    with {:ok, ws} <- general_workspace(),
         {:ok, abs} <- resolve_readable_asset(ws.docs_root, rel),
         {:ok, bytes} <- read_file(abs) do
      {:ok, bytes, asset_content_type(abs)}
    end
  end

  def read_asset(project_slug, repo_slug, rel)
      when is_binary(project_slug) and is_binary(repo_slug) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, repo} <- RepoDocs.fetch_repository(project_slug, repo_slug),
         {:ok, docs_root} <- ensure_docs_root(project_slug, repo),
         {:ok, abs} <- resolve_readable_asset(docs_root, rel),
         {:ok, bytes} <- read_file(abs) do
      {:ok, bytes, asset_content_type(abs)}
    end
  end

  # Resolves an asset path against the docs/ folder first (KB-uploaded assets
  # under `assets/`), then against the repository worktree root, so pages can
  # reference any project file (e.g. `../advisestream/web/css/images/logo.png`).
  # Each root confines resolution to itself; symlinks are skipped so reads can
  # never escape the worktree.
  defp resolve_readable_asset(docs_root, rel) do
    with {:ok, _safe_rel} <- Paths.safe_asset_relative_path(rel) do
      worktree_root = Path.dirname(docs_root)

      candidate =
        [docs_root, worktree_root]
        |> Enum.map(fn root ->
          case Paths.resolve_asset_in(root, rel) do
            {:ok, abs} -> abs
            _ -> nil
          end
        end)
        |> Enum.find(fn abs -> is_binary(abs) and regular_file?(abs) end)

      if candidate, do: {:ok, candidate}, else: {:error, :kb_page_not_found}
    end
  end

  @spec search_project(String.t(), String.t(), keyword()) ::
          {:ok, [map()]} | {:error, error()}
  def search_project(project_slug, query, opts \\ [])

  def search_project(@user_scope, query, opts) when is_binary(query) do
    Search.search_global(@user_scope, query, opts)
  end

  def search_project(project_slug, query, opts) when is_binary(project_slug) do
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

  @doc "Ensures the general KB home page exists, generating it when missing."
  @spec general_ensure_home() :: {:ok, map()} | {:error, error()}
  def general_ensure_home, do: GeneralKb.ensure_home(general_deps())

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
  # Project and personal KB edits write directly to their owning checkout/branch,
  # so there is no `symphony-docs` promotion worker to schedule.
  def request_sync(_project_slug, _repo_slug), do: :ok

  @spec sync_status(String.t(), String.t()) :: {:ok, map()} | {:error, error()}
  def sync_status(_project_slug, _repo_slug) do
    {:ok, %{status: "idle", pr_number: nil, pr_url: nil, last_error: nil, last_synced_at: nil}}
  end

  # Best-effort: full reindex of a repository's docs straight from the worktree.
  # The sidebar tree is read directly from disk, so listing a repo is the moment
  # to make every page on disk searchable — including docs cloned from Git that
  # were never authored through Symphony (so `index_page` never saw them). The
  # reindex is idempotent (upsert + prune of vanished files) and must never abort
  # a tree listing, so all failures are swallowed.
  defp reindex_docs_root(project_slug, repo_slug, docs_root) do
    Indexer.reindex_dir(project_slug, repo_slug, docs_root)
    :ok
  rescue
    _ -> :ok
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

  defp ensure_workspace(@user_scope, _repo_slug), do: general_workspace()

  defp ensure_workspace(project_slug, repo_slug) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, repo} <- RepoDocs.fetch_repository(project_slug, repo_slug),
         {:ok, checkout} <- ensure_checkout(project_slug, repo) do
      Workspace.ensure(checkout, base_branch: configured_branch(repo))
    end
  end

  defp general_workspace, do: GeneralKb.connect(general_deps())

  # Reports whether the personal KB has a docs/ tree without ever cloning: when
  # the checkout is not present yet it is simply "not connected" (no docs).
  defp general_docs_present? do
    if File.dir?(Path.join(Paths.general_kb_checkout(), ".git")) do
      case general_workspace() do
        {:ok, ws} -> File.dir?(ws.docs_root)
        _ -> false
      end
    else
      false
    end
  end

  defp general_repo_summary do
    %{
      repo_slug: Paths.general_repo_slug(),
      workspace_path: @general_repo_workspace,
      github_full_name: nil,
      default_branch: "main",
      role: nil
    }
  end

  defp general_repo_info(docs_present) when is_boolean(docs_present) do
    Map.put(general_repo_summary(), :docs_present?, docs_present)
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

  # `File.lstat/1` does not follow symlinks, so a symlinked path is rejected
  # here - this keeps asset reads inside the worktree even if a link points out.
  defp regular_file?(abs) do
    match?({:ok, %File.Stat{type: :regular}}, File.lstat(abs))
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
      default_branch: configured_branch(repo) || "main",
      role: repo.role
    }
  end

  defp normalize_rel(rel) when is_list(rel), do: Enum.join(rel, "/")
  defp normalize_rel(rel) when is_binary(rel), do: rel

  defp default_title(rel) do
    rel |> normalize_rel() |> Path.basename() |> String.replace_suffix(".md", "")
  end

  @text_asset_extensions ~w(.txt .md .markdown .log .csv .tsv .json .yml .yaml
                            .xml .sql .sh .bash .zsh .js .mjs .cjs .ts .tsx .jsx
                            .css .scss .sass .less .php .py .rb .go .rs .java .kt
                            .c .h .cc .cpp .hpp .cs .swift .vue .svelte .toml
                            .ini .conf .cfg .properties .gradle .lock .gitignore
                            .dockerignore .editorconfig .html .htm)

  # Known extensions render inline; everything else (including unknown binaries)
  # falls back to a download. Code/text is served as `text/plain` so the browser
  # shows the source rather than executing it (no same-origin HTML/JS execution).
  defp asset_content_type(path) do
    case Path.extname(path) |> String.downcase() do
      ".png" -> "image/png"
      ".jpg" -> "image/jpeg"
      ".jpeg" -> "image/jpeg"
      ".gif" -> "image/gif"
      ".webp" -> "image/webp"
      ".svg" -> "image/svg+xml"
      ".bmp" -> "image/bmp"
      ".ico" -> "image/x-icon"
      ".pdf" -> "application/pdf"
      ext -> if ext in @text_asset_extensions, do: "text/plain", else: "application/octet-stream"
    end
  end
end
