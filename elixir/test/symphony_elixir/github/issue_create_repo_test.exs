defmodule SymphonyElixir.GitHub.IssueCreateRepoTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.GitHub.IssueCreateRepo
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Repo

  setup do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)

    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    :ok
  end

  defp project do
    %Project{
      slug: "gamba",
      tracker_kind: "github",
      tracker_config: %{"repo" => "GambaLabs/frontend", "project_id" => "PVT_1"}
    }
  end

  test "explicit repository wins over tracker.config.repo" do
    {:ok, _} = Context.ensure_project(%{name: "Gamba", slug: "gamba"})

    {:ok, _} =
      Context.replace_repositories("gamba", [
        %{"github_full_name" => "GambaLabs/frontend", "workspace_path" => "frontend", "role" => "primary"},
        %{"github_full_name" => "GambaLabs/backend", "workspace_path" => "backend", "role" => "backend"}
      ])

    assert {:ok, "GambaLabs/backend"} =
             IssueCreateRepo.resolve(project(), %{
               "repository" => "GambaLabs/backend",
               "title" => "API task"
             })
  end

  test "rejects repository not linked to the project" do
    {:ok, _} = Context.ensure_project(%{name: "Gamba", slug: "gamba"})

    {:ok, _} =
      Context.replace_repositories("gamba", [
        %{"github_full_name" => "GambaLabs/frontend", "workspace_path" => "frontend", "role" => "primary"}
      ])

    assert {:error, {:invalid_repository, message}} =
             IssueCreateRepo.resolve(project(), %{"repository" => "GambaLabs/backend", "title" => "Nope"})

    assert message =~ "not linked"
  end

  test "infers repo from area label suffix" do
    {:ok, _} = Context.ensure_project(%{name: "XIP", slug: "xip"})

    project = %{
      project()
      | slug: "xip",
        tracker_config: %{"repo" => "xipcash/admin", "project_id" => "PVT_XIP"}
    }

    {:ok, _} =
      Context.replace_repositories("xip", [
        %{"github_full_name" => "xipcash/admin", "workspace_path" => "admin", "role" => "frontend"},
        %{"github_full_name" => "xipcash/backend", "workspace_path" => "backend", "role" => "backend"}
      ])

    assert {:ok, "xipcash/backend"} =
             IssueCreateRepo.resolve(project, %{"label_ids" => ["area:backend"], "title" => "API"})
  end

  test "falls back to tracker.config.repo when no explicit repo" do
    assert {:ok, "GambaLabs/frontend"} =
             IssueCreateRepo.resolve(project(), %{"title" => "Frontend task"})
  end
end
