defmodule SymphonyElixir.Evidence.ManifestTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Evidence.Manifest

  @moduletag :tmp_dir

  defp write_manifest!(workspace, map) do
    dir = Path.join(workspace, ".symphony/evidence")
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "manifest.json"), Jason.encode!(map))
  end

  defp valid_manifest do
    %{
      "issue" => "GAM-9",
      "generated_at" => "2026-06-10T00:00:00-03:00",
      "ui_change" => true,
      "runs" => [
        %{
          "kind" => "unit",
          "repo" => "frontend",
          "command" => "npm test",
          "status" => "passed",
          "summary" => %{"total" => 3, "passed" => 3, "failed" => 0},
          "report" => "artifacts/unit.txt"
        },
        %{
          "kind" => "e2e",
          "repo" => "frontend",
          "command" => "npx playwright test",
          "status" => "passed",
          "summary" => %{"total" => 1, "passed" => 1, "failed" => 0},
          "report" => "artifacts/report/",
          "screenshots" => ["artifacts/screens/home.png"],
          "videos" => ["artifacts/videos/flow.webm"]
        }
      ]
    }
  end

  defp touch_artifacts!(workspace) do
    base = Path.join(workspace, ".symphony/evidence")

    relative_paths = [
      "artifacts/unit.txt",
      "artifacts/report/index.html",
      "artifacts/screens/home.png",
      "artifacts/videos/flow.webm"
    ]

    for rel <- relative_paths do
      path = Path.join(base, rel)
      File.mkdir_p!(Path.dirname(path))
      File.write!(path, "x")
    end
  end

  test "reads a valid manifest with existing artifacts", %{tmp_dir: ws} do
    write_manifest!(ws, valid_manifest())
    touch_artifacts!(ws)

    assert {:ok, manifest} = Manifest.read(ws)
    assert manifest.issue == "GAM-9"
    assert manifest.ui_change
    assert [%{kind: "unit"}, %{kind: "e2e"}] = manifest.runs
  end

  test "missing manifest", %{tmp_dir: ws} do
    assert {:error, :manifest_missing} = Manifest.read(ws)
  end

  test "reads a manifest an agent wrote inside a repo subdir", %{tmp_dir: ws} do
    repo = Path.join(ws, "back")
    write_manifest!(repo, valid_manifest())
    touch_artifacts!(repo)

    assert {:ok, manifest} = Manifest.read(ws)
    assert manifest.issue == "GAM-9"
  end

  test "resolve_dir prefers the workspace root over a repo subdir", %{tmp_dir: ws} do
    write_manifest!(ws, valid_manifest())
    write_manifest!(Path.join(ws, "back"), valid_manifest())

    assert Manifest.resolve_dir(ws) == Path.join(ws, ".symphony/evidence")
  end

  test "resolve_dir falls back to the canonical dir when nothing exists", %{tmp_dir: ws} do
    assert Manifest.resolve_dir(ws) == Path.join(ws, ".symphony/evidence")
  end

  test "resolve_dir ignores dot-directories like .worktrees", %{tmp_dir: ws} do
    write_manifest!(Path.join(ws, ".worktrees/combined"), valid_manifest())

    assert Manifest.resolve_dir(ws) == Path.join(ws, ".symphony/evidence")
  end

  test "invalid json", %{tmp_dir: ws} do
    dir = Path.join(ws, ".symphony/evidence")
    File.mkdir_p!(dir)
    File.write!(Path.join(dir, "manifest.json"), "{nope")
    assert {:error, {:manifest_invalid, _reason}} = Manifest.read(ws)
  end

  test "run missing required fields", %{tmp_dir: ws} do
    write_manifest!(ws, %{"issue" => "GAM-9", "runs" => [%{"kind" => "unit"}]})
    assert {:error, {:manifest_invalid, reasons}} = Manifest.read(ws)
    assert Enum.any?(reasons, &(&1 =~ "repo"))
  end

  test "parses a blocked run with blocked_reason", %{tmp_dir: ws} do
    write_manifest!(ws, %{
      "issue" => "GAM-9",
      "runs" => [
        %{
          "kind" => "unit",
          "repo" => "backend",
          "command" => "./vibe test",
          "status" => "blocked",
          "blocked_reason" => "Docker daemon unreachable in sandbox"
        }
      ]
    })

    assert {:ok, %{runs: [run]}} = Manifest.read(ws)
    assert run.status == "blocked"
    assert run.blocked_reason == "Docker daemon unreachable in sandbox"
  end

  test "parses optional task metadata on runs", %{tmp_dir: ws} do
    write_manifest!(ws, %{
      "issue" => "GAM-9",
      "runs" => [
        %{
          "task_id" => "task-3",
          "task_title" => "Task 3: Add Tasks, Review, And Runs Namespace",
          "kind" => "unit",
          "repo" => "admin",
          "command" => "bun run test -- tasks",
          "status" => "passed"
        }
      ]
    })

    assert {:ok, %{runs: [run]}} = Manifest.read(ws)
    assert run.task_id == "task-3"
    assert run.task_title == "Task 3: Add Tasks, Review, And Runs Namespace"
  end

  test "referenced artifact missing on disk", %{tmp_dir: ws} do
    write_manifest!(ws, valid_manifest())
    assert {:error, {:artifacts_missing, missing}} = Manifest.read(ws)
    assert "artifacts/unit.txt" in missing
  end

  test "parses cross-repo impact decisions", %{tmp_dir: ws} do
    manifest =
      valid_manifest()
      |> Map.put("impact", [
        %{"from" => "backend", "to" => "frontend", "impacts_ui" => false, "rationale" => "internal only"},
        %{"from" => "goapi", "to" => "frontend", "impacts_ui" => true}
      ])

    write_manifest!(ws, manifest)
    touch_artifacts!(ws)

    assert {:ok, %{impact: impact}} = Manifest.read(ws)

    assert %{from: "backend", to: "frontend", impacts_ui: false, rationale: "internal only"} in impact
    assert %{from: "goapi", to: "frontend", impacts_ui: true, rationale: nil} in impact
  end

  test "impacts_ui=false without a rationale is invalid", %{tmp_dir: ws} do
    manifest =
      valid_manifest()
      |> Map.put("impact", [%{"from" => "backend", "to" => "frontend", "impacts_ui" => false}])

    write_manifest!(ws, manifest)

    assert {:error, {:manifest_invalid, reasons}} = Manifest.read(ws)
    assert Enum.any?(reasons, &(&1 =~ "rationale"))
  end

  test "impact entry missing from/to is invalid", %{tmp_dir: ws} do
    manifest =
      valid_manifest()
      |> Map.put("impact", [%{"to" => "frontend", "impacts_ui" => true}])

    write_manifest!(ws, manifest)

    assert {:error, {:manifest_invalid, reasons}} = Manifest.read(ws)
    assert Enum.any?(reasons, &(&1 =~ "from"))
  end

  test "artifact_paths collects reports, screenshots, videos and traces" do
    {:ok, manifest} = build_valid_in_tmp()
    paths = Manifest.artifact_paths(manifest)
    assert "artifacts/unit.txt" in paths
    assert "artifacts/screens/home.png" in paths
    assert "artifacts/videos/flow.webm" in paths
  end

  test "parses navigations and proof on an e2e run", %{tmp_dir: ws} do
    manifest =
      valid_manifest()
      |> update_in(["runs"], fn [unit, e2e] ->
        [unit, Map.merge(e2e, %{"navigations" => ["http://cwu.localhost:4302/students"], "proof" => %{"title" => "Student Groups"}})]
      end)

    write_manifest!(ws, manifest)
    touch_artifacts!(ws)

    assert {:ok, %{runs: [_unit, e2e]}} = Manifest.read(ws)
    assert e2e.navigations == ["http://cwu.localhost:4302/students"]
    assert e2e.proof == %{"title" => "Student Groups"}
  end

  test "parses labeled screenshot and video artifact refs", %{tmp_dir: ws} do
    manifest =
      valid_manifest()
      |> update_in(["runs"], fn [unit, e2e] ->
        [
          unit,
          Map.merge(e2e, %{
            "screenshots" => [
              %{
                "path" => "artifacts/screens/home.png",
                "label" => "long share dialog header real app",
                "navigations" => ["http://localhost:4300/health", "http://localhost:4300/login"]
              }
            ],
            "videos" => [
              %{
                "path" => "artifacts/videos/flow.webm",
                "label" => "save group shares real app"
              }
            ]
          })
        ]
      end)

    write_manifest!(ws, manifest)
    touch_artifacts!(ws)

    assert {:ok, %{runs: [_unit, e2e]}} = Manifest.read(ws)

    assert [%Manifest.ArtifactRef{path: "artifacts/screens/home.png", label: "long share dialog header real app", navigations: navs}] =
             e2e.screenshots

    assert navs == ["http://localhost:4300/health", "http://localhost:4300/login"]
    assert [%Manifest.ArtifactRef{path: "artifacts/videos/flow.webm", label: "save group shares real app"}] = e2e.videos
  end

  test "navigations defaults to [] and proof to %{} when absent", %{tmp_dir: ws} do
    write_manifest!(ws, valid_manifest())
    touch_artifacts!(ws)

    assert {:ok, %{runs: [_unit, e2e]}} = Manifest.read(ws)
    assert e2e.navigations == []
    assert e2e.proof == %{}
  end

  test "navigations must be a list of strings", %{tmp_dir: ws} do
    manifest =
      valid_manifest()
      |> update_in(["runs"], fn [unit, e2e] -> [unit, Map.put(e2e, "navigations", "nope")] end)

    write_manifest!(ws, manifest)

    assert {:error, {:manifest_invalid, reasons}} = Manifest.read(ws)
    assert Enum.any?(reasons, &(&1 =~ "navigations"))
  end

  defp build_valid_in_tmp do
    ws = Path.join(System.tmp_dir!(), "manifest-#{System.unique_integer([:positive])}")
    File.mkdir_p!(ws)
    write_manifest!(ws, valid_manifest())
    touch_artifacts!(ws)
    on_exit_rm(ws)
    Manifest.read(ws)
  end

  defp on_exit_rm(path), do: ExUnit.Callbacks.on_exit(fn -> File.rm_rf!(path) end)
end
