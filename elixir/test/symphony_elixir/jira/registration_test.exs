defmodule SymphonyElixir.Jira.RegistrationTest do
  use SymphonyElixir.TestSupport, async: false

  alias SymphonyElixir.Workflow

  setup do
    write_workflow_file!(Workflow.workflow_file_path(),
      tracker_kind: "jira",
      jira_base_url: "https://acme.atlassian.net",
      jira_email: "bot@acme.com",
      jira_api_token: "tok",
      jira_project_key: "ABC"
    )

    :ok
  end

  test "Config.tracker_kind detects the jira section" do
    assert SymphonyElixir.Config.tracker_kind() == "jira"
  end

  test "Tracker.adapter resolves to Jira.Tracker" do
    assert SymphonyElixir.Tracker.adapter() == SymphonyElixir.Jira.Tracker
  end
end
