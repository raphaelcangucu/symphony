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

  test "coordinator section owns integration + names the comms tools" do
    text = PromptBuilder.bundle_coordinator_section(bundle())

    assert text =~ "integration branch"
    assert text =~ "query_bundle_status"
    assert text =~ "one"
    assert text =~ "final PR per repo"
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

  test "child unit section opens one focused PR for its unit" do
    unit = %{id: "be", type: :child_run, repo: "p/be", produces: ["api"], consumes: [], depends_on: []}

    text = PromptBuilder.child_unit_section(unit, "MAC-42", [])

    assert text =~ "one focused PR"
    assert text =~ "MAC-42"
  end

  test "child unit section tells a dependent to build on its predecessor's branch and still PR into the integration branch" do
    unit = %{id: "fe", type: :child_run, repo: "p/fe", produces: [], consumes: ["api"], depends_on: ["be"]}

    text = PromptBuilder.child_unit_section(unit, "MAC-42", [])

    assert text =~ "depend"
    assert text =~ "be"
    assert text =~ "branched"
    assert text =~ "integration branch"
  end

  test "child unit section is empty when there is no unit" do
    assert PromptBuilder.child_unit_section(nil, nil, []) == ""
  end

  test "coordinator section notes dependents fork from their predecessor's branch" do
    dependent_bundle = %ExecutionBundle{
      mode: "bundle",
      units: [
        %{id: "be", type: :child_run, issue: "MAC-12", repo: "p/be", produces: ["api"], consumes: [], depends_on: [], deliverable: "pr"},
        %{id: "fe", type: :child_run, issue: "MAC-13", repo: "p/be", produces: [], consumes: ["api"], depends_on: ["be"], deliverable: "pr"}
      ],
      shared_contracts: []
    }

    text = PromptBuilder.bundle_coordinator_section(dependent_bundle)

    assert text =~ "predecessor"
  end

  test "child constraints section forbids CI babysitting and routes integration to the parent" do
    text = PromptBuilder.child_constraints_section("MAC-42")

    assert text =~ "MAC-42"
    assert text =~ "one focused pull request"
    # The 12.3M-token blowup came from babysitting CI — explicitly forbid it.
    assert text =~ "babysit"
    assert text =~ "gh run rerun"
    assert text =~ "gh run cancel"
    assert text =~ "sleep"
    assert text =~ "parent task's"
  end

  test "child constraints target the parent integration branch and report status" do
    text = PromptBuilder.child_constraints_section("MAC-42")

    assert text =~ "symphony/MAC-42/"
    assert text =~ "report_unit_status"
    assert text =~ "evidence"
    # Same-repo children reuse the parent's deps/preview instead of re-provisioning.
    assert text =~ "Reuse the parent's"
  end

  test "child constraints section is empty without a parent" do
    assert PromptBuilder.child_constraints_section(nil) == ""
  end
end
