defmodule SymphonyElixir.Orchestrator.SubagentPlanTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Orchestrator.SubagentPlan
  alias SymphonyElixir.Workpad.ExecutionBundle

  defp bundle do
    %ExecutionBundle{
      version: 1,
      mode: "bundle",
      parent: "MAC-1",
      units: [
        %{id: "api", type: :child_run, issue: "MAC-12", repo: "macro/be", produces: ["schema"], consumes: [], depends_on: [], deliverable: "pr"},
        %{id: "ui", type: :child_run, issue: "MAC-13", repo: "macro/fe", produces: [], consumes: ["schema"], depends_on: ["api"], deliverable: "pr"},
        %{id: "docs", type: :child_run, issue: "MAC-14", repo: "macro/fe", produces: [], consumes: [], depends_on: ["ui"], deliverable: "pr"},
        # A non-orchestrated inline unit must never appear in the subagent plan.
        %{id: "inline", type: :workpad_task, issue: nil, repo: nil, produces: [], consumes: [], depends_on: [], deliverable: nil}
      ],
      shared_contracts: [
        %{id: "schema", kind: "openapi", owner_unit: "api", consumers: ["ui"], artifact: "openapi.yaml", status: :draft}
      ]
    }
  end

  defp by_unit(plan), do: Map.new(plan, &{&1.unit_id, &1})

  test "plan only includes orchestrated subagent units, in bundle order" do
    plan = SubagentPlan.plan(bundle(), [])

    assert Enum.map(plan, & &1.unit_id) == ["api", "ui", "docs"]
    refute Enum.any?(plan, &(&1.unit_id == "inline"))
  end

  test "a dependency-free unit that is not running is :ready" do
    plan = by_unit(SubagentPlan.plan(bundle(), []))

    assert plan["api"].status == :ready
    assert plan["api"].blocked_by == []
    assert plan["api"].pending_contracts == []
    assert plan["api"].issue == "MAC-12"
    assert plan["api"].repo == "macro/be"
  end

  test "a dependency-free unit that is running is :live" do
    plan = by_unit(SubagentPlan.plan(bundle(), running_unit_ids: MapSet.new(["api"])))

    assert plan["api"].status == :live
  end

  test "a dependent unit is :waiting while its dependency is not done" do
    plan = by_unit(SubagentPlan.plan(bundle(), contract_status: %{"schema" => :ready}))

    assert plan["ui"].status == :waiting
    assert plan["ui"].blocked_by == ["api"]
    assert plan["ui"].pending_contracts == []
  end

  test "a dependent unit is :waiting while a consumed contract is not ready, even if deps are done" do
    plan =
      by_unit(
        SubagentPlan.plan(bundle(), done_units: MapSet.new(["api"]), contract_status: %{"schema" => :draft})
      )

    assert plan["ui"].status == :waiting
    assert plan["ui"].blocked_by == []
    assert plan["ui"].pending_contracts == ["schema"]
  end

  test "a dependent unit becomes :ready once its dependency is done and its contract is ready" do
    plan =
      by_unit(
        SubagentPlan.plan(bundle(), done_units: MapSet.new(["api"]), contract_status: %{"schema" => :ready})
      )

    assert plan["ui"].status == :ready
    assert plan["ui"].blocked_by == []
    assert plan["ui"].pending_contracts == []
  end

  test "a completed unit is :done regardless of running state" do
    plan =
      by_unit(
        SubagentPlan.plan(bundle(),
          done_units: MapSet.new(["api"]),
          running_unit_ids: MapSet.new(["api"])
        )
      )

    assert plan["api"].status == :done
  end

  test "a transitively dependent unit stays :waiting until its direct dependency completes" do
    # docs depends on ui; ui depends on api. With only api done, docs is still
    # blocked on ui.
    plan =
      by_unit(
        SubagentPlan.plan(bundle(),
          done_units: MapSet.new(["api"]),
          contract_status: %{"schema" => :ready}
        )
      )

    assert plan["docs"].status == :waiting
    assert plan["docs"].blocked_by == ["ui"]
  end

  test "waiting_unit_ids and ready_unit_ids project the plan into id sets" do
    plan = SubagentPlan.plan(bundle(), contract_status: %{"schema" => :ready})

    assert SubagentPlan.waiting_unit_ids(plan) == MapSet.new(["ui", "docs"])
    assert SubagentPlan.ready_unit_ids(plan) == MapSet.new(["api"])
  end

  test "a non-coordinator bundle yields an empty plan" do
    inline_only = %ExecutionBundle{
      version: 1,
      mode: "bundle",
      parent: "MAC-1",
      units: [%{id: "only", type: :workpad_task, issue: nil, repo: nil, produces: [], consumes: [], depends_on: [], deliverable: nil}],
      shared_contracts: []
    }

    assert SubagentPlan.plan(inline_only, []) == []
  end
end
