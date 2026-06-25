defmodule SymphonyElixir.KnowledgeBase.Writer do
  @moduledoc "Writes knowledge base pages/assets into a worktree and auto-commits them."

  alias SymphonyElixir.KnowledgeBase.{Assets, Frontmatter, Git, Paths}

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

  @spec store_asset(ws(), String.t(), binary(), keyword()) :: {:ok, map()} | {:error, term()}
  def store_asset(ws, filename, bytes, opts \\ []) do
    with {:ok, ext} <- Assets.validate(filename, byte_size(bytes)) do
      name = Assets.content_name(bytes, ext)
      asset_rel = "assets/#{name}"
      abs = Path.join(ws.docs_root, asset_rel)
      :ok = File.mkdir_p(Path.dirname(abs))
      :ok = File.write(abs, bytes)

      case stage_and_commit(ws, ["docs/#{asset_rel}"], commit_message(opts, "add asset #{name}"), opts) do
        {:ok, commit} ->
          link = if page = opts[:page_path], do: Assets.relative_link(page, asset_rel), else: asset_rel
          {:ok, %{asset_path: asset_rel, markdown_link: link, commit: commit, pushed: maybe_push(ws, opts)}}

        error ->
          error
      end
    end
  end

  defp stage_and_commit(ws, paths, message, opts) do
    git_opts = Keyword.take(opts, [:runner, :name, :email])

    with :ok <- Git.add(ws.worktree, paths, git_opts) do
      case Git.commit(ws.worktree, message, git_opts) do
        {:ok, sha} -> {:ok, sha}
        {:error, reason} -> {:error, {:kb_commit_failed, reason}}
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
  defp commit_message(opts, default), do: Keyword.get(opts, :message, "docs(kb): #{default}")
end
