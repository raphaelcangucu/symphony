defmodule SymphonyElixir.KnowledgeBase.IssueWorkspace do
  @moduledoc """
  Knowledge-base view over an issue/task working tree.

  Unlike the project KB, this surface only exposes `docs/**` files changed in the
  issue worktree relative to the repository's configured base branch. It includes
  committed, pushed, uncommitted, and untracked docs changes.
  """

  alias SymphonyElixir.Assistant.History
  alias SymphonyElixir.KnowledgeBase.{Frontmatter, MarkdownPage, Paths, RepoDocs, Tree}
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Workspace

  @type error ::
          :project_not_found
          | :repo_not_found
          | :workspace_missing
          | :kb_invalid_path
          | :kb_page_not_found
          | :kb_frontmatter_invalid
          | {:git_failed, term()}

  @spec repo_tree(String.t(), String.t(), String.t()) :: {:ok, map()} | {:error, error()}
  def repo_tree(project_slug, identifier, repo_slug) do
    with {:ok, repo, repo_root, docs_root} <- resolve_repo(project_slug, identifier, repo_slug),
         {:ok, paths} <- changed_doc_paths(repo_root, repo) do
      {:ok,
       %{
         repository: repo_summary(repo),
         docs_present: File.dir?(docs_root),
         tree: Tree.build_from_paths(docs_root, paths)
       }}
    end
  end

  @spec read_page(String.t(), String.t(), String.t(), [String.t()] | String.t()) ::
          {:ok, map()} | {:error, error()}
  def read_page(project_slug, identifier, repo_slug, rel) do
    with {:ok, repo, _repo_root, docs_root} <- resolve_repo(project_slug, identifier, repo_slug),
         {:ok, abs} <- Paths.resolve_page_in(docs_root, rel),
         :ok <- ensure_regular_file(abs),
         {:ok, content} <- File.read(abs),
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
          String.t(),
          [String.t()] | String.t(),
          %{frontmatter: map(), body: String.t()}
        ) :: {:ok, map()} | {:error, error()}
  def write_page(project_slug, identifier, repo_slug, rel, %{frontmatter: fm, body: body}) do
    with {:ok, _repo, _repo_root, docs_root} <- resolve_repo(project_slug, identifier, repo_slug),
         {:ok, abs} <- Paths.resolve_page_in(docs_root, rel),
         {:ok, page_rel} <- Paths.safe_relative_path(rel),
         :ok <- File.mkdir_p(Path.dirname(abs)),
         :ok <- File.write(abs, Frontmatter.serialize(fm, body)) do
      {:ok, %{path: page_rel, commit: :workspace, pushed: false}}
    end
  end

  defp resolve_repo(project_slug, identifier, repo_slug) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, repo} <- RepoDocs.fetch_repository(project_slug, repo_slug),
         {:ok, issue_root} <- issue_workspace(project_slug, identifier),
         {:ok, repo_root} <- repo_root(issue_root, repo.workspace_path),
         docs_root = Paths.docs_root_in(repo_root) do
      {:ok, repo, repo_root, docs_root}
    end
  end

  defp issue_workspace(project_slug, identifier) do
    case History.issue_workspace_context(identifier) do
      %{project_slug: ^project_slug, workspace_path: path} when is_binary(path) and path != "" ->
        {:ok, Path.expand(path)}

      %{workspace_path: path} when is_binary(path) and path != "" ->
        {:ok, Path.expand(path)}

      _ ->
        path = Workspace.path_for_issue(%{identifier: identifier, project_slug: project_slug})
        if File.dir?(path), do: {:ok, path}, else: {:error, :workspace_missing}
    end
  end

  defp repo_root(issue_root, workspace_path) when is_binary(workspace_path) do
    candidate = Path.expand(workspace_path, issue_root)
    issue_root = Path.expand(issue_root)

    if File.dir?(candidate) and (candidate == issue_root or String.starts_with?(candidate, issue_root <> "/")) do
      {:ok, candidate}
    else
      {:error, :workspace_missing}
    end
  end

  defp changed_doc_paths(repo_root, repo) do
    base = base_ref(repo_root, repo)

    with {:ok, committed} <- git_lines(repo_root, ["diff", "--name-only", "#{base}...HEAD", "--", "docs"]),
         {:ok, unstaged} <- git_lines(repo_root, ["diff", "--name-only", "--", "docs"]),
         {:ok, staged} <- git_lines(repo_root, ["diff", "--cached", "--name-only", "--", "docs"]),
         {:ok, untracked} <- git_lines(repo_root, ["ls-files", "--others", "--exclude-standard", "--", "docs"]) do
      paths =
        (committed ++ unstaged ++ staged ++ untracked)
        |> Enum.map(&docs_relative/1)
        |> Enum.reject(&is_nil/1)
        |> Enum.uniq()
        |> Enum.sort()

      {:ok, paths}
    end
  end

  defp base_ref(repo_root, repo) do
    branch =
      cond do
        is_binary(repo.selected_branch) and repo.selected_branch != "" -> repo.selected_branch
        is_binary(repo.default_branch) and repo.default_branch != "" -> repo.default_branch
        true -> "main"
      end

    cond do
      git_ref?(repo_root, "origin/#{branch}") -> "origin/#{branch}"
      git_ref?(repo_root, branch) -> branch
      true -> "HEAD"
    end
  end

  defp git_ref?(repo_root, ref) do
    match?({_out, 0}, System.cmd("git", ["rev-parse", "--verify", "--quiet", ref], cd: repo_root, stderr_to_stdout: true))
  end

  defp git_lines(repo_root, args) do
    case System.cmd("git", args, cd: repo_root, stderr_to_stdout: true) do
      {output, 0} ->
        {:ok, output |> String.split("\n", trim: true) |> Enum.map(&String.trim/1)}

      {output, status} ->
        {:error, {:git_failed, {status, String.trim(output)}}}
    end
  end

  defp docs_relative("docs/" <> rel) do
    if String.ends_with?(rel, ".md"), do: rel, else: nil
  end

  defp docs_relative(_path), do: nil

  defp repo_summary(repo) do
    %{
      repo_slug: Paths.repo_slug(repo.workspace_path),
      workspace_path: repo.workspace_path,
      github_full_name: repo.github_full_name,
      default_branch: configured_branch(repo),
      role: repo.role,
      docs_present?: true
    }
  end

  defp configured_branch(repo) do
    cond do
      is_binary(repo.selected_branch) and repo.selected_branch != "" -> repo.selected_branch
      is_binary(repo.default_branch) and repo.default_branch != "" -> repo.default_branch
      true -> "main"
    end
  end

  defp ensure_regular_file(abs), do: if(File.regular?(abs), do: :ok, else: {:error, :kb_page_not_found})
  defp normalize_rel(rel) when is_list(rel), do: Enum.join(rel, "/")
  defp normalize_rel(rel), do: rel
  defp default_title(rel), do: rel |> normalize_rel() |> Path.basename() |> String.replace_suffix(".md", "")
end
