defmodule SymphonyElixir.GitHub.ConfigTest do
  use SymphonyElixir.TestSupport, async: false

  alias SymphonyElixir.GitHub.Config
  alias SymphonyElixir.Workflow

  describe "project getters with defaults" do
    setup do
      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "github",
        tracker_repo: "raphaelcangucu/symphony"
      )

      :ok
    end

    test "project_mode/0 defaults to auto" do
      assert Config.project_mode() == "auto"
    end

    test "project_title/0 defaults to Symphony" do
      assert Config.project_title() == "Symphony"
    end

    test "status_field/0 defaults to Symphony State" do
      assert Config.status_field() == "Symphony State"
    end

    test "admission_label/0 defaults to symphony" do
      assert Config.admission_label() == "symphony"
    end

    test "project_id/0 returns nil when unset" do
      assert Config.project_id() == nil
    end

    test "project_number/0 returns nil when unset" do
      assert Config.project_number() == nil
    end
  end

  describe "project getters with explicit values" do
    setup do
      write_workflow_file!(Workflow.workflow_file_path(),
        tracker_kind: "github",
        tracker_repo: "raphaelcangucu/symphony",
        github_project_mode: "existing",
        github_project_title: "Custom Board",
        github_project_id: "PVT_kwDOABC",
        github_project_number: 7,
        github_status_field: "Workflow",
        github_admission_label: "agent"
      )

      :ok
    end

    test "project_mode/0 reads explicit value" do
      assert Config.project_mode() == "existing"
    end

    test "project_title/0 reads explicit value" do
      assert Config.project_title() == "Custom Board"
    end

    test "project_id/0 reads explicit value" do
      assert Config.project_id() == "PVT_kwDOABC"
    end

    test "project_number/0 reads explicit integer" do
      assert Config.project_number() == 7
    end

    test "status_field/0 reads explicit value" do
      assert Config.status_field() == "Workflow"
    end

    test "admission_label/0 reads explicit value" do
      assert Config.admission_label() == "agent"
    end
  end
end
