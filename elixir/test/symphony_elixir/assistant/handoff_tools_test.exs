defmodule SymphonyElixir.Assistant.HandoffToolsTest do
  use ExUnit.Case, async: true

  import SymphonyElixir.GitFixtures

  alias SymphonyElixir.Assistant.HandoffTools
  alias SymphonyElixir.Issue
  alias SymphonyElixir.ProjectConfig

  @moduletag :tmp_dir

  defp config(overrides \\ []) do
    struct!(
      ProjectConfig,
      Keyword.merge(
        [
          project_id: "proj-1",
          project_slug: "gam",
          tracker_kind: "github",
          wait_states: ["Human Review"],
          completion_transitions: %{"In Progress" => "Human Review"},
          evidence: %{required: false, repos: %{}}
        ],
        overrides
      )
    )
  end

  test "assistant tool spec requires identifier" do
    spec = HandoffTools.assistant_tool_spec()

    assert spec["name"] == "check_handoff_gate"
    assert "identifier" in spec["inputSchema"]["required"]
  end

  test "issue-bound tool spec has no required fields" do
    spec = HandoffTools.issue_bound_tool_spec()

    assert spec["name"] == "check_handoff_gate"
    assert spec["inputSchema"]["required"] == []
  end

  test "returns ready when both gates pass", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-1")
    File.mkdir_p!(ws)
    issue = %Issue{id: "1", identifier: "GAM-1", project_slug: "gam"}

    assert {:ok, result} =
             HandoffTools.execute("gam", %{"identifier" => "GAM-1"},
               issue: issue,
               project_config: config(),
               workspace: ws
             )

    assert result.tool == "check_handoff_gate"
    assert result.data.ready == true
    assert result.data.validate_gate.satisfied == true
    assert result.data.publish_gate.satisfied == true
    assert result.data.environment_blocked_only == false
    assert "Human Review" in result.data.target_statuses.wait_states
    assert "Human Review" in result.data.target_statuses.completion_destinations
  end

  test "returns validate violations when manifest is missing", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "frontend")

    sh!(repo, """
    git checkout -b feat/x && mkdir -p src &&
    echo a > src/App.tsx &&
    git add -A && git commit -m work
    """)

    issue = %Issue{id: "1", identifier: "GAM-9", project_slug: "gam"}
    cfg = config(evidence: %{required: true, repos: %{"frontend" => %{unit_command: "yarn test"}}})

    assert {:ok, result} =
             HandoffTools.execute("gam", %{"identifier" => "GAM-9"},
               issue: issue,
               project_config: cfg,
               workspace: ws
             )

    assert result.data.ready == false
    assert result.data.validate_gate.satisfied == false
    assert Enum.any?(result.data.validate_gate.violations, &(&1["kind"] == "manifest_missing"))
  end

  test "uses bound issue without identifier argument", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-2")
    File.mkdir_p!(ws)
    issue = %Issue{id: "1", identifier: "GAM-2", project_slug: "gam"}

    assert {:ok, result} =
             HandoffTools.execute("gam", %{},
               issue: issue,
               project_config: config(),
               workspace: ws
             )

    assert result.data.ready == true
  end

  test "tolerates nil completion_transitions without crashing", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-NIL")
    File.mkdir_p!(ws)
    issue = %Issue{id: "1", identifier: "GAM-NIL", project_slug: "gam"}

    assert {:ok, result} =
             HandoffTools.execute("gam", %{"identifier" => "GAM-NIL"},
               issue: issue,
               project_config: config(completion_transitions: nil),
               workspace: ws
             )

    assert result.data.target_statuses.completion_destinations == []
    assert "Human Review" in result.data.target_statuses.wait_states
  end
end
