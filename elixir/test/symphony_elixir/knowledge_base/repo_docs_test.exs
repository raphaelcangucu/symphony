defmodule SymphonyElixir.KnowledgeBase.RepoDocsTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.KnowledgeBase.RepoDocs
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    clean_repo()
    root = configure_isolated_workspace_root()

    {:ok, _project} =
      Context.create_workspace_project(%{
        "name" => "Acme",
        "slug" => "acme",
        "tracker" => %{"kind" => "local"},
        "repositories" => [
          %{"github_full_name" => "acme/web", "workspace_path" => "web", "role" => "frontend"},
          %{"github_full_name" => "acme/api", "workspace_path" => "services/api", "role" => "backend"}
        ],
        "setup" => %{}
      })

    File.mkdir_p!(Path.join([root, "acme", "web", "docs"]))
    {:ok, root: root}
  end

  test "lists repositories with docs detection and reversible repo_slug", %{root: _root} do
    repos = RepoDocs.list_repositories("acme")

    by_slug = Map.new(repos, &{&1.repo_slug, &1})
    assert by_slug["web"].docs_present? == true
    assert by_slug["web"].workspace_path == "web"
    assert by_slug["services~api"].docs_present? == false
    assert by_slug["services~api"].workspace_path == "services/api"
  end

  test "fetch_repository resolves by repo_slug" do
    assert {:ok, repo} = RepoDocs.fetch_repository("acme", "services~api")
    assert repo.workspace_path == "services/api"
    assert RepoDocs.fetch_repository("acme", "missing") == {:error, :repo_not_found}
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo, do: SymphonyElixir.TestSupport.truncate_tracker!(Repo)

  defp configure_isolated_workspace_root do
    root = Path.join(System.tmp_dir!(), "kb-repodocs-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    workflow = Path.join(root, "WORKFLOW.md")
    SymphonyElixir.TestSupport.write_workflow_file!(workflow, workspace_root: root)
    SymphonyElixir.Workflow.set_workflow_file_path(workflow)

    on_exit(fn ->
      File.rm_rf(root)
      Application.delete_env(:symphony_elixir, :workflow_file_path)
    end)

    root
  end
end
