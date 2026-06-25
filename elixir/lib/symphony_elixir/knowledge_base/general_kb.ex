defmodule SymphonyElixir.KnowledgeBase.GeneralKb do
  @moduledoc """
  The personal, cross-project knowledge base backed by the user's private
  `symphony-kb` repository. Reuses the shared KB read/write/search machinery
  under the `@user` scope.
  """

  alias SymphonyElixir.GitHub.Repositories

  alias SymphonyElixir.KnowledgeBase.{
    Frontmatter,
    HomePage,
    Indexer,
    MarkdownPage,
    Paths,
    Search,
    Tree,
    Workspace,
    Writer
  }

  alias SymphonyElixir.LocalTracker.Context

  @repo_name "symphony-kb"

  @spec connect(keyword()) :: {:ok, map()} | {:error, term()}
  def connect(deps \\ []) do
    checkout = Paths.general_kb_checkout()

    if File.dir?(Path.join(checkout, ".git")) do
      Workspace.ensure(checkout)
    else
      clone_and_open(checkout, deps)
    end
  end

  @spec overview(keyword()) :: {:ok, map()} | {:error, term()}
  def overview(_deps \\ []) do
    checkout = Paths.general_kb_checkout()

    if File.dir?(Path.join(checkout, ".git")) do
      with {:ok, ws} <- Workspace.ensure(checkout) do
        {:ok, %{connected: true, tree: Tree.build(ws.docs_root)}}
      end
    else
      {:ok, %{connected: false, tree: []}}
    end
  end

  @spec read_page(String.t(), keyword()) :: {:ok, map()} | {:error, term()}
  def read_page(rel, deps \\ []) do
    with {:ok, ws} <- connect(deps),
         {:ok, abs} <- Paths.resolve_page_in(ws.docs_root, String.split(rel, "/")),
         {:ok, content} <- File.read(abs),
         {:ok, page} <- MarkdownPage.parse(content, default_title: Path.basename(rel, ".md")) do
      {:ok,
       %{
         path: rel,
         title: page.title,
         frontmatter: page.frontmatter,
         body: page.body,
         markdown: content
       }}
    end
  end

  @spec write_page(String.t(), %{frontmatter: map(), body: String.t()}, keyword()) ::
          {:ok, map()} | {:error, term()}
  def write_page(rel, page, deps \\ []) do
    with {:ok, ws} <- connect(deps),
         {:ok, result} <- Writer.write_page(ws, String.split(rel, "/"), page, push: false) do
      content = Frontmatter.serialize(page.frontmatter, page.body)
      _ = Indexer.index_page(Paths.user_scope(), Paths.general_repo_slug(), result.path, content)
      {:ok, result}
    end
  end

  @spec regenerate_home(keyword()) :: {:ok, map()} | {:error, term()}
  def regenerate_home(deps \\ []) do
    projects_fun = Keyword.get(deps, :projects, &default_projects/0)
    markdown = HomePage.render(projects_fun.())

    case MarkdownPage.parse(markdown) do
      {:ok, page} ->
        write_page("index.md", %{frontmatter: page.frontmatter, body: page.body}, deps)

      error ->
        error
    end
  end

  @spec search(String.t(), keyword()) :: {:ok, [map()]} | {:error, term()}
  def search(query, opts \\ []), do: Search.search_global(Paths.user_scope(), query, opts)

  defp clone_and_open(checkout, deps) do
    ensure_repo = Keyword.get(deps, :ensure_repo, &default_ensure_repo/0)
    clone = Keyword.get(deps, :clone, &default_clone/2)

    with {:ok, repo} <- ensure_repo.(),
         {:ok, _} <- clone.(repo.clone_url, checkout) do
      Workspace.ensure(checkout)
    end
  end

  defp default_ensure_repo, do: Repositories.ensure(@repo_name)
  defp default_clone(clone_url, dest), do: SymphonyElixir.LocalTracker.Git.clone(clone_url, dest, [])
  defp default_projects, do: Enum.map(Context.list_projects(), fn p -> %{name: p.name, slug: p.slug} end)
end
