defmodule SymphonyElixir.PromptBuilderUnifiedTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.PromptBuilder
  alias SymphonyElixir.Workpad.{ExecutionBundle, UnifiedUnitPlan}

  defp bundle do
    %ExecutionBundle{
      mode: "bundle",
      parent: "510",
      units: [
        %{id: "MAC-12", type: :child_run, issue: "MAC-12", repo: "clouapp/front", produces: [], consumes: [], depends_on: [], deliverable: "pr"}
      ],
      shared_contracts: []
    }
  end

  defp plan do
    %UnifiedUnitPlan{
      units: [
        %{
          id: "MAC-12",
          issue: "MAC-12",
          type: :child_run,
          repo: "clouapp/front",
          depends_on: [],
          consumes: [],
          produces: [],
          deliverable: "pr",
          board_status: "Todo",
          eligible: true,
          skip_reason: nil,
          ad_hoc: false
        }
      ],
      warnings: []
    }
  end

  test "unified_parent_section lists unit plan and one-PR rules" do
    text = PromptBuilder.unified_parent_section(bundle(), plan(), feature_branch: "feat/510")

    assert text =~ "MAC-12"
    assert text =~ "subagent-driven-development"
    assert text =~ "one PR per touched repo"
    assert text =~ "feat/510"
    assert text =~ "no"
    assert text =~ "`feat/MAC-*` child branches"
  end
end
