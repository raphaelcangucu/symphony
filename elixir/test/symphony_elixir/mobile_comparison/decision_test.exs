defmodule SymphonyElixir.MobileComparison.DecisionTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileComparison.Decision

  @ranking [
    %{"rank" => 1, "cell_id" => "session-codex", "score" => 97},
    %{"rank" => 2, "cell_id" => "session-claude", "score" => 95},
    %{"rank" => 3, "cell_id" => "orchestrator-codex", "score" => 93},
    %{"rank" => 4, "cell_id" => "orchestrator-claude", "score" => 91},
    %{"rank" => 5, "cell_id" => "orchestrator-cursor", "score" => 89},
    %{"rank" => 6, "cell_id" => "session-cursor", "score" => 87}
  ]

  test "round-trips one operator decision without exposing it to agent prompts" do
    description = """
    Build and compare the Dev10x landing.

    ```dev10x-comparison
    {"version":1,"brand":"Dev10x","matrix":"official-high-v1"}
    ```
    """

    decision = %{
      "ranking" => @ranking,
      "summary" => "Operator reviewed every durable artifact in the mobile app."
    }

    persisted = Decision.put(description, decision)

    assert Decision.get(persisted) ==
             Map.merge(decision, %{
               "version" => 1,
               "winner_cell_id" => "session-codex",
               "source" => "mobile-operator"
             })

    assert Decision.prompt(persisted) == String.trim(description)
  end

  test "validates a complete unique six-cell ranking and bounded scores" do
    assert {:ok, validated} =
             Decision.validate(%{
               "ranking" => @ranking,
               "summary" => "Evidence and previews reviewed in the Dev10x app."
             })

    assert validated["winner_cell_id"] == "session-codex"
    assert Enum.map(validated["ranking"], & &1["rank"]) == Enum.to_list(1..6)

    assert {:error, :invalid_decision} =
             Decision.validate(%{
               "ranking" => List.replace_at(@ranking, 5, hd(@ranking)),
               "summary" => "Duplicate cell."
             })

    assert {:error, :invalid_decision} =
             Decision.validate(%{
               "ranking" => put_in(@ranking, [Access.at(0), "score"], 101),
               "summary" => "Invalid score."
             })
  end
end
