defmodule SymphonyElixir.Assistant.GitHubAuthoringTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.GitHubAuthoring
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Repo

  setup do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    :ok
  end

  test "returns empty for non-GitHub projects" do
    assert GitHubAuthoring.create_issue_guidance(%Project{tracker_kind: "jira", slug: "x"}) == ""
  end

  test "multi-repo guidance lists linked repositories and repository param" do
    {:ok, _} = Context.ensure_project(%{name: "XIP", slug: "xip-guidance"})

    {:ok, _} =
      Context.replace_repositories("xip-guidance", [
        %{"github_full_name" => "xipcash/admin", "workspace_path" => "admin", "role" => "frontend"},
        %{"github_full_name" => "xipcash/backend", "workspace_path" => "backend", "role" => "backend"}
      ])

    project = %Project{
      slug: "xip-guidance",
      tracker_kind: "github",
      tracker_config: %{"repo" => "xipcash/admin"}
    }

    text = GitHubAuthoring.create_issue_guidance(project)

    assert text =~ "multi-repo"
    assert text =~ "list_project_repositories"
    assert text =~ "repository: \"owner/name\""
    assert text =~ "xipcash/backend"
    assert text =~ "xipcash/admin"
    assert text =~ "xipcash/admin` — used only when"
  end

  test "single-repo guidance mentions default repo only" do
    project = %Project{
      slug: "solo",
      tracker_kind: "github",
      tracker_config: %{"repo" => "org/app"}
    }

    text = GitHubAuthoring.create_issue_guidance(project)
    assert text =~ "single repo"
    assert text =~ "org/app"
    refute text =~ "multi-repo"
  end
end
