defmodule SymphonyElixir.AgentHandoffGateTest do
  use ExUnit.Case, async: true

  import SymphonyElixir.GitFixtures

  alias SymphonyElixir.AgentHandoffGate
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
          evidence: %{required: true, repos: %{"frontend" => %{unit_command: "yarn test"}}}
        ],
        overrides
      )
    )
  end

  test "handoff_status? is true for wait states and completion destinations" do
    cfg = config()

    assert AgentHandoffGate.handoff_status?("Human Review", cfg)
    assert AgentHandoffGate.handoff_status?("human review", cfg)
    refute AgentHandoffGate.handoff_status?("In Progress", cfg)
  end

  test "handoff_status? is false when completion_transitions is nil" do
    cfg = config(completion_transitions: nil, wait_states: ["Human Review"])

    refute AgentHandoffGate.handoff_status?("In Progress", cfg)
    assert AgentHandoffGate.handoff_status?("Human Review", cfg)
  end

  test "check passes when evidence is not required" do
    issue = %Issue{id: "1", identifier: "GAM-1", project_slug: "gam"}
    cfg = config(evidence: %{required: false, repos: %{}})

    assert :ok = AgentHandoffGate.check(issue, cfg)
  end

  test "check fails validate gate when manifest is missing and repos changed", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "frontend")

    sh!(repo, """
    git checkout -b feat/x && mkdir -p src &&
    echo a > src/App.tsx &&
    git add -A && git commit -m work
    """)

    issue = %Issue{id: "1", identifier: "GAM-9", project_slug: "gam"}
    cfg = config()

    assert {:error, :validate_gate, violations} = AgentHandoffGate.check(issue, cfg, workspace: ws)
    assert Enum.any?(violations, &(&1.kind == :manifest_missing))
  end

  test "check_validate and check_publish can be evaluated independently", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-10")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "frontend")

    sh!(repo, """
    git checkout -b feat/x && mkdir -p src &&
    echo a > src/App.tsx &&
    git add -A && git commit -m work
    """)

    issue = %Issue{id: "1", identifier: "GAM-10", project_slug: "gam"}
    cfg = config()

    assert {:error, :validate_gate, validate_violations} =
             AgentHandoffGate.check_validate(issue, cfg, workspace: ws)

    assert Enum.any?(validate_violations, &(&1.kind == :manifest_missing))

    assert {:error, :publish_gate, publish_violations} =
             AgentHandoffGate.check_publish(issue, cfg, workspace: ws)

    assert Enum.any?(publish_violations, &(&1.kind == :unpublished_branch))
  end

  test "check_publish passes on an empty workspace", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "empty")
    File.mkdir_p!(ws)
    issue = %Issue{id: "1", identifier: "GAM-11", project_slug: "gam"}
    cfg = config(evidence: %{required: false, repos: %{}})

    assert :ok = AgentHandoffGate.check_publish(issue, cfg, workspace: ws)
  end
end
