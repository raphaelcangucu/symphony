defmodule SymphonyElixir.KnowledgeBase.Indexer do
  @moduledoc """
  Maintains the derived `kb_pages` rows that feed the FTS5 search index.
  Git remains the source of truth; this index is rebuildable at any time.
  """

  import Ecto.Query

  alias SymphonyElixir.KnowledgeBase.{MarkdownPage, PageRecord, Tree}
  alias SymphonyElixir.Repo

  @spec reindex_dir(String.t(), String.t(), Path.t()) ::
          {:ok, non_neg_integer()} | {:error, term()}
  def reindex_dir(project_slug, repo_slug, docs_root) when is_binary(docs_root) do
    paths = if File.dir?(docs_root), do: Tree.page_paths(docs_root), else: []

    Repo.transaction(fn ->
      Enum.each(paths, fn rel -> upsert_from_file(project_slug, repo_slug, docs_root, rel) end)
      prune(project_slug, repo_slug, paths)
      length(paths)
    end)
  end

  @spec index_page(String.t(), String.t(), String.t(), String.t()) ::
          {:ok, PageRecord.t()} | {:error, term()}
  def index_page(project_slug, repo_slug, rel, content) do
    {title, body} = title_and_body(content, rel)
    upsert(project_slug, repo_slug, rel, title, body)
  end

  @spec remove_page(String.t(), String.t(), String.t()) ::
          {:ok, non_neg_integer()} | {:error, term()}
  def remove_page(project_slug, repo_slug, rel) do
    {count, _} =
      PageRecord
      |> where([p], p.project_slug == ^project_slug and p.repo_slug == ^repo_slug and p.path == ^rel)
      |> Repo.delete_all()

    {:ok, count}
  end

  defp upsert_from_file(project_slug, repo_slug, docs_root, rel) do
    case File.read(Path.join(docs_root, rel)) do
      {:ok, content} ->
        {title, body} = title_and_body(content, rel)
        upsert(project_slug, repo_slug, rel, title, body)

      _ ->
        :skip
    end
  end

  defp title_and_body(content, rel) do
    case MarkdownPage.parse(content, default_title: Path.basename(rel, ".md")) do
      {:ok, page} -> {page.title, page.body}
      _ -> {Path.basename(rel, ".md"), content}
    end
  end

  defp upsert(project_slug, repo_slug, rel, title, body) do
    %PageRecord{}
    |> PageRecord.changeset(%{
      project_slug: project_slug,
      repo_slug: repo_slug,
      path: rel,
      title: title,
      body: body,
      archived: false
    })
    |> Repo.insert(
      on_conflict: {:replace, [:title, :body, :archived, :updated_at]},
      conflict_target: [:project_slug, :repo_slug, :path]
    )
  end

  defp prune(project_slug, repo_slug, keep_paths) do
    PageRecord
    |> where(
      [p],
      p.project_slug == ^project_slug and p.repo_slug == ^repo_slug and p.path not in ^keep_paths
    )
    |> Repo.delete_all()
  end
end
