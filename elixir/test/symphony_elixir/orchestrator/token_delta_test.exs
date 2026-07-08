defmodule SymphonyElixir.Orchestrator.TokenDeltaTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Orchestrator.TokenDelta

  describe "for_update/2" do
    test "treats a nil running entry as a fresh run" do
      delta = TokenDelta.for_update(nil, %{usage: %{input_tokens: 10, output_tokens: 5, total_tokens: 15}})

      assert delta.input_tokens == 10
      assert delta.output_tokens == 5
      assert delta.total_tokens == 15
      assert delta.input_reported == 10
      assert delta.output_reported == 5
      assert delta.total_reported == 15
    end

    test "subtracts the previously reported cumulative totals" do
      running = %{
        codex_last_reported_input_tokens: 10,
        codex_last_reported_output_tokens: 5,
        codex_last_reported_total_tokens: 15
      }

      delta = TokenDelta.for_update(running, %{usage: %{input_tokens: 30, output_tokens: 12, total_tokens: 42}})

      assert delta.input_tokens == 20
      assert delta.output_tokens == 7
      assert delta.total_tokens == 27
      assert delta.input_reported == 30
      assert delta.total_reported == 42
    end

    test "clamps deltas at zero when a report regresses" do
      running = %{codex_last_reported_total_tokens: 100}

      delta = TokenDelta.for_update(running, %{usage: %{total_tokens: 40}})

      assert delta.total_tokens == 0
      assert delta.total_reported == 40
    end

    test "keeps the previous reported total when the usage key is missing" do
      running = %{codex_last_reported_input_tokens: 8}

      delta = TokenDelta.for_update(running, %{usage: %{}})

      assert delta.input_tokens == 0
      assert delta.input_reported == 8
    end

    test "returns zero deltas when the update carries no usage" do
      delta = TokenDelta.for_update(%{codex_last_reported_total_tokens: 3}, %{})

      assert delta.total_tokens == 0
      assert delta.total_reported == 3
    end
  end
end
