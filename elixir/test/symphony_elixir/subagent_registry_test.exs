defmodule SymphonyElixir.SubagentRegistryTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.SubagentRegistry
  alias SymphonyElixir.Workpad.ExecutionBundle

  defp bundle do
    %ExecutionBundle{
      version: 1,
      mode: "bundle",
      parent: "MAC-1",
      units: [
        %{
          id: "api",
          type: :child_run,
          issue: "MAC-12",
          repo: "macro/be",
          produces: ["schema"],
          consumes: [],
          depends_on: [],
          deliverable: "pr"
        },
        %{
          id: "ui",
          type: :child_run,
          issue: "MAC-13",
          repo: "macro/fe",
          produces: [],
          consumes: ["schema"],
          depends_on: ["api"],
          deliverable: "pr"
        },
        %{
          id: "docs",
          type: :child_run,
          issue: "MAC-14",
          repo: "macro/fe",
          produces: [],
          consumes: [],
          depends_on: ["ui"],
          deliverable: "pr"
        }
      ],
      shared_contracts: [
        %{id: "schema", kind: "openapi", owner_unit: "api", consumers: ["ui"], artifact: "openapi.yaml", status: :draft}
      ]
    }
  end

  defp resolvers(overrides \\ []) do
    [
      bundle_loader: fn
        "MAC-1" -> {:ok, bundle()}
        _ -> :error
      end,
      slug_resolver: fn _ -> "macro-markets" end,
      terminal_resolver: fn _ -> false end,
      state_resolver: fn _ -> "In Progress" end,
      issue_id_resolver: fn id -> "id-" <> id end
    ]
    |> Keyword.merge(overrides)
  end

  defp snapshot(running) when is_list(running), do: %{running: running}

  defp by_issue(records), do: Map.new(records, &{&1.issue_identifier, &1})

  test "projects gated sibling units of an in-flight coordinator as :waiting records" do
    snap =
      snapshot([
        %{identifier: "MAC-1", parent_identifier: nil, unit_id: nil},
        %{identifier: "MAC-12", parent_identifier: "MAC-1", unit_id: "MAC-12"}
      ])

    records = SubagentRegistry.waiting_subagents(snap, resolvers(lab_bundle_child_orchestration: true))
    by = by_issue(records)

    assert Enum.map(records, & &1.issue_identifier) |> Enum.sort() == ["MAC-13", "MAC-14"]

    assert by["MAC-13"].status == :waiting
    assert by["MAC-13"].parent_identifier == "MAC-1"
    assert by["MAC-13"].unit_id == "ui"
    assert by["MAC-13"].repo == "macro/fe"
    assert by["MAC-13"].project_slug == "macro-markets"
    assert by["MAC-13"].state == "In Progress"
    assert by["MAC-13"].issue_id == "id-MAC-13"
    assert by["MAC-13"].blocked_by == ["api"]
    assert is_binary(by["MAC-13"].last_message)

    assert by["MAC-14"].blocked_by == ["ui"]
  end

  test "the live dependency-free unit is never projected as waiting" do
    snap =
      snapshot([
        %{identifier: "MAC-1", parent_identifier: nil, unit_id: nil},
        %{identifier: "MAC-12", parent_identifier: "MAC-1", unit_id: "MAC-12"}
      ])

    records = SubagentRegistry.waiting_subagents(snap, resolvers(lab_bundle_child_orchestration: true))
    refute Enum.any?(records, &(&1.issue_identifier == "MAC-12"))
  end

  test "a unit whose dependency completed and contract is ready is no longer waiting" do
    snap =
      snapshot([
        %{identifier: "MAC-1", parent_identifier: nil, unit_id: nil}
      ])

    overrides = [
      lab_bundle_child_orchestration: true,
      terminal_resolver: fn
        "MAC-12" -> true
        _ -> false
      end,
      bundle_loader: fn
        "MAC-1" ->
          {:ok,
           %{
             bundle()
             | shared_contracts: [
                 %{
                   id: "schema",
                   kind: "openapi",
                   owner_unit: "api",
                   consumers: ["ui"],
                   artifact: "openapi.yaml",
                   status: :ready
                 }
               ]
           }}

        _ ->
          :error
      end
    ]

    records = SubagentRegistry.waiting_subagents(snap, resolvers(overrides))
    issues = Enum.map(records, & &1.issue_identifier)

    # MAC-12 done, schema ready -> MAC-13 is now :ready (not waiting). MAC-14
    # still depends on MAC-13 which has not completed.
    refute "MAC-13" in issues
    assert "MAC-14" in issues
  end

  test "discovers the coordinator parent from an in-flight child even without a coordinator run entry" do
    snap =
      snapshot([
        %{identifier: "MAC-12", parent_identifier: "MAC-1", unit_id: "MAC-12"}
      ])

    records = SubagentRegistry.waiting_subagents(snap, resolvers(lab_bundle_child_orchestration: true))
    assert Enum.map(records, & &1.issue_identifier) |> Enum.sort() == ["MAC-13", "MAC-14"]
  end

  test "a running parent without a coordinator bundle yields no waiting rows" do
    snap = snapshot([%{identifier: "MAC-99", parent_identifier: nil, unit_id: nil}])

    assert SubagentRegistry.waiting_subagents(snap, resolvers()) == []
  end

  test "an empty snapshot yields no waiting rows" do
    assert SubagentRegistry.waiting_subagents(%{running: []}, resolvers()) == []
    assert SubagentRegistry.waiting_subagents(%{}, resolvers()) == []
  end
end
