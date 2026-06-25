defmodule SymphonyElixir.Workpad.ExecutionBundle.ValidatorTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Workpad.ExecutionBundle
  alias SymphonyElixir.Workpad.ExecutionBundle.Validator

  defp bundle(units, contracts \\ []) do
    %ExecutionBundle{mode: "bundle", units: units, shared_contracts: contracts}
  end

  defp unit(id, attrs \\ %{}) do
    Map.merge(
      %{id: id, type: :child_run, issue: nil, repo: "r", produces: [], consumes: [], depends_on: [], deliverable: "pr"},
      attrs
    )
  end

  test "ok bundle has no warnings" do
    b = bundle([unit("a"), unit("b", %{depends_on: ["a"]})])
    assert Validator.validate(b, parent_repo: "r") == :ok
  end

  test "detects dependency cycle" do
    b = bundle([unit("a", %{depends_on: ["b"]}), unit("b", %{depends_on: ["a"]})])
    assert {:error, warnings} = Validator.validate(b, parent_repo: "r")
    assert Enum.any?(warnings, &(&1.code == :dependency_cycle))
  end

  test "detects consumer without producer" do
    b = bundle([unit("a", %{consumes: ["c"]})])
    assert {:error, warnings} = Validator.validate(b, parent_repo: "r")
    assert Enum.any?(warnings, &(&1.code == :missing_contract_producer))
  end

  test "flags cross-repo workpad_task" do
    b = bundle([unit("a", %{type: :workpad_task, repo: "other"})])
    assert {:error, warnings} = Validator.validate(b, parent_repo: "r")
    assert Enum.any?(warnings, &(&1.code == :cross_repo_inline))
  end
end
