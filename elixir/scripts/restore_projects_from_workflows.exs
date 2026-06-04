# Restores local tracker projects from WORKFLOW.*.md files (DB-owned config).
#
# Usage (from elixir/, daemon may stay running — only starts Repo):
#   mise exec -- mix run scripts/restore_projects_from_workflows.exs
#
# Optional paths:
#   mix run scripts/restore_projects_from_workflows.exs -- WORKFLOW.macro-markets.md

defmodule Symphony.RestoreProjectsFromWorkflows do
  alias SymphonyElixir.GitHub.IssueAdapter
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo
  alias SymphonyElixir.Tracker.Sync.LocalStore
  alias SymphonyElixir.Workflow

  @default_files [
    {"WORKFLOW.macro-markets.md", "macro-markets", "Macro Markets"},
    {"WORKFLOW.distributionmachine.md", "distributionmachine", "Distribution Machine"}
  ]

  def run(argv) do
    start_repo!()
    files = workflow_files(argv)

    Enum.each(files, fn {path, slug, default_name} ->
      restore_one(path, slug, default_name)
    end)

    IO.puts("\nDone. Projects:")
    Context.list_projects(include_archived: true)
    |> Enum.each(fn p ->
      setup? = if Context.get_project_setup(p.slug), do: "setup=yes", else: "setup=no"
      repos = Context.list_repositories(p.slug) |> length()
      IO.puts("  - #{p.slug} (#{p.tracker_kind}, repos=#{repos}, #{setup?})")
    end)
  end

  defp restore_one(path, slug, default_name) do
    path = Path.expand(path, File.cwd!())

    unless File.regular?(path) do
      halt!("Workflow not found: #{path}")
    end

    markdown = File.read!(path)

    with {:ok, %{config: config, prompt: _prompt}} <- Workflow.parse_string(markdown),
         {:ok, github} <- github_section(config),
         repositories <- repositories_for(slug, config) do
      attrs = %{
        "name" => display_name(config, default_name),
        "slug" => slug,
        "description" => project_description(slug),
        "tracker" => %{
          "kind" => "github",
          "config" => github
        },
        "repositories" => repositories,
        "setup" => %{
          "workflow_markdown" => markdown,
          "after_create_hook" => after_create_hook(config),
          "validation_commands" => %{"commands" => validation_commands(slug)},
          "scan_summary" => %{"restored_from" => Path.basename(path)}
        }
      }

      case Context.get_project(slug) do
        {:ok, _project} ->
          update_existing(slug, attrs)

        {:error, :project_not_found} ->
          create_new(attrs)
      end
    else
      {:error, reason} -> halt!("Failed to restore #{slug} from #{path}: #{inspect(reason)}")
    end
  end

  defp update_existing(slug, attrs) do
    tracker = Map.fetch!(attrs, "tracker")

    with {:ok, project} <-
           Context.update_project(slug, %{
             "name" => Map.fetch!(attrs, "name"),
             "description" => Map.get(attrs, "description"),
             "tracker" => tracker
           }),
         {:ok, _setup} <- Context.upsert_project_setup(slug, Map.fetch!(attrs, "setup")),
         {:ok, _repos} <- Context.replace_repositories(slug, Map.fetch!(attrs, "repositories")),
         :ok <- sync_workflow_statuses_from_github(project) do
      IO.puts("✓  Updated #{project.slug} (github tracker + workflow_markdown)")
    else
      {:error, reason} -> halt!("Update failed for #{slug}: #{inspect(reason)}")
    end
  end

  defp create_new(attrs) do
    slug = Map.fetch!(attrs, "slug")

    case Context.create_workspace_project(attrs) do
      {:ok, project} ->
        # GitHub-backed projects skip setup on create; upsert workflow_markdown explicitly.
        case Context.upsert_project_setup(slug, Map.fetch!(attrs, "setup")) do
          {:ok, _} ->
            sync_workflow_statuses_from_github(project)
            IO.puts("✓  Created #{project.slug} (github tracker + workflow_markdown)")

          {:error, reason} ->
            halt!("Created #{slug} but failed to save setup: #{inspect(reason)}")
        end

      {:error, reason} ->
        halt!("Create failed for #{slug}: #{inspect(reason)}")
    end
  end

  defp github_section(%{"github" => %{"repo" => repo} = gh}) when is_binary(repo) and repo != "" do
    project_id =
      case get_in(gh, ["project", "id"]) do
        id when is_binary(id) and id != "" -> id
        _ -> halt!("github.project.id missing in workflow for repo #{repo}")
      end

    {:ok,
     %{
       "repo" => repo,
       "project_id" => project_id,
       "status_field" => Map.get(gh, "status_field") || "Status"
     }}
  end

  defp github_section(_), do: {:error, :missing_github_section}

  defp repositories_for("macro-markets", _config) do
    [
      repo_attrs("clouapp/front", "front", "homolog", "frontend"),
      repo_attrs("clouapp/back", "back", "dev", "backend")
    ]
  end

  defp repositories_for("distributionmachine", _config) do
    [repo_attrs("clouapp/distributionmachine", "distributionmachine", "main", "primary")]
  end

  defp repositories_for(_slug, _config), do: []

  defp repo_attrs(full_name, workspace_path, branch, role) do
    %{
      "github_full_name" => full_name,
      "clone_url" => "https://github.com/#{full_name}.git",
      "default_branch" => branch,
      "selected_branch" => branch,
      "workspace_path" => workspace_path,
      "role" => role
    }
  end

  defp after_create_hook(%{"hooks" => %{"after_create" => hook}}) when is_binary(hook), do: String.trim(hook)
  defp after_create_hook(_), do: nil

  defp validation_commands("macro-markets") do
    [
      "cd front && npm run lint",
      "cd front && npm run test:unit",
      "cd back && ./vibe test"
    ]
  end

  defp validation_commands("distributionmachine") do
    [
      "cd distributionmachine && python -m pytest",
      "cd distributionmachine && ruff check ."
    ]
  end

  defp validation_commands(_), do: []

  defp sync_workflow_statuses_from_github(%{tracker_kind: "github"} = project) do
    case IssueAdapter.list_statuses(project) do
      {:ok, statuses} ->
        LocalStore.upsert_statuses(project, statuses)
        :ok

      {:error, reason} ->
        IO.puts(:stderr, "  !  Could not sync statuses for #{project.slug}: #{inspect(reason)}")
        :ok
    end
  end

  defp sync_workflow_statuses_from_github(_project), do: :ok

  defp display_name(_config, default_name), do: default_name

  defp project_description("macro-markets"),
    do: "Macro Markets workspace — Next.js frontend (clouapp/front) + Laravel backend (clouapp/back)."

  defp project_description("distributionmachine"),
    do: "Distribution Machine — Python standalone (clouapp/distributionmachine)."

  defp project_description(_), do: nil

  defp workflow_files([]), do: @default_files

  defp workflow_files(paths) do
    Enum.map(paths, fn path ->
      slug = path |> Path.basename() |> String.replace_prefix("WORKFLOW.", "") |> String.replace_suffix(".md", "")
      name = slug |> String.replace("-", " ") |> String.split() |> Enum.map(&String.capitalize/1) |> Enum.join(" ")
      {path, slug, name}
    end)
  end

  defp start_repo! do
    Application.load(:symphony_elixir)

    for app <- [
          :logger,
          :crypto,
          :ssl,
          :exqlite,
          :ecto,
          :ecto_sql,
          :db_connection,
          :nimble_pool,
          :phoenix_pubsub
        ] do
      {:ok, _} = Application.ensure_all_started(app)
    end

    unless Process.whereis(SymphonyElixir.PubSub) do
      {:ok, _} =
        Supervisor.start_link(
          [{Phoenix.PubSub, name: SymphonyElixir.PubSub}],
          strategy: :one_for_one,
          name: Symphony.RestoreProjects.Supervisor
        )
    end

    case Repo.start_link() do
      {:ok, _} -> :ok
      {:error, {:already_started, _}} -> :ok
    end

    Ecto.Migrator.run(Repo, :up, all: true)
  end

  defp halt!(message) do
    IO.puts(:stderr, message)
    System.halt(1)
  end
end

argv = System.argv()
Symphony.RestoreProjectsFromWorkflows.run(argv)
