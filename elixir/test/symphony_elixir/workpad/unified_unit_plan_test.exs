defmodule SymphonyElixir.Workpad.UnifiedUnitPlanTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Issue
  alias SymphonyElixir.Workpad.{ExecutionBundle, UnifiedUnitPlan}

  defp sub_issue(id, opts \\ []) do
    %Issue{
      id: "id-" <> id,
      identifier: id,
      state: Keyword.get(opts, :state, "Todo"),
      labels: Keyword.get(opts, :labels, ["symphony"]),
      assignee_id: Keyword.get(opts, :assignee_id, "operator")
    }
  end

  defp bundle do
    %ExecutionBundle{
      mode: "bundle",
      parent: "510",
      units: [
        %{
          id: "MAC-12",
          type: :child_run,
          issue: "MAC-12",
          repo: "clouapp/front",
          produces: ["theme"],
          consumes: [],
          depends_on: [],
          deliverable: "pr"
        },
        %{
          id: "MAC-13",
          type: :child_run,
          issue: "MAC-13",
          repo: "clouapp/back",
          produces: [],
          consumes: ["theme"],
          depends_on: ["MAC-12"],
          deliverable: "pr"
        }
      ],
      shared_contracts: []
    }
  end

  test "joins bundle units to gated board sub-issues" do
    sub_issues = [
      sub_issue("MAC-12", state: "Human Review"),
      sub_issue("MAC-13", state: "Todo")
    ]

    assert {:ok, plan} =
             UnifiedUnitPlan.build(bundle(), sub_issues,
               require_symphony_label: true,
               require_assignee_match: true,
               viewer_login: "operator"
             )

    assert length(plan.units) == 2
    mac12 = Enum.find(plan.units, &(&1.issue == "MAC-12"))
    assert mac12.eligible
    assert mac12.board_status == "Human Review"
    assert mac12.depends_on == []
  end

  test "bundle unit without board match is skipped with reason" do
    assert {:ok, plan} =
             UnifiedUnitPlan.build(bundle(), [sub_issue("MAC-12")],
               require_symphony_label: false,
               require_assignee_match: false
             )

    mac13 = Enum.find(plan.units, &(&1.issue == "MAC-13"))
    refute mac13.eligible
    assert mac13.skip_reason =~ "not on board"
    assert Enum.any?(plan.warnings, &String.contains?(&1, "MAC-13"))
  end

  test "board sub-issue without bundle unit is included as ad-hoc with warning" do
    assert {:ok, plan} =
             UnifiedUnitPlan.build(bundle(), [sub_issue("MAC-12"), sub_issue("MAC-15")],
               require_symphony_label: false,
               require_assignee_match: false
             )

    mac15 = Enum.find(plan.units, &(&1.issue == "MAC-15"))
    assert mac15.ad_hoc
    assert mac15.eligible
    assert Enum.any?(plan.warnings, &String.contains?(&1, "MAC-15"))
  end

  test "filters sub-issues by symphony label when required" do
    assert {:ok, plan} =
             UnifiedUnitPlan.build(bundle(), [sub_issue("MAC-12", labels: ["bug"])],
               require_symphony_label: true,
               require_assignee_match: false
             )

    mac12 = Enum.find(plan.units, &(&1.issue == "MAC-12"))
    refute mac12.eligible
  end
end
