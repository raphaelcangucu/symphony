defmodule SymphonyElixir.Assistant.EvidenceToolsTest do
  use ExUnit.Case, async: true

  import SymphonyElixir.GitFixtures

  alias SymphonyElixir.Assistant.EvidenceTools
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
          evidence: %{required: false, repos: %{}}
        ],
        overrides
      )
    )
  end

  test "returns satisfied gate when evidence is not required", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-1")
    File.mkdir_p!(ws)
    issue = %Issue{id: "1", identifier: "GAM-1", project_slug: "gam"}

    assert {:ok, result} =
             EvidenceTools.execute("gam", %{"identifier" => "GAM-1"},
               issue: issue,
               project_config: config(),
               workspace: ws,
               list_runs: fn _slug, _id -> {:ok, []} end
             )

    assert result.tool == "get_evidence_status"
    assert result.data.required == false
    assert result.data.gate.satisfied == true
    assert result.data.runs == []
    assert result.data.manifest_path == ".symphony/evidence/manifest.json"
    assert result.data.workspace_path == ws
  end

  test "returns gate violations when manifest is missing", %{tmp_dir: tmp_dir} do
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
             EvidenceTools.execute("gam", %{"identifier" => "GAM-9"},
               issue: issue,
               project_config: cfg,
               workspace: ws,
               list_runs: fn _slug, _id -> {:ok, []} end
             )

    assert result.data.required == true
    assert result.data.gate.satisfied == false
    assert Enum.any?(result.data.gate.violations, &(&1["kind"] == "manifest_missing"))
  end

  test "includes persisted runs from store" do
    issue = %Issue{id: "1", identifier: "GAM-2", project_slug: "gam"}
    now = DateTime.utc_now(:second)

    run = %{
      id: 1,
      run_id: "run-1",
      session_id: "sess-1",
      status: "passed",
      ui_change: false,
      manifest: %{"runs" => [%{"kind" => "unit", "repo" => "frontend", "command" => "yarn test"}]},
      inserted_at: now
    }

    assert {:ok, result} =
             EvidenceTools.execute("gam", %{"identifier" => "GAM-2"},
               issue: issue,
               project_config: config(),
               workspace: "/tmp/ws",
               list_runs: fn _slug, _id -> {:ok, [run]} end
             )

    assert [%{run_id: "run-1", status: "passed"}] = result.data.runs
  end
end
