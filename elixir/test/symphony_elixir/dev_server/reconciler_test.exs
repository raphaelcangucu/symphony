defmodule SymphonyElixir.DevServer.ReconcilerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServer.Reconciler
  alias SymphonyElixir.Issue
  alias SymphonyElixir.LocalTracker.{IssueRecord, Project}

  describe "reconcile/2" do
    test "selects human-review issues when configured" do
      candidates = %{
        human_review: ["LOC-1", "LOC-2"],
        pull_request: ["LOC-3"]
      }

      assert Reconciler.reconcile(["human_review"], candidates) == ["LOC-1", "LOC-2"]
    end

    test "unions pull_request and human_review without duplicates" do
      candidates = %{
        human_review: ["LOC-1", "LOC-2"],
        pull_request: ["LOC-2", "LOC-3"]
      }

      assert Reconciler.reconcile(["pull_request", "human_review"], candidates) == [
               "LOC-2",
               "LOC-3",
               "LOC-1"
             ]
    end

    test "returns an empty list when no triggers are configured" do
      candidates = %{
        human_review: ["LOC-1"],
        pull_request: ["LOC-2"]
      }

      assert Reconciler.reconcile([], candidates) == []
    end
  end

  describe "candidates/3" do
    test "does not resolve pull-request candidates when pull_request is not configured" do
      issues = [%Issue{identifier: "LOC-1"}]

      candidates =
        Reconciler.candidates(["human_review"], issues,
          pull_request_reader: fn _repo, _identifier ->
            raise "pull request reader should not be called"
          end,
          repo_resolver: fn _issue ->
            raise "repo resolver should not be called"
          end
        )

      assert candidates == %{human_review: ["LOC-1"]}
    end

    test "does not build human-review candidates when human_review is not configured" do
      issues = [%Issue{identifier: "LOC-1"}]

      candidates =
        Reconciler.candidates(["pull_request"], issues,
          repo_resolver: fn %Issue{identifier: "LOC-1"} -> {:ok, "acme/app"} end,
          pull_request_reader: fn "acme/app", "LOC-1" -> {:ok, [%{number: 1}]} end
        )

      assert candidates == %{pull_request: ["LOC-1"]}
    end
  end

  describe "project_slug_for/2" do
    test "extracts project slug from local tracker issue record preloads" do
      issue = %IssueRecord{project: %Project{slug: "macro-markets"}}

      assert Reconciler.project_slug_for(issue) == "macro-markets"
    end

    test "extracts project slug from DTO-style issue maps" do
      assert Reconciler.project_slug_for(%{project_slug: "macro-markets"}) == "macro-markets"
      assert Reconciler.project_slug_for(%{"project_slug" => "macro-markets"}) == "macro-markets"
    end

    test "can resolve project slug from project_id through an injected lookup" do
      issue = %IssueRecord{project_id: 123}

      assert Reconciler.project_slug_for(issue,
               project_lookup_by_id: fn 123 -> {:ok, %Project{slug: "macro-markets"}} end
             ) == "macro-markets"
    end

    test "falls back to configured local project slug for normalized tracker issues" do
      issue = %Issue{identifier: "LOC-1"}

      assert Reconciler.project_slug_for(issue, local_project_slug: "macro-markets") == "macro-markets"
    end
  end

  describe "repo_for/2" do
    test "extracts repo from a GitHub-backed local project struct" do
      issue = %{
        project: %Project{
          tracker_kind: "github",
          tracker_config: %{"repo" => "acme/app", "project_id" => "PVT_1"}
        }
      }

      assert Reconciler.repo_for(issue) == {:ok, "acme/app"}
    end

    test "extracts repo from a GitHub-backed local project map" do
      issue = %{
        project: %{
          tracker_kind: "github",
          tracker_config: %{"repo" => "acme/app"}
        }
      }

      assert Reconciler.repo_for(issue) == {:ok, "acme/app"}
    end

    test "falls back through local project lookup for normalized local tracker issues" do
      issue = %Issue{identifier: "LOC-1"}
      project = %Project{tracker_kind: "github", tracker_config: %{"repo" => "acme/app"}}

      assert Reconciler.repo_for(issue,
               local_project_slug: "macro-markets",
               project_lookup: fn "macro-markets" -> {:ok, project} end
             ) == {:ok, "acme/app"}
    end

    test "falls back to global GitHub repo config for normalized GitHub tracker issues" do
      issue = %Issue{identifier: "123"}

      assert Reconciler.repo_for(issue,
               tracker_kind: "github",
               github_repo: fn -> "acme/app" end
             ) == {:ok, "acme/app"}
    end

    test "returns an error instead of crashing when no GitHub repo is available" do
      issue = %Issue{identifier: "LOC-1"}

      assert {:error, _reason} =
               Reconciler.repo_for(issue,
                 local_project_slug: nil,
                 tracker_kind: "local"
               )
    end
  end
end
