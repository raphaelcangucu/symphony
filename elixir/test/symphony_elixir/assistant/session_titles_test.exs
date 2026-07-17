defmodule SymphonyElixir.Assistant.SessionTitlesTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.SessionTitles

  test "issue_session and issue_execution prefixes" do
    assert SessionTitles.default_title("issue_session",
             identifier: "GAM-20",
             issue_title: "Fix login race"
           ) == "Chat · GAM-20 · Fix login race"

    assert SessionTitles.default_title("issue_execution",
             identifier: "GAM-20",
             issue_title: "Fix login race"
           ) == "Run · GAM-20 · Fix login race"

    assert SessionTitles.default_title("issue_session", identifier: "GAM-20", issue_title: nil) ==
             "Chat · GAM-20"
  end

  test "workspace / explore / freeform / kb" do
    assert SessionTitles.default_title("project_session", workspace_name: "spike") ==
             "Workspace · spike"

    assert SessionTitles.default_title("project_explore", project_name: "Demo") ==
             "Explore · Demo"

    assert SessionTitles.default_title("freeform", []) == "Chat"

    assert SessionTitles.default_title("kb", page_title: "Runbook") == "KB · Runbook"
  end
end
