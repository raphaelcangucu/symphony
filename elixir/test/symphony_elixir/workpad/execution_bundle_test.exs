defmodule SymphonyElixir.Workpad.ExecutionBundleTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Workpad.ExecutionBundle

  @workpad """
  ## Codex Workpad

  ### Execution bundle

  ```yaml
  version: 1
  mode: bundle
  parent: macro-markets#42
  shared_contracts:
    - id: lottery-wheel-api
      kind: graphql_mutation
      owner_unit: backend-wheel-api
      consumers: [frontend-landing-wheel]
      status: draft
  units:
    - id: backend-wheel-api
      type: child_run
      issue: macro-markets/backend#101
      repo: macro-markets/backend
      produces: [lottery-wheel-api]
      deliverable: pr
    - id: frontend-landing-wheel
      type: child_run
      issue: macro-markets/frontend#77
      repo: macro-markets/frontend
      consumes: [lottery-wheel-api]
      depends_on: [backend-wheel-api]
      deliverable: pr
  ```
  """

  @legacy_subagent_workpad """
  ## Codex Workpad

  ### Execution bundle

  ```yaml
  version: 1
  mode: bundle
  parent: macro-markets#510
  shared_contracts:
    - id: positions-api
      kind: graphql_query
      owner_unit: positions-backend
      consumers: [positions-ui]
      status: draft
  units:
    - id: positions-backend
      type: subagent_unit
      issue: MAC-12
      repo: macro-markets/app
      produces: [positions-api]
    - id: positions-ui
      type: subagent_unit
      issue: MAC-13
      repo: macro-markets/app
      consumes: [positions-api]
      depends_on: [positions-backend]
  ```
  """

  @pr_base_workpad """
  ## Codex Workpad

  ### Execution bundle

  ```yaml
  version: 2
  mode: bundle
  parent: macro-markets#510
  units:
    - id: backend
      type: child_run
      issue: MAC-12
      repo: clouapp/back
      pr_base: symphony/510/clouapp-back
      deliverable: pr
  ```
  """

  test "parse/1 returns the bundle with units and contracts" do
    assert {:ok, bundle} = ExecutionBundle.parse(@workpad)
    assert bundle.mode == "bundle"
    assert length(bundle.units) == 2
    backend = Enum.find(bundle.units, &(&1.id == "backend-wheel-api"))
    assert backend.type == :child_run
    assert backend.repo == "macro-markets/backend"
    assert backend.produces == ["lottery-wheel-api"]
    [contract] = bundle.shared_contracts
    assert contract.id == "lottery-wheel-api"
    assert contract.owner_unit == "backend-wheel-api"
    assert contract.consumers == ["frontend-landing-wheel"]
    assert contract.status == :draft
  end

  test "parse/1 is :absent when there is no bundle section" do
    assert :absent = ExecutionBundle.parse("## Codex Workpad\n\n### Plan\n- [ ] x\n")
  end

  test "child_units/workpad_units split units by type" do
    {:ok, bundle} = ExecutionBundle.parse(@workpad)
    assert ExecutionBundle.child_units(bundle) |> length() == 2
    assert ExecutionBundle.workpad_units(bundle) == []
  end

  test "parse/1 maps legacy subagent_unit type to child_run" do
    assert {:ok, bundle} = ExecutionBundle.parse(@legacy_subagent_workpad)
    backend = Enum.find(bundle.units, &(&1.id == "positions-backend"))
    ui = Enum.find(bundle.units, &(&1.id == "positions-ui"))
    assert backend.type == :child_run
    assert ui.type == :child_run
    assert ui.depends_on == ["positions-backend"]
  end

  test "legacy subagent units count as child_run units" do
    {:ok, bundle} = ExecutionBundle.parse(@legacy_subagent_workpad)
    ids = bundle |> ExecutionBundle.child_units() |> Enum.map(& &1.id)
    assert ids == ["positions-backend", "positions-ui"]
    assert ExecutionBundle.workpad_units(bundle) == []
  end

  test "dispatchable_units/1 returns child_run units (incl. legacy subagent_unit)" do
    {:ok, child_bundle} = ExecutionBundle.parse(@workpad)
    assert child_bundle |> ExecutionBundle.dispatchable_units() |> length() == 2

    {:ok, legacy_bundle} = ExecutionBundle.parse(@legacy_subagent_workpad)
    ids = legacy_bundle |> ExecutionBundle.dispatchable_units() |> Enum.map(& &1.id)
    assert ids == ["positions-backend", "positions-ui"]
  end

  test "parse/1 reads the per-repo parent integration branch (pr_base)" do
    assert {:ok, bundle} = ExecutionBundle.parse(@pr_base_workpad)
    backend = Enum.find(bundle.units, &(&1.id == "backend"))
    assert backend.type == :child_run
    assert backend.pr_base == "symphony/510/clouapp-back"
  end
end
