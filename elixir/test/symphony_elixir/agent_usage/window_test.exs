defmodule SymphonyElixir.AgentUsage.WindowTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.AgentUsage.Snapshot
  alias SymphonyElixir.AgentUsage.Window

  # Schema mirrors the real Codex `token_count` rate_limits payload observed in
  # codex/event_humanizer.ex and status_dashboard.ex: a top-level
  # %{"limit_name", "primary" => bucket, "secondary" => bucket, "credits"}
  # where each bucket carries usedPercent/windowDurationMins/reset_* fields.
  describe "normalize/3" do
    test "maps a codex rate-limit payload into session (primary) + weekly (secondary) windows" do
      payload = %{
        "limit_name" => "claude_max",
        "primary" => %{
          "usedPercent" => 42.0,
          "windowDurationMins" => 300,
          "resets_at" => 1_900_000_000
        },
        "secondary" => %{
          "usedPercent" => 7.5,
          "windowDurationMins" => 10_080,
          "resets_at" => 1_900_500_000
        }
      }

      snap = Window.normalize("codex", payload, 1_899_000_000)

      assert %Snapshot{agent_kind: "codex", plan: "claude_max"} = snap

      session = Enum.find(snap.windows, &(&1.kind == :session))
      weekly = Enum.find(snap.windows, &(&1.kind == :weekly))

      assert session.used_percent == 42.0
      assert session.resets_at == 1_900_000_000
      assert session.window_minutes == 300
      assert weekly.used_percent == 7.5
      assert weekly.resets_at == 1_900_500_000
    end

    test "clamps used_percent to 0..100 and tolerates missing fields" do
      snap = Window.normalize("codex", %{"primary" => %{"usedPercent" => 130}}, 0)

      session = Enum.find(snap.windows, &(&1.kind == :session))
      assert session.used_percent == 100.0
      assert session.resets_at == nil
      assert snap.windows |> Enum.map(& &1.kind) == [:session]
    end

    test "computes absolute resets_at from a relative reset_in_seconds against now" do
      payload = %{"primary" => %{"usedPercent" => 10, "reset_in_seconds" => 3_600}}

      snap = Window.normalize("codex", payload, 1_000_000)
      session = Enum.find(snap.windows, &(&1.kind == :session))

      assert session.resets_at == 1_003_600
    end

    test "extracts credits (balance + unlimited)" do
      with_balance =
        Window.normalize("codex", %{"credits" => %{"has_credits" => true, "balance" => 12.5}}, 0)

      assert with_balance.credits_remaining == 12.5
      assert with_balance.credits_unlimited == false

      unlimited = Window.normalize("codex", %{"credits" => %{"unlimited" => true}}, 0)
      assert unlimited.credits_unlimited == true
      assert unlimited.credits_remaining == nil
    end

    test "returns an empty-window snapshot for a nil or empty payload (no crash)" do
      assert %Snapshot{agent_kind: "claude", windows: []} = Window.normalize("claude", nil, 0)
      assert %Snapshot{agent_kind: "cursor", windows: []} = Window.normalize("cursor", %{}, 0)
    end
  end
end
