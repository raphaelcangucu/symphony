defmodule SymphonyElixir.Assistant.SetupToolsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.SetupTools
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    :ok
  end

  test "scan_project_setup loads repos from project when repositories omitted" do
    {:ok, _} =
      Context.create_workspace_project(%{
        "name" => "Setup",
        "slug" => "setup-test",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [
          %{"github_full_name" => "acme/web", "workspace_path" => "setup-test/web", "role" => "frontend"}
        ],
        "setup" => %{}
      })

    scanner = fn repo ->
      send(self(), {:scan, repo})
      {:ok, %{workspace_path: Map.get(repo, "workspace_path"), stack: ["node"]}}
    end

    assert {:ok, result} = SetupTools.execute("scan_project_setup", "setup-test", %{}, scanner: scanner)

    assert result.tool == "scan_project_setup"
    assert [%{stack: ["node"]}] = result.data.scans
    assert_received {:scan, %{"github_full_name" => "acme/web"}}
  end

  test "suggest_project_setup calls WorkflowSuggester with provided scans" do
    repositories = [
      %{
        "github_full_name" => "acme/web",
        "clone_url" => "https://github.com/acme/web.git",
        "selected_branch" => "main",
        "workspace_path" => "frontend",
        "role" => "frontend"
      }
    ]

    scans = [%{workspace_path: "frontend", stack: ["node"], validation_commands: ["pnpm test"]}]

    assert {:ok, result} =
             SetupTools.execute("suggest_project_setup", "setup-test", %{
               "repositories" => repositories,
               "scans" => scans
             })

    assert result.tool == "suggest_project_setup"
    assert is_binary(result.data.workflow_markdown)
    assert is_list(result.data.workflow_statuses)
  end

  test "suggest_project_setup runs implicit scan when scans omitted" do
    {:ok, _} =
      Context.create_workspace_project(%{
        "name" => "Suggest",
        "slug" => "suggest-test",
        "workflow_statuses" => [%{"name" => "Todo", "category" => "active", "position" => 0, "is_terminal" => false}],
        "repositories" => [
          %{"github_full_name" => "acme/api", "workspace_path" => "suggest-test/api", "role" => "backend"}
        ],
        "setup" => %{}
      })

    scanner = fn repo ->
      {:ok, %{workspace_path: Map.get(repo, "workspace_path"), stack: ["elixir"], validation_commands: ["mix test"]}}
    end

    assert {:ok, result} =
             SetupTools.execute("suggest_project_setup", "suggest-test", %{}, scanner: scanner)

    assert result.tool == "suggest_project_setup"
    assert result.data.workflow_markdown =~ "tracker:"
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end

  defp clean_repo do
    for table <- [
          "local_tracker_dev_env_step_runs",
          "local_tracker_dev_env_runs",
          "local_tracker_dev_env_steps",
          "local_tracker_repositories",
          "local_tracker_projects"
        ] do
      Ecto.Adapters.SQL.query!(Repo, "DELETE FROM #{table}", [])
    end
  end
end
