defmodule SymphonyElixir.KnowledgeBase.Writer do
  @moduledoc "Writes knowledge base pages/assets into a worktree and auto-commits them."

  alias SymphonyElixir.KnowledgeBase.{Assets, Frontmatter, Git, Paths, Tree}

  @asset_extensions [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]

  @type ws :: %{worktree: Path.t(), docs_root: Path.t(), branch: String.t()}

  @spec write_page(ws(), [String.t()] | String.t(), %{frontmatter: map(), body: String.t()}, keyword()) ::
          {:ok, map()} | {:error, term()}
  def write_page(ws, rel, %{frontmatter: fm, body: body}, opts \\ []) do
    with {:ok, abs} <- Paths.resolve_page_in(ws.docs_root, rel),
         {:ok, page_rel} <- Paths.safe_relative_path(rel),
         :ok <- File.mkdir_p(Path.dirname(abs)),
         :ok <- File.write(abs, Frontmatter.serialize(fm, body)),
         {:ok, commit} <-
           stage_and_commit(ws, ["docs/#{page_rel}"], commit_message(opts, "update #{page_rel}"), opts) do
      {:ok, %{path: page_rel, commit: commit, pushed: maybe_push(ws, opts)}}
    end
  end

  @spec move_page(ws(), [String.t()] | String.t(), [String.t()] | String.t(), keyword()) ::
          {:ok, map()} | {:error, term()}
  def move_page(ws, from, to, opts \\ []) do
    with {:ok, from_abs} <- Paths.resolve_page_in(ws.docs_root, from),
         {:ok, to_abs} <- Paths.resolve_page_in(ws.docs_root, to),
         {:ok, from_rel} <- Paths.safe_relative_path(from),
         {:ok, to_rel} <- Paths.safe_relative_path(to),
         :ok <- ensure_exists(from_abs),
         :ok <- File.mkdir_p(Path.dirname(to_abs)),
         :ok <- File.rename(from_abs, to_abs),
         {:ok, commit} <-
           stage_and_commit(
             ws,
             ["docs/#{from_rel}", "docs/#{to_rel}"],
             commit_message(opts, "move #{from_rel} -> #{to_rel}"),
             opts
           ) do
      {:ok, %{path: to_rel, from: from_rel, commit: commit, pushed: maybe_push(ws, opts)}}
    end
  end

  @spec delete_page(ws(), [String.t()] | String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def delete_page(ws, rel, opts \\ []) do
    with {:ok, abs} <- Paths.resolve_page_in(ws.docs_root, rel),
         {:ok, page_rel} <- Paths.safe_relative_path(rel),
         :ok <- ensure_exists(abs),
         :ok <- File.rm(abs),
         {:ok, commit} <-
           stage_and_commit(ws, ["docs/#{page_rel}"], commit_message(opts, "delete #{page_rel}"), opts) do
      {:ok, %{path: page_rel, commit: commit, pushed: maybe_push(ws, opts)}}
    end
  end

  @spec delete_folder(ws(), [String.t()] | String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def delete_folder(ws, rel, opts \\ []) do
    with {:ok, abs} <- Paths.resolve_folder_in(ws.docs_root, rel),
         {:ok, folder_rel} <- Paths.safe_folder_relative_path(rel),
         :ok <- ensure_dir(abs) do
      pages = folder_page_paths(ws.docs_root, folder_rel)
      File.rm_rf!(abs)

      case stage_and_commit(
             ws,
             ["docs/#{folder_rel}"],
             commit_message(opts, "delete folder #{folder_rel}"),
             opts
           ) do
        {:ok, commit} ->
          {:ok, %{path: folder_rel, pages: pages, commit: commit, pushed: maybe_push(ws, opts)}}

        error ->
          error
      end
    end
  end

  @spec delete_asset(ws(), [String.t()] | String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def delete_asset(ws, rel, opts \\ []) do
    with {:ok, asset_rel} <- safe_existing_asset(ws.docs_root, rel),
         abs = Path.join(ws.docs_root, asset_rel),
         :ok <- File.rm(abs),
         {:ok, commit} <-
           stage_and_commit(
             ws,
             ["docs/#{asset_rel}"],
             commit_message(opts, "delete asset #{asset_rel}"),
             opts
           ) do
      {:ok, %{path: asset_rel, commit: commit, pushed: maybe_push(ws, opts)}}
    end
  end

  @spec store_asset(ws(), String.t(), binary(), keyword()) :: {:ok, map()} | {:error, term()}
  def store_asset(ws, filename, bytes, opts \\ []) do
    with {:ok, ext} <- Assets.validate(filename, byte_size(bytes)) do
      asset_rel = asset_target(ws.docs_root, opts[:name], bytes, ext)
      abs = Path.join(ws.docs_root, asset_rel)

      if File.exists?(abs) and File.read(abs) == {:ok, bytes} do
        # Identical content already stored under the same name: idempotent re-paste.
        {:ok, asset_result(asset_rel, opts[:page_path], :unchanged, false)}
      else
        :ok = File.mkdir_p(Path.dirname(abs))
        :ok = File.write(abs, bytes)
        name = Path.basename(asset_rel)

        case stage_and_commit(ws, ["docs/#{asset_rel}"], commit_message(opts, "add asset #{name}"), opts) do
          {:ok, commit} -> {:ok, asset_result(asset_rel, opts[:page_path], commit, maybe_push(ws, opts))}
          error -> error
        end
      end
    end
  end

  @spec rename_asset(ws(), String.t(), String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def rename_asset(ws, from_rel, desired_name, opts \\ []) do
    with {:ok, from_rel} <- safe_existing_asset(ws.docs_root, from_rel),
         {:ok, ext} <- asset_ext(from_rel) do
      to_rel = unique_rename_rel(ws.docs_root, Assets.slug_base(desired_name), ext, from_rel)

      if to_rel == from_rel do
        {:ok, %{from: from_rel, asset_path: from_rel, pages: [], commit: :unchanged, pushed: false}}
      else
        from_abs = Path.join(ws.docs_root, from_rel)
        to_abs = Path.join(ws.docs_root, to_rel)
        :ok = File.mkdir_p(Path.dirname(to_abs))
        :ok = File.rename(from_abs, to_abs)
        changed_pages = rewrite_references(ws.docs_root, from_rel, to_rel)

        staged =
          ["docs/#{from_rel}", "docs/#{to_rel}"] ++ Enum.map(changed_pages, &"docs/#{&1}")

        message = commit_message(opts, "rename asset #{from_rel} -> #{to_rel}")

        case stage_and_commit(ws, staged, message, opts) do
          {:ok, commit} ->
            {:ok,
             %{
               from: from_rel,
               asset_path: to_rel,
               pages: changed_pages,
               commit: commit,
               pushed: maybe_push(ws, opts)
             }}

          error ->
            error
        end
      end
    end
  end

  defp asset_result(asset_rel, page_path, commit, pushed) do
    link = if page_path, do: Assets.relative_link(page_path, asset_rel), else: asset_rel
    %{asset_path: asset_rel, markdown_link: link, commit: commit, pushed: pushed}
  end

  # Picks the stored asset path. A friendly `name` becomes `assets/<slug><ext>`,
  # deduped against existing files (identical bytes reuse the same path, differing
  # bytes get a `-2`, `-3`, … suffix). Without a name we keep the content hash.
  defp asset_target(_docs_root, name, bytes, ext) when name in [nil, ""] do
    "assets/" <> Assets.content_name(bytes, ext)
  end

  defp asset_target(docs_root, name, bytes, ext) do
    unique_store_rel(docs_root, Assets.slug_base(name), ext, bytes, 1)
  end

  defp unique_store_rel(docs_root, base, ext, bytes, n) do
    rel = "assets/#{base}#{suffix(n)}#{ext}"
    abs = Path.join(docs_root, rel)

    cond do
      not File.exists?(abs) -> rel
      File.read(abs) == {:ok, bytes} -> rel
      true -> unique_store_rel(docs_root, base, ext, bytes, n + 1)
    end
  end

  defp unique_rename_rel(docs_root, base, ext, from_rel, n \\ 1) do
    rel = "assets/#{base}#{suffix(n)}#{ext}"

    cond do
      rel == from_rel -> rel
      not File.exists?(Path.join(docs_root, rel)) -> rel
      true -> unique_rename_rel(docs_root, base, ext, from_rel, n + 1)
    end
  end

  defp suffix(1), do: ""
  defp suffix(n), do: "-#{n}"

  defp safe_existing_asset(docs_root, rel) do
    with {:ok, abs} <- Paths.resolve_asset_in(docs_root, rel),
         {:ok, safe_rel} <- Paths.safe_asset_relative_path(rel),
         true <- String.starts_with?(safe_rel, "assets/"),
         :ok <- ensure_exists(abs) do
      {:ok, safe_rel}
    else
      false -> {:error, :kb_invalid_path}
      {:error, reason} -> {:error, reason}
    end
  end

  defp asset_ext(rel) do
    ext = rel |> Path.extname() |> String.downcase()
    if ext in @asset_extensions, do: {:ok, ext}, else: {:error, :kb_unsupported_asset}
  end

  # Updates every markdown page that links to the renamed asset. Stored links are
  # relative (`../assets/<name>`, `assets/<name>`), so the canonical `assets/<name>`
  # suffix is replaced wherever it appears. Returns the docs-relative pages changed.
  defp rewrite_references(docs_root, from_rel, to_rel) do
    docs_root
    |> Tree.page_paths()
    |> Enum.reduce([], fn rel, acc ->
      abs = Path.join(docs_root, rel)

      case File.read(abs) do
        {:ok, content} ->
          updated = String.replace(content, from_rel, to_rel)

          if updated == content do
            acc
          else
            File.write(abs, updated)
            [rel | acc]
          end

        _ ->
          acc
      end
    end)
    |> Enum.reverse()
  end

  # Saving identical content (e.g. a manual save with no edits, or a Tiptap
  # round-trip that produced byte-identical markdown) must not error or create an
  # empty commit: it is a successful no-op.
  defp stage_and_commit(ws, paths, message, opts) do
    git_opts =
      [
        runner: opts[:runner],
        name: opts[:author_name],
        email: opts[:author_email]
      ]
      |> Enum.reject(fn {_key, value} -> is_nil(value) end)

    with :ok <- Git.add(ws.worktree, paths, git_opts) do
      if Git.staged_changes?(ws.worktree, git_opts) do
        case Git.commit(ws.worktree, message, git_opts) do
          {:ok, sha} -> {:ok, sha}
          {:error, reason} -> {:error, {:kb_commit_failed, reason}}
        end
      else
        {:ok, :unchanged}
      end
    end
  end

  defp maybe_push(ws, opts) do
    if Keyword.get(opts, :push, false) do
      Git.push(ws.worktree, ws.branch, Keyword.take(opts, [:runner])) == :ok
    else
      false
    end
  end

  defp ensure_exists(abs), do: if(File.regular?(abs), do: :ok, else: {:error, :kb_page_not_found})
  defp ensure_dir(abs), do: if(File.dir?(abs), do: :ok, else: {:error, :kb_folder_not_found})

  # Markdown pages nested under the folder, used to evict them from the search
  # index after the directory is removed. Assets are skipped by `Tree.page_paths`.
  defp folder_page_paths(docs_root, folder_rel) do
    prefix = folder_rel <> "/"

    docs_root
    |> Tree.page_paths()
    |> Enum.filter(&String.starts_with?(&1, prefix))
  end

  defp commit_message(opts, default), do: Keyword.get(opts, :message, "docs(kb): #{default}")
end
