defmodule SymphonyElixir.PromptBuilderBundleTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.PromptBuilder
  alias SymphonyElixir.Workpad.ExecutionBundle

  defp bundle do
    %ExecutionBundle{
      mode: "bundle",
      units: [
        %{id: "be", type: :child_run, issue: "p/be#1", repo: "p/be", produces: ["api"], consumes: [], depends_on: [], deliverable: "pr"},
        %{id: "inline", type: :workpad_task, issue: nil, repo: "p/app", produces: [], consumes: [], depends_on: [], deliverable: nil}
      ],
      shared_contracts: [%{id: "api", owner_unit: "be", consumers: ["fe"], kind: "graphql", artifact: nil, status: :draft}]
    }
  end

  test "coordinator section lists units/contracts and forbids implementing child_run units" do
    text = PromptBuilder.bundle_coordinator_section(bundle())

    assert text =~ "be"
    assert text =~ "inline"
    assert text =~ "child_run"
    assert text =~ "workpad_task"
    assert text =~ "api"
    assert text =~ "Do not implement"
  end

  test "coordinator section is empty for a non-bundle" do
    assert PromptBuilder.bundle_coordinator_section(nil) == ""
  end

  test "child unit section scopes to the unit, contract, and parent back-link" do
    unit = %{id: "be", type: :child_run, repo: "p/be", produces: ["api"], consumes: [], depends_on: []}
    contracts = [%{id: "api", owner_unit: "be", consumers: ["fe"], status: :draft}]

    text = PromptBuilder.child_unit_section(unit, "MAC-42", contracts)

    assert text =~ "be"
    assert text =~ "MAC-42"
    assert text =~ "api"
    assert text =~ "p/be"
  end

  test "child unit section is empty when there is no unit" do
    assert PromptBuilder.child_unit_section(nil, nil, []) == ""
  end
end
