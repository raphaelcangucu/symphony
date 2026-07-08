defmodule SymphonyElixir.Orchestrator.AgentTotals do
  @moduledoc """
  Cumulative agent token/runtime accounting for the orchestrator.

  Holds the canonical "totals" shape (`input_tokens`, `output_tokens`,
  `total_tokens`, `seconds_running`) and the pure folds that add a
  `TokenDelta` into either the global totals map or a per-project totals map.

  Pure: stdlib only, no orchestrator state and no side effects. Counters are
  clamped at zero so a negative delta can never produce a negative total.
  """

  @type totals :: %{
          input_tokens: non_neg_integer(),
          output_tokens: non_neg_integer(),
          total_tokens: non_neg_integer(),
          seconds_running: non_neg_integer()
        }

  @empty %{
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    seconds_running: 0
  }

  @doc "The zero-valued totals map used to seed new agents and projects."
  @spec empty() :: totals()
  def empty, do: @empty

  @doc """
  Folds `token_delta` into `totals`, clamping every counter at zero.

  `seconds_running` is optional on the delta and defaults to `0` when absent.
  """
  @spec apply_delta(map(), map()) :: totals()
  def apply_delta(totals, token_delta) when is_map(totals) and is_map(token_delta) do
    %{
      input_tokens: clamp(get(totals, :input_tokens) + get(token_delta, :input_tokens)),
      output_tokens: clamp(get(totals, :output_tokens) + get(token_delta, :output_tokens)),
      total_tokens: clamp(get(totals, :total_tokens) + get(token_delta, :total_tokens)),
      seconds_running: clamp(get(totals, :seconds_running) + get(token_delta, :seconds_running))
    }
  end

  @doc """
  Folds `token_delta` into the totals for `project_slug` inside `by_project`.

  A blank or non-binary `project_slug` is ignored and `by_project` is returned
  unchanged, so callers never have to guard the slug themselves.
  """
  @spec apply_project_delta(map(), term(), map()) :: map()
  def apply_project_delta(by_project, project_slug, token_delta)
      when is_map(by_project) and is_binary(project_slug) and project_slug != "" do
    current = Map.get(by_project, project_slug, @empty)
    Map.put(by_project, project_slug, apply_delta(current, token_delta))
  end

  def apply_project_delta(by_project, _project_slug, _token_delta), do: by_project

  defp get(map, key), do: Map.get(map, key, 0)

  defp clamp(value), do: max(0, value)
end
