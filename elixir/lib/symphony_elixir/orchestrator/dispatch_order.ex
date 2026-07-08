defmodule SymphonyElixir.Orchestrator.DispatchOrder do
  @moduledoc """
  Deterministic ordering for issues awaiting dispatch.

  Issues are sorted by priority (1..4 first, everything else last), then by
  creation time (oldest first), then by identifier as a stable tiebreaker so the
  poll loop dispatches in a predictable order.

  Pure: sorts by `Issue` fields only, no state and no side effects.
  """

  alias SymphonyElixir.Issue

  # Issues without an explicit 1..4 priority sort after prioritized ones.
  @unprioritized_rank 5
  # max 64-bit signed int: undated issues sort after every dated one.
  @undated_sort_key 9_223_372_036_854_775_807

  @doc "Returns `issues` ordered for dispatch (priority, then age, then id)."
  @spec sort([Issue.t() | term()]) :: [Issue.t() | term()]
  def sort(issues) when is_list(issues) do
    Enum.sort_by(issues, fn
      %Issue{} = issue ->
        {priority_rank(issue.priority), created_at_sort_key(issue), issue.identifier || issue.id || ""}

      _ ->
        {priority_rank(nil), created_at_sort_key(nil), ""}
    end)
  end

  defp priority_rank(priority) when is_integer(priority) and priority in 1..4, do: priority
  defp priority_rank(_priority), do: @unprioritized_rank

  defp created_at_sort_key(%Issue{created_at: %DateTime{} = created_at}) do
    DateTime.to_unix(created_at, :microsecond)
  end

  defp created_at_sort_key(%Issue{}), do: @undated_sort_key
  defp created_at_sort_key(_issue), do: @undated_sort_key
end
