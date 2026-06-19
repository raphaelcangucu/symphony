defmodule SymphonyElixir.Evidence.GateTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Evidence.Gate
  alias SymphonyElixir.Evidence.Manifest
  alias SymphonyElixir.Evidence.Manifest.Run

  defp manifest(runs, impact \\ []), do: %Manifest{issue: "GAM-9", runs: runs, impact: impact}

  defp unit(repo, status \\ "passed"),
    do: %Run{kind: "unit", repo: repo, command: "npm test", status: status}

  defp e2e(repo \\ "frontend", extra \\ []) do
    struct!(
      %Run{
        kind: "e2e",
        repo: repo,
        command: "npx playwright test",
        status: "passed",
        screenshots: ["s.png"],
        videos: ["v.webm"],
        navigations: ["http://localhost:3000/app"]
      },
      Map.new(extra)
    )
  end

  defp impact(from, to, impacts_ui, rationale \\ nil),
    do: %{from: from, to: to, impacts_ui: impacts_ui, rationale: rationale}

  defp deps(overrides \\ []) do
    Map.merge(
      %{
        read_manifest: fn _ws -> {:ok, manifest([unit("frontend")])} end,
        changed_files: fn _ws -> %{"frontend" => ["src/App.tsx"]} end,
        audit: fn _commands, _opts -> :ok end,
        judge_verdict: fn _ws -> :pass end
      },
      Map.new(overrides)
    )
  end

  @config %{
    required: true,
    repos: %{
      "frontend" => %{ui_paths: ["src/**"], e2e: %{command: "npx playwright test"}},
      "backend" => %{
        unit_command: "./vibe test",
        impacts: ["frontend"],
        contract_paths: ["app/Http/**", "routes/**"]
      },
      "goapi" => %{unit_command: "go test ./..."}
    }
  }

  test "disabled evidence is satisfied" do
    assert :satisfied = Gate.evaluate("/ws", %{required: false, repos: %{}}, deps())
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
        read_manifest: fn _ws -> {:ok, manifest([unit("goapi", "failed")])} end,
        changed_files: fn _ws -> %{"goapi" => ["main.go"]} end
      )

    assert {:violations, [%{kind: :unit_not_green, repo: "goapi"}]} =
             Gate.evaluate("/ws", @config, d)
  end

  test "changed repo with a blocked unit run is environment_blocked" do
    blocked =
      %Run{
        kind: "unit",
        repo: "goapi",
        command: "go test ./...",
        status: "blocked",
        blocked_reason: "no network to fetch Go modules"
      }

    d =
      deps(
        read_manifest: fn _ws -> {:ok, manifest([blocked])} end,
        changed_files: fn _ws -> %{"goapi" => ["main.go"]} end
      )

    assert {:violations, [%{kind: :environment_blocked, repo: "goapi", detail: detail}]} =
             Gate.evaluate("/ws", @config, d)

    assert detail =~ "no network to fetch Go modules"
  end

  test "required e2e with a blocked run is environment_blocked" do
    blocked_e2e =
      %Run{
        kind: "e2e",
        repo: "frontend",
        command: "npx playwright test",
        status: "blocked",
        blocked_reason: "browser sandbox blocked Chromium launch"
      }

    d = deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), blocked_e2e])} end)

    assert {:violations, [%{kind: :environment_blocked, repo: "frontend", detail: detail}]} =
             Gate.evaluate("/ws", @config, d)

    assert detail =~ "browser sandbox blocked Chromium launch"
  end

  test "environment_blocked_only? detects all-blocked violation lists" do
    assert Gate.environment_blocked_only?([%{kind: :environment_blocked, repo: "goapi", detail: "x"}])
    refute Gate.environment_blocked_only?([%{kind: :environment_blocked}, %{kind: :unit_not_green}])
    refute Gate.environment_blocked_only?([])
    refute Gate.environment_blocked_only?(:nope)
  end

  describe "frontend-only (direct UI change)" do
    test "demands e2e for frontend with screenshots and video" do
      d = deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend")])} end)
      assert {:violations, [%{kind: :e2e_missing, repo: "frontend"}]} = Gate.evaluate("/ws", @config, d)

      d2 =
        deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e("frontend", screenshots: [])])} end)

      assert {:violations, [%{kind: :visual_capture_missing, repo: "frontend"}]} =
               Gate.evaluate("/ws", @config, d2)
    end

    test "fully green with visual capture is satisfied" do
      d = deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e()])} end)
      assert :satisfied = Gate.evaluate("/ws", @config, d)
    end
  end

  describe "e2e realness (Layer A)" do
    test "e2e with only synthetic navigation is rejected" do
      d = deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e("frontend", navigations: ["about:blank"])])} end)
      assert {:violations, [%{kind: :synthetic_e2e, repo: "frontend"}]} = Gate.evaluate("/ws", @config, d)
    end

    test "e2e with empty navigation is rejected" do
      d = deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e("frontend", navigations: [])])} end)
      assert {:violations, [%{kind: :synthetic_e2e, repo: "frontend"}]} = Gate.evaluate("/ws", @config, d)
    end

    test "e2e with a real navigation is satisfied" do
      d = deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e("frontend", navigations: ["http://localhost:3000/app"])])} end)
      assert :satisfied = Gate.evaluate("/ws", @config, d)
    end

    test "require_url_pattern rejects a real but off-pattern navigation" do
      config = put_in(@config, [:repos, "frontend", :e2e, :require_url_pattern], "^https?://[^/]+\\.localhost")
      d = deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e("frontend", navigations: ["http://localhost:3000/app"])])} end)
      assert {:violations, [%{kind: :e2e_url_mismatch, repo: "frontend"}]} = Gate.evaluate("/ws", config, d)
    end
  end

  describe "judge verdict (Layer B)" do
    test "judge fail verdict is a violation" do
      d =
        deps(
          judge_verdict: fn _ws -> {:fail, ["e2e does not exercise the diff"]} end,
          read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e()])} end
        )

      assert {:violations, [%{kind: :judge_rejected, detail: detail}]} = Gate.evaluate("/ws", @config, d)
      assert detail =~ "does not exercise the diff"
    end

    test "judge pass verdict does not block an otherwise green gate" do
      d = deps(read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e()])} end)
      assert :satisfied = Gate.evaluate("/ws", @config, d)
    end

    test "judge none (unavailable) is non-blocking" do
      d =
        deps(
          judge_verdict: fn _ws -> :none end,
          read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), e2e()])} end
        )

      assert :satisfied = Gate.evaluate("/ws", @config, d)
    end
  end

  describe "default_deps wiring" do
    test "default_deps without an issue yields a non-blocking :none verdict" do
      deps = Gate.default_deps()
      assert deps.judge_verdict.("/ws") == :none
    end

    test "default_deps with an issue wires a judge_verdict reader" do
      deps = Gate.default_deps(issue: %{identifier: "X", title: "t"}, config: %{judge: %{enabled: false}})
      assert is_function(deps.judge_verdict, 1)
      assert deps.judge_verdict.("/ws") == :none
    end
  end

  describe "backend internal change (gray zone, agent decides)" do
    test "agent dismissal with rationale is satisfied" do
      d =
        deps(
          changed_files: fn _ws -> %{"backend" => ["app/Services/Internal.php"]} end,
          read_manifest: fn _ws ->
            {:ok, manifest([unit("backend")], [impact("backend", "frontend", false, "internal service, no API surface change")])}
          end
        )

      assert :satisfied = Gate.evaluate("/ws", @config, d)
    end

    test "missing impact decision is a violation" do
      d =
        deps(
          changed_files: fn _ws -> %{"backend" => ["app/Services/Internal.php"]} end,
          read_manifest: fn _ws -> {:ok, manifest([unit("backend")])} end
        )

      assert {:violations, [%{kind: :impact_assessment_missing, repo: "frontend"}]} =
               Gate.evaluate("/ws", @config, d)
    end

    test "agent declaring impact true demands frontend e2e" do
      d =
        deps(
          changed_files: fn _ws -> %{"backend" => ["app/Services/Internal.php"]} end,
          read_manifest: fn _ws ->
            {:ok, manifest([unit("backend")], [impact("backend", "frontend", true)])}
          end
        )

      assert {:violations, [%{kind: :e2e_missing, repo: "frontend"}]} = Gate.evaluate("/ws", @config, d)

      d2 =
        deps(
          changed_files: fn _ws -> %{"backend" => ["app/Services/Internal.php"]} end,
          read_manifest: fn _ws ->
            {:ok, manifest([unit("backend"), e2e()], [impact("backend", "frontend", true)])}
          end
        )

      assert :satisfied = Gate.evaluate("/ws", @config, d2)
    end
  end

  describe "backend contract change (deterministic backstop)" do
    test "touching contract_paths demands frontend e2e even with impacts_ui false" do
      d =
        deps(
          changed_files: fn _ws -> %{"backend" => ["routes/api.php"]} end,
          read_manifest: fn _ws ->
            {:ok, manifest([unit("backend")], [impact("backend", "frontend", false, "I think it is fine")])}
          end
        )

      assert {:violations, [%{kind: :e2e_missing, repo: "frontend"}]} = Gate.evaluate("/ws", @config, d)
    end

    test "backstop satisfied when frontend e2e ran" do
      d =
        deps(
          changed_files: fn _ws -> %{"backend" => ["routes/api.php"]} end,
          read_manifest: fn _ws -> {:ok, manifest([unit("backend"), e2e()])} end
        )

      assert :satisfied = Gate.evaluate("/ws", @config, d)
    end
  end

  describe "goapi-only (no impacts configured)" do
    test "only requires its own unit run" do
      d =
        deps(
          changed_files: fn _ws -> %{"goapi" => ["internal/x.go"]} end,
          read_manifest: fn _ws -> {:ok, manifest([unit("goapi")])} end
        )

      assert :satisfied = Gate.evaluate("/ws", @config, d)
    end
  end

  test "multi-repo: frontend UI + backend contract both need frontend e2e and units" do
    d =
      deps(
        changed_files: fn _ws -> %{"frontend" => ["src/App.tsx"], "backend" => ["routes/api.php"]} end,
        read_manifest: fn _ws -> {:ok, manifest([unit("frontend"), unit("backend"), e2e()])} end
      )

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

    assert {:violations, [%{kind: :session_log_unavailable}]} = Gate.evaluate("/ws", @config, d)
  end
end
