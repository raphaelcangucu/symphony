defmodule SymphonyElixir.Orchestrator.TokenDelta do
  @moduledoc """
  Computes the per-update token delta for a running agent from a live usage
  report.

  Agents report *cumulative* token totals, so each update's incremental burn is
  the reported total minus the previously seen ("reported") total. Deltas are
  clamped at zero to absorb resets or out-of-order reports, and the new reported
  totals are surfaced so the caller can persist them on the running entry.

  Pure: stdlib only, no orchestrator state and no side effects.
  """

  @typedoc "Incremental token burn for one update plus the new cumulative totals."
  @type t :: %{
          input_tokens: non_neg_integer(),
          output_tokens: non_neg_integer(),
          total_tokens: non_neg_integer(),
          input_reported: integer(),
          output_reported: integer(),
          total_reported: integer()
        }

  @doc """
  Returns the incremental input/output/total token deltas for `update`, plus the
  new cumulative "reported" totals, relative to the `running_entry`'s previously
  reported totals. A `nil` running entry is treated as a fresh run.
  """
  @spec for_update(map() | nil, map()) :: t()
  def for_update(running_entry, update) do
    running_entry = running_entry || %{}
    usage = update[:usage] || %{}

    {
      compute(running_entry, usage, :input_tokens, :codex_last_reported_input_tokens),
      compute(running_entry, usage, :output_tokens, :codex_last_reported_output_tokens),
      compute(running_entry, usage, :total_tokens, :codex_last_reported_total_tokens)
    }
    |> then(fn {input, output, total} ->
      %{
        input_tokens: input.delta,
        output_tokens: output.delta,
        total_tokens: total.delta,
        input_reported: input.reported,
        output_reported: output.reported,
        total_reported: total.reported
      }
    end)
  end

  defp compute(running_entry, usage, token_key, reported_key) do
    next_total = Map.get(usage, token_key)
    prev_reported = Map.get(running_entry, reported_key, 0)

    delta =
      if is_integer(next_total) and next_total >= prev_reported do
        next_total - prev_reported
      else
        0
      end

    %{
      delta: max(delta, 0),
      reported: if(is_integer(next_total), do: next_total, else: prev_reported)
    }
  end
end
