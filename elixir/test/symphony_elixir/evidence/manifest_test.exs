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

  test "referenced artifact missing on disk", %{tmp_dir: ws} do
    write_manifest!(ws, valid_manifest())
    assert {:error, {:artifacts_missing, missing}} = Manifest.read(ws)
    assert "artifacts/unit.txt" in missing
  end

  test "artifact_paths collects reports, screenshots, videos and traces" do
    {:ok, manifest} = build_valid_in_tmp()
    paths = Manifest.artifact_paths(manifest)
    assert "artifacts/unit.txt" in paths
    assert "artifacts/screens/home.png" in paths
    assert "artifacts/videos/flow.webm" in paths
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
