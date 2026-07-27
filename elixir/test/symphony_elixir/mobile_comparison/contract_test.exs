defmodule SymphonyElixir.MobileComparison.ContractTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileComparison.Contract

  test "defines exactly the approved Dev10x high matrix" do
    assert Enum.map(Contract.cells(), &Map.take(&1, [:id, :path, :provider, :model, :effort])) == [
             %{
               id: "session-codex",
               path: :session,
               provider: "codex",
               model: "gpt-5.6-sol",
               effort: "high"
             },
             %{
               id: "session-cursor",
               path: :session,
               provider: "cursor",
               model: "cursor-grok-4.5-high",
               effort: nil
             },
             %{
               id: "session-claude",
               path: :session,
               provider: "claude",
               model: "claude-opus-5",
               effort: "high"
             },
             %{
               id: "orchestrator-codex",
               path: :orchestrator,
               provider: "codex",
               model: "gpt-5.6-sol",
               effort: "high"
             },
             %{
               id: "orchestrator-cursor",
               path: :orchestrator,
               provider: "cursor",
               model: "cursor-grok-4.5-high",
               effort: nil
             },
             %{
               id: "orchestrator-claude",
               path: :orchestrator,
               provider: "claude",
               model: "claude-opus-5",
               effort: "high"
             }
           ]
  end

  test "rejects unknown cells and exposes effective high effort for Cursor" do
    assert {:error, :unknown_cell} = Contract.fetch("session-nope")
    assert {:ok, cell} = Contract.fetch("session-cursor")
    assert cell.effective_effort == "high"
  end
end
