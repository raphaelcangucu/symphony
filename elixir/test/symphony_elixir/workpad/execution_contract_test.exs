defmodule SymphonyElixir.Workpad.ExecutionContractTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Workpad.ExecutionContract

  test "returns absent when the execution contract section is missing" do
    assert :absent = ExecutionContract.parse("## Codex Workpad\n\n### Plan\n- [ ] do it")
  end

  test "validates basic workpad sections without requiring an execution contract" do
    body = """
    ## Codex Workpad

    ### Plan
    - [ ] do it

    ### Acceptance criteria
    - works
    """

    assert :ok = ExecutionContract.validate_workpad(body)
  end

  test "requires inline execution contract fields in plan for plan-driven runs" do
    body = """
    ## Codex Workpad

    ### Plan
    - [ ] do it

    ### Acceptance criteria
    - works
    """

    assert {:error, :contract_absent} = ExecutionContract.validate_workpad(body, require_execution_contract: true)

    body_with_contract = """
    ## Codex Workpad

    ### Plan
    source_plan: docs/superpowers/plans/demo.md
    mode: full-plan
    scope_status: in_progress
    final_validate_allowed: false
    final_publish_allowed: false

    - [ ] do it

    ### Acceptance criteria
    - works
    """

    assert :ok = ExecutionContract.validate_workpad(body_with_contract, require_execution_contract: true)
  end

  test "rejects workpad bodies missing plan or acceptance criteria" do
    assert {:error, :plan_absent} = ExecutionContract.validate_workpad("## Codex Workpad")

    assert {:error, :acceptance_criteria_absent} =
             ExecutionContract.validate_workpad("## Codex Workpad\n\n### Plan\n- [ ] do it")
  end

  test "parses execution contract fields and tasks from the plan section" do
    body = """
    ## Codex Workpad

    ### Plan
    source_plan: docs/superpowers/plans/2026-06-23-dis-6-admin-i18n-complete-plan.md
    mode: full-plan
    scope_status: in_progress
    final_validate_allowed: false
    final_publish_allowed: false

    - [x] Task 1: Stabilize existing first slice
      validation: passed
      evidence: n/a
      commit: n/a
    - [~] Task 2: Add Settings namespace
      validation: passed
      evidence: pending
      commit: pending
      remaining:
        - admin/src/pages/SettingsSync.jsx
    - [ ] Task 3: Add Tasks namespace

    ### Validation
    pending
    """

    assert {:ok, contract} = ExecutionContract.parse(body)
    assert contract.source_plan == "docs/superpowers/plans/2026-06-23-dis-6-admin-i18n-complete-plan.md"
    assert contract.mode == "full-plan"
    assert contract.scope_status == "in_progress"
    refute contract.scope_complete?
    refute contract.final_validate_allowed?
    refute contract.final_publish_allowed?

    assert [
             %{status: :done, title: "Task 1: Stabilize existing first slice", validation: "passed", evidence: "n/a", commit: "n/a"},
             %{status: :partial, title: "Task 2: Add Settings namespace", validation: "passed", evidence: "pending", commit: "pending", remaining: remaining},
             %{status: :pending, title: "Task 3: Add Tasks namespace"}
           ] = contract.tasks

    assert remaining == ["admin/src/pages/SettingsSync.jsx"]
    assert contract.next_incomplete.title == "Task 2: Add Settings namespace"
  end

  test "pending or partial tasks force scope incomplete even when header claims complete" do
    body = """
    ## Codex Workpad

    ### Plan
    source_plan: docs/superpowers/plans/demo.md
    mode: full-plan
    scope_status: complete
    final_validate_allowed: true
    final_publish_allowed: true

    - [x] Task 1: Done
      validation: passed
      evidence: done
      commit: done
    - [ ] Task 2: Not done
    """

    assert {:ok, contract} = ExecutionContract.parse(body)
    refute contract.scope_complete?
    refute contract.final_validate_allowed?
    refute contract.final_publish_allowed?
    assert contract.next_incomplete.title == "Task 2: Not done"
  end

  test "complete scope allows final validate and publish only when all tasks are done" do
    body = """
    ## Codex Workpad

    ### Plan
    source_plan: docs/superpowers/plans/demo.md
    mode: full-plan
    scope_status: complete
    final_validate_allowed: true
    final_publish_allowed: true

    - [x] Task 1: Done
      validation: passed
      evidence: done
      commit: done
    - [x] Task 2: Done
      validation: passed
      evidence: n/a
      commit: done
    """

    assert {:ok, contract} = ExecutionContract.parse(body)
    assert contract.scope_complete?
    assert contract.final_validate_allowed?
    assert contract.final_publish_allowed?
    assert contract.next_incomplete == nil
  end

  test "done task without commit and evidence metadata keeps scope incomplete" do
    body = """
    ## Codex Workpad

    ### Plan
    source_plan: docs/superpowers/plans/demo.md
    mode: full-plan
    scope_status: complete
    final_validate_allowed: true
    final_publish_allowed: true

    - [x] Task 1: Missing gates
      validation: passed
    """

    assert {:ok, contract} = ExecutionContract.parse(body)
    refute contract.scope_complete?
    refute contract.final_validate_allowed?
    refute contract.final_publish_allowed?
    assert contract.next_incomplete.title == "Task 1: Missing gates"
  end
end
