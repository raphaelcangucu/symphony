defmodule SymphonyElixir.Assistant.KnowledgeBaseTools do
  @moduledoc """
  Repository-aware knowledge base tools for the assistant: list repos, search,
  read, create, update pages, link tasks into docs, and trigger sync. Every
  operation is scoped by `(project, repository)`; when the repository is
  ambiguous the tool asks the user instead of guessing.
  """

  alias SymphonyElixir.KnowledgeBase
  alias SymphonyElixir.KnowledgeBase.Paths
  alias SymphonyElixir.LocalTracker.Context

  @tools ~w(kb_list_repositories kb_search_pages kb_read_page kb_create_page kb_update_page kb_delete_page kb_delete_asset kb_delete_folder kb_link_task kb_sync)

  @general_repo_workspace "symphony-kb"

  @spec tools() :: [String.t()]
  def tools, do: @tools

  @spec tool_specs() :: [map()]
  def tool_specs do
    [
      spec(
        "kb_list_repositories",
        "List the project's knowledge base repositories and whether each has docs.",
        %{"type" => "object", "additionalProperties" => false, "properties" => %{}}
      ),
      spec(
        "kb_search_pages",
        "Full-text search knowledge base pages across the project's repositories.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["query"],
          "properties" => %{
            "query" => string_schema("Search text (matches title and body)."),
            "repository" => repository_schema()
          }
        }
      ),
      spec("kb_read_page", "Read a knowledge base page's content.", page_schema(["path"])),
      spec("kb_create_page", "Create a new knowledge base page (fails if it already exists).", page_write_schema()),
      spec("kb_update_page", "Update an existing knowledge base page.", page_write_schema()),
      spec(
        "kb_delete_page",
        "Delete a knowledge base page (markdown file under docs/). Destructive: confirm the user's intent first.",
        page_schema(["path"])
      ),
      spec(
        "kb_delete_asset",
        "Delete a knowledge base asset/image (file under docs/assets/). Destructive and may break pages that embed it; confirm first.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["path"],
          "properties" => %{
            "path" => string_schema("Asset path within docs, e.g. assets/diagram.png."),
            "repository" => repository_schema()
          }
        }
      ),
      spec(
        "kb_delete_folder",
        "Delete a knowledge base folder and everything inside it (pages and assets), recursively. Highly destructive: always confirm the exact folder with the user first.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["path"],
          "properties" => %{
            "path" => string_schema("Folder path within docs, e.g. guides or architecture/backend."),
            "repository" => repository_schema()
          }
        }
      ),
      spec(
        "kb_link_task",
        "Append a reference to a tracker issue into a knowledge base page.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["path", "identifier"],
          "properties" => %{
            "path" => string_schema("Page path within docs, e.g. architecture/backend.md."),
            "identifier" => string_schema("Issue identifier, e.g. ACME-12."),
            "repository" => repository_schema()
          }
        }
      ),
      spec(
        "kb_sync",
        "Trigger a knowledge base sync (merge default branch, open/update PR, auto-merge when green).",
        %{"type" => "object", "additionalProperties" => false, "properties" => %{"repository" => repository_schema()}}
      )
    ]
  end

  @spec execute(String.t(), String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(project_slug, tool, arguments, opts \\ [])

  def execute(project_slug, "kb_list_repositories", _args, _opts) do
    repos = list_repos(project_slug)

    {:ok,
     ok("kb_list_repositories", "Found #{length(repos)} repositories.", %{
       repositories: Enum.map(repos, &repo_view/1)
     })}
  end

  def execute(project_slug, "kb_search_pages", args, _opts) do
    with {:ok, query} <- required(args, "query") do
      case KnowledgeBase.search_project(project_slug, query, repo_filter(project_slug, args)) do
        {:ok, results} ->
          {:ok, ok("kb_search_pages", "Found #{length(results)} matching pages.", %{results: results})}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  def execute(project_slug, "kb_read_page", args, _opts) do
    with {:ok, path} <- required(args, "path"),
         {:ok, repo} <- resolve_repo(project_slug, args) do
      maybe_remediation(repo, fn slug ->
        case KnowledgeBase.read_page(project_slug, slug, String.split(path, "/")) do
          {:ok, page} -> {:ok, ok("kb_read_page", "Read #{path}.", page)}
          {:error, reason} -> {:error, reason}
        end
      end)
    end
  end

  def execute(project_slug, "kb_create_page", args, _opts) do
    write_page(project_slug, args, "kb_create_page", :must_not_exist)
  end

  def execute(project_slug, "kb_update_page", args, _opts) do
    write_page(project_slug, args, "kb_update_page", :must_exist)
  end

  def execute(project_slug, "kb_delete_page", args, _opts) do
    with {:ok, path} <- required(args, "path"),
         {:ok, repo} <- resolve_repo(project_slug, args) do
      maybe_remediation(repo, fn slug ->
        case KnowledgeBase.delete_page(project_slug, slug, String.split(path, "/")) do
          {:ok, result} -> {:ok, ok("kb_delete_page", "Deleted page #{path} from #{slug}.", result)}
          {:error, reason} -> {:error, reason}
        end
      end)
    end
  end

  def execute(project_slug, "kb_delete_asset", args, _opts) do
    with {:ok, path} <- required(args, "path"),
         {:ok, repo} <- resolve_repo(project_slug, args) do
      maybe_remediation(repo, fn slug ->
        case KnowledgeBase.delete_asset(project_slug, slug, String.split(path, "/")) do
          {:ok, result} -> {:ok, ok("kb_delete_asset", "Deleted asset #{path} from #{slug}.", result)}
          {:error, reason} -> {:error, reason}
        end
      end)
    end
  end

  def execute(project_slug, "kb_delete_folder", args, _opts) do
    with {:ok, path} <- required(args, "path"),
         {:ok, repo} <- resolve_repo(project_slug, args) do
      maybe_remediation(repo, fn slug ->
        case KnowledgeBase.delete_folder(project_slug, slug, String.split(path, "/")) do
          {:ok, result} ->
            count = result |> Map.get(:pages, []) |> length()
            {:ok, ok("kb_delete_folder", "Deleted folder #{path} (#{count} page(s)) from #{slug}.", result)}

          {:error, reason} ->
            {:error, reason}
        end
      end)
    end
  end

  def execute(project_slug, "kb_link_task", args, _opts) do
    with {:ok, path} <- required(args, "path"),
         {:ok, identifier} <- required(args, "identifier"),
         {:ok, repo} <- resolve_repo(project_slug, args) do
      maybe_remediation(repo, fn slug -> do_link_task(project_slug, slug, path, identifier) end)
    end
  end

  def execute(project_slug, "kb_sync", args, _opts) do
    with {:ok, repo} <- resolve_repo(project_slug, args) do
      maybe_remediation(repo, fn slug ->
        _ = KnowledgeBase.request_sync(project_slug, slug)
        {:ok, ok("kb_sync", "Sync requested for #{slug}.", %{repo_slug: slug})}
      end)
    end
  end

  def execute(_project_slug, tool, _args, _opts), do: {:error, {:unsupported_tool, tool}}

  # --- repository resolution -------------------------------------------------

  defp resolve_repo(project_slug, args) do
    repos = list_repos(project_slug)

    case Map.get(args, "repository") do
      value when is_binary(value) and value != "" ->
        case match_repo(repos, value) do
          nil -> {:error, :kb_repository_not_found}
          repo -> {:ok, {:resolved, repo_slug(repo)}}
        end

      _ ->
        case repos do
          [single] -> {:ok, {:resolved, repo_slug(single)}}
          [] -> {:error, :repo_not_checked_out}
          many -> {:ok, {:ambiguous, many}}
        end
    end
  end

  defp maybe_remediation({:resolved, slug}, fun), do: fun.(slug)

  defp maybe_remediation({:ambiguous, repos}, _fun) do
    {:ok,
     %{
       tool: "kb_repository_choice",
       message:
         "Multiple repositories are linked. ASK the user which repository to use, then call the tool again with the repository argument.",
       data: %{repositories: Enum.map(repos, &repo_view/1), remediation: "needs_repository"}
     }}
  end

  defp write_page(project_slug, args, tool, existence) do
    with {:ok, path} <- required(args, "path"),
         {:ok, body} <- required(args, "body"),
         {:ok, repo} <- resolve_repo(project_slug, args) do
      maybe_remediation(repo, fn slug ->
        with :ok <- check_existence(project_slug, slug, path, existence),
             {:ok, result} <-
               KnowledgeBase.write_page(project_slug, slug, String.split(path, "/"), build_page(args, body)) do
          {:ok, ok(tool, "Saved #{path} in #{slug}.", result)}
        end
      end)
    end
  end

  defp check_existence(project_slug, slug, path, :must_not_exist) do
    case KnowledgeBase.read_page(project_slug, slug, String.split(path, "/")) do
      {:ok, _} -> {:error, :kb_page_exists}
      {:error, :kb_page_not_found} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp check_existence(project_slug, slug, path, :must_exist) do
    case KnowledgeBase.read_page(project_slug, slug, String.split(path, "/")) do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp build_page(args, body) do
    frontmatter = if title = args["title"], do: %{"title" => title}, else: %{}
    %{frontmatter: frontmatter, body: body}
  end

  defp do_link_task(project_slug, slug, path, identifier) do
    with {:ok, page} <- KnowledgeBase.read_page(project_slug, slug, String.split(path, "/")) do
      ref = "\n\n> Related issue: [#{identifier}](#{issue_url(project_slug, identifier)})\n"
      updated = %{frontmatter: page.frontmatter, body: page.body <> ref}

      case KnowledgeBase.write_page(project_slug, slug, String.split(path, "/"), updated) do
        {:ok, result} -> {:ok, ok("kb_link_task", "Linked #{identifier} into #{path}.", result)}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp repo_filter(project_slug, args) do
    case Map.get(args, "repository") do
      value when is_binary(value) and value != "" ->
        case match_repo(list_repos(project_slug), value) do
          nil -> []
          repo -> [repo_slug: repo_slug(repo)]
        end

      _ ->
        []
    end
  end

  # --- helpers ---------------------------------------------------------------

  # The personal KB (`@user`) has no tracker repository rows; it is a single
  # synthetic repo whose slug `KnowledgeBase` resolves to the `symphony-kb`
  # checkout. Returning it here lets `resolve_repo/2` pick it automatically.
  defp list_repos("@user"),
    do: [%{workspace_path: @general_repo_workspace, github_full_name: nil, role: nil}]

  defp list_repos(project_slug), do: Context.list_repositories(project_slug)

  defp match_repo(repos, value) do
    Enum.find(repos, fn repo ->
      value in [repo.github_full_name, repo.workspace_path, repo_slug(repo)]
    end)
  end

  defp repo_slug(repo), do: Paths.repo_slug(repo.workspace_path)

  defp repo_view(repo) do
    %{
      workspace_path: repo.workspace_path,
      github_full_name: repo.github_full_name,
      repo_slug: repo_slug(repo),
      role: repo.role
    }
  end

  defp issue_url(project_slug, identifier), do: "/projects/#{project_slug}/board/issues/#{identifier}"

  defp required(args, key) do
    case args |> Map.get(key) |> to_string() |> String.trim() do
      "" -> {:error, {:missing_required_field, key}}
      value -> {:ok, value}
    end
  end

  defp ok(tool, message, data), do: %{tool: tool, message: message, data: data}

  defp spec(name, description, schema),
    do: %{"name" => name, "description" => description, "inputSchema" => schema}

  defp string_schema(description), do: %{"type" => "string", "description" => description}

  defp repository_schema do
    %{
      "type" => ["string", "null"],
      "description" =>
        "Repository (owner/name, workspace path, or slug). Omit to use the only repo; required when several are linked."
    }
  end

  defp page_schema(required) do
    %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => required,
      "properties" => %{
        "path" => string_schema("Page path within docs."),
        "repository" => repository_schema()
      }
    }
  end

  defp page_write_schema do
    %{
      "type" => "object",
      "additionalProperties" => false,
      "required" => ["path", "body"],
      "properties" => %{
        "path" => string_schema("Page path within docs, e.g. guides/intro.md."),
        "title" => string_schema("Optional page title (stored as frontmatter)."),
        "body" => string_schema("Markdown body."),
        "repository" => repository_schema()
      }
    }
  end
end
