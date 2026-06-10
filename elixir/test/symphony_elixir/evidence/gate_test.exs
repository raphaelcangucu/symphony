defmodule SymphonyElixir.Evidence.GateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Evidence.Gate
  alias SymphonyElixir.Evidence.Manifest
  alias SymphonyElixir.Evidence.Manifest.Run

  defp manifest(runs), do: %Manifest{issue: "GAM-9", runs: runs}

  defp unit(repo, status \\ "passed"),
    do: %Run{kind: "unit", repo: repo, command: "npm test", status: status}

  defp e2e(extra \\ []) do
    struct!(
      %Run{
        kind: "e2e",
        repo: "frontend",
        command: "npx playwright test",
        status: "passed",
        screenshots: ["s.png"],
        videos: ["v.webm"]
      },
      Map.new(extra)
    )
  end

  defp deps(overrides \\ []) do
    Map.merge(
      %{
        read_manifest: fn _ws -> {:ok, manifest([unit("frontend")])} end,
        changed_files: fn _ws -> %{"frontend" => ["src/App.tsx"]} end,
        audit: fn _commands, _opts -> :ok end
      },
      Map.new(overrides)
    )
  end

  @config %{required: true, ui_paths: ["frontend/src/**"]}

  test "disabled evidence is satisfied" do
    assert :satisfied = Gate.evaluate("/ws", %{required: false, ui_paths: []}, deps())
  end

  test "no changed repos is satisfied" do
    assert :satisfied = Gate.evaluate("/ws", @config, deps(changed_files: fn _ws -> %{} end))
  end

  test "missing manifest is a violation" do
    d = deps(read_manifest: fn _ws -> {:error, :manifest_missing} end)
    assert {:violations, [%{kind: :manifest_missing}]} = Gate.evaluate("/ws", @config, d)
  end

  test "invalid manifest is a violation" do
    d = deps(read_manifest: fn _ws -> {:error, {:manifest_invalid, "boom"}} end)
    assert {:violations, [%{kind: :manifest_invalid}]} = Gate.evaluate("/ws", @config, d)
  end

  test "changed repo without passing unit run" do
    d =
      deps(
        read_manifest: fn _ws -> {:ok, manifest([unit("frontend", "failed")])} end,
        changed_files: fn _ws -> %{"frontend" => ["src/x.ts"]} end
      )

    assert {:violations, [%{kind: :unit_not_green, repo: "frontend"}]} =
             Gate.evaluate("/ws", %{required: true, ui_paths: []}, d)
  end

  test "ui change demands e2e with screenshots and video" do
    d = deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend")])} end)
    assert {:violations, [%{kind: :e2e_missing}]} = Gate.evaluate("/ws", @config, d)

    d2 =
      deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e(screenshots: [])])} end)

    assert {:violations, [%{kind: :visual_capture_missing}]} = Gate.evaluate("/ws", @config, d2)
  end

  test "fully green with visual capture is satisfied" do
    d = deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e()])} end)
    assert :satisfied = Gate.evaluate("/ws", @config, d)
  end

  test "session audit failure is a violation" do
    d =
      deps(
        read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e()])} end,
        audit: fn _commands, _opts -> {:error, {:commands_not_executed, ["npm test"]}} end
      )

    assert {:violations, [%{kind: :commands_not_executed}]} = Gate.evaluate("/ws", @config, d)
  end

  test "unavailable session log is a violation" do
    d =
      deps(
        read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e()])} end,
        audit: fn _commands, _opts -> {:error, :session_log_unavailable} end
      )

    assert {:violations, [%{kind: :session_log_unavailable}]} =
             Gate.evaluate("/ws", @config, d)
  end
end
