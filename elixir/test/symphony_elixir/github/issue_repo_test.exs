defmodule SymphonyElixir.GitHub.IssueRepoTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.GitHub.IssueRepo
  alias SymphonyElixir.LocalTracker.{Context, IssueRecord}
  alias SymphonyElixir.Repo

  defmodule ClientStub do
    @moduledoc false

    def graphql(_query, variables, _opts) do
      send(self(), {:github_issue_lookup, variables})
      {:ok, %{"data" => %{"repository" => %{"issue" => %{"id" => "I_remote"}}}}}
    end
  end

  setup do
    migrate_repo()
    clean_repo()
    :ok
  end

  test "resolve uses local remote_number for non-GitHub local identifiers" do
    {:ok, project} =
      Context.ensure_project(%{
        name: "Gamba",
        slug: "gamba",
        tracker_kind: "github",
        tracker_config: %{"repo" => "GambaLabs/frontend", "project_id" => "PVT_test"}
      })

    {:ok, issue} = Context.create_issue(project.slug, %{title: "Local", status: "Todo"})

    issue
    |> IssueRecord.changeset(%{
      remote_number: 1_860,
      remote_url: "https://github.com/GambaLabs/frontend/issues/1860",
      url: "https://github.com/GambaLabs/frontend/issues/1860"
    })
    |> Repo.update!()

    assert IssueRepo.resolve(project, issue.identifier, client_module: ClientStub) == {:ok, "GambaLabs/frontend"}
    assert_received {:github_issue_lookup, %{"name" => "frontend", "number" => 1_860, "owner" => "GambaLabs"}}
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo -> Ecto.Migrator.run(repo, :up, all: true) end)
  end

  defp clean_repo do
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
  end
end
