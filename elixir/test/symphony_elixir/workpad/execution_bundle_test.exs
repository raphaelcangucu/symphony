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
end
