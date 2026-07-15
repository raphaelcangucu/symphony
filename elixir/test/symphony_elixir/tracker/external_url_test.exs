defmodule SymphonyElixir.Tracker.ExternalUrlTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.ExternalUrl

  test "returns nil for local projects" do
    assert ExternalUrl.for(%Project{tracker_kind: "local", tracker_config: %{}}) == nil
  end

  test "builds linear project urls from project_slug" do
    project = %Project{
      tracker_kind: "linear",
      tracker_config: %{"project_slug" => "macro-markets"}
    }

    assert ExternalUrl.for(project) == "https://linear.app/project/macro-markets/issues"
  end

  test "prefers github project_url when present" do
    project = %Project{
      tracker_kind: "github",
      tracker_config: %{
        "project_url" => "https://github.com/orgs/clouapp/projects/2",
        "repo" => "clouapp/front",
        "project_number" => 2
      }
    }

    assert ExternalUrl.for(project) == "https://github.com/orgs/clouapp/projects/2"
  end

  test "builds github org project urls from repo and project_number" do
    project = %Project{
      tracker_kind: "github",
      tracker_config: %{"repo" => "clouapp/front", "project_number" => 2}
    }

    assert ExternalUrl.for(project) == "https://github.com/orgs/clouapp/projects/2"
  end

  test "builds github user project urls when owner_kind is user" do
    project = %Project{
      tracker_kind: "github",
      tracker_config: %{
        "repo" => "octocat/demo",
        "project_number" => 3,
        "owner_kind" => "user"
      }
    }

    assert ExternalUrl.for(project) == "https://github.com/users/octocat/projects/3"
  end

  test "falls back to github repo issues when project_number is missing and no project_id" do
    project = %Project{
      tracker_kind: "github",
      tracker_config: %{"repo" => "clouapp/front"}
    }

    assert ExternalUrl.for(project) == "https://github.com/clouapp/front/issues"
  end

  test "falls back to github repo issues when only project_id is known (no network lookup)" do
    project = %Project{
      tracker_kind: "github",
      tracker_config: %{
        "project_id" => "PVT_test",
        "repo" => "GambaLabs/frontend"
      }
    }

    assert ExternalUrl.for(project) == "https://github.com/GambaLabs/frontend/issues"
  end

  test "returns nil when github config has neither project_url nor repo" do
    project = %Project{
      tracker_kind: "github",
      tracker_config: %{"project_id" => "PVT_unknown"}
    }

    assert ExternalUrl.for(project) == nil
  end

  test "builds jira board urls from project_key and base_url" do
    project = %Project{
      tracker_kind: "jira",
      tracker_config: %{
        "project_key" => "ABC",
        "base_url" => "https://acme.atlassian.net"
      }
    }

    assert ExternalUrl.for(project) ==
             "https://acme.atlassian.net/jira/software/projects/ABC/boards"
  end
end
