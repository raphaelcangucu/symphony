defmodule SymphonyElixir.Workpad.ExecutionBundle.StoreTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Workpad.ExecutionBundle
  alias SymphonyElixir.Workpad.ExecutionBundle.Store

  @empty_bundle_workpad """
  ## Codex Workpad

  ### Execution bundle

  ```yaml
  version: 1
  mode: bundle
  parent: macro-markets#42
  units: []
  ```
  """

  test "upsert_unit adds a unit block to an existing bundle section" do
    {:ok, updated} =
      Store.upsert_unit(@empty_bundle_workpad, %{
        id: "backend-wheel-api",
        type: :child_run,
        issue: "macro-markets/backend#101",
        repo: "macro-markets/backend"
      })

    assert updated =~ "backend-wheel-api"
    {:ok, bundle} = ExecutionBundle.parse(updated)
    backend = Enum.find(bundle.units, &(&1.id == "backend-wheel-api"))
    assert backend.type == :child_run
    assert backend.repo == "macro-markets/backend"
  end

  test "upsert_unit replaces a unit with the same id (no duplicates)" do
    {:ok, once} =
      Store.upsert_unit(@empty_bundle_workpad, %{id: "u1", type: :workpad_task, repo: "r"})

    {:ok, twice} = Store.upsert_unit(once, %{id: "u1", type: :child_run, repo: "r"})

    {:ok, bundle} = ExecutionBundle.parse(twice)
    assert length(bundle.units) == 1
    assert hd(bundle.units).type == :child_run
  end

  test "upsert_unit creates the bundle section when absent" do
    {:ok, updated} =
      Store.upsert_unit("## Codex Workpad\n\n### Plan\n- [ ] x\n", %{id: "u1", type: :child_run, repo: "r"})

    assert updated =~ "### Execution bundle"
    {:ok, bundle} = ExecutionBundle.parse(updated)
    assert Enum.any?(bundle.units, &(&1.id == "u1"))
  end

  test "upsert_contract adds a shared contract to the bundle" do
    {:ok, updated} =
      Store.upsert_contract(@empty_bundle_workpad, %{
        id: "lottery-api",
        kind: "graphql_mutation",
        owner_unit: "backend",
        consumers: ["frontend"],
        status: :draft
      })

    {:ok, bundle} = ExecutionBundle.parse(updated)
    [contract] = bundle.shared_contracts
    assert contract.id == "lottery-api"
    assert contract.owner_unit == "backend"
    assert contract.consumers == ["frontend"]
  end
end
