defmodule SymphonyElixir.Orchestrator.IncompleteReason do
  @moduledoc """
  Human-readable text for runs that ended **incomplete** (max turns reached, or
  a validate/publish gate left unsatisfied).

  `reason_text/1` renders the short parenthetical shown in the auto-note;
  `handoff_note/1` renders the longer reviewer guidance line. Both distinguish
  environment-blocked validation (e.g. no Docker/network) from genuine
  test/evidence failures so operators know whether to fix the environment or the
  change.

  Pure: reads only from `Evidence.Gate` classification and stdlib.
  """

  alias SymphonyElixir.Evidence

  @doc """
  Reviewer guidance line explaining why the issue was (or was not) moved to
  review, tailored to the incomplete `reason`.
  """
  @spec handoff_note(term()) :: String.t()
  def handoff_note({:validate_gate, violations}) do
    cond do
      Evidence.Gate.environment_blocked_only?(violations) ->
        "- The issue was **not** moved to review — required tests could not run in the workspace environment (e.g. no Docker/network). This is an environment blocker, not necessarily a code failure: fix the environment (or sandbox capabilities) and re-dispatch."

      Enum.any?(violations, &(&1.kind == :judge_rejected)) ->
        reasons = violations |> Enum.filter(&(&1.kind == :judge_rejected)) |> Enum.map_join("; ", & &1.detail)
        "- The issue was **not** moved to review — the independent validation judge rejected the evidence (#{reasons}). The tests do not yet prove the change; fix the tests/evidence and re-dispatch."

      true ->
        "- The issue was **not** moved to review — evidence/validation is missing or failing."
    end
  end

  def handoff_note({:publish_gate, _}),
    do: "- The issue was **not** moved to review — publish requirements (PRs / pushed branches) are unsatisfied."

  def handoff_note(_),
    do: "- No pull request was confirmed for this issue at handoff.\n    > - The issue was moved to its review state automatically by the orchestrator, not by the agent finishing the work."

  @doc """
  Short parenthetical describing why the run ended incomplete.
  """
  @spec reason_text(term()) :: String.t()
  def reason_text(:max_turns), do: "reached the configured max turns with the issue still active"

  def reason_text({:publish_gate, _violations}),
    do: "ended with the publish gate unsatisfied (deliverables missing)"

  def reason_text({:validate_gate, violations}) do
    if Evidence.Gate.environment_blocked_only?(violations) do
      "ended with required tests blocked by the workspace environment (e.g. missing Docker/network), not a code failure"
    else
      "ended with the validate gate unsatisfied (test/e2e evidence missing or failing)"
    end
  end

  def reason_text(other), do: "reason=#{inspect(other)}"
end
