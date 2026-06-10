defmodule SymphonyElixir.PullRequestMonitor do
  @moduledoc """
  PR follow-up monitor core: detects PR events for wait-state issues, asks the
  classifier for a verdict, and applies the resulting transition/comment.
  See docs/superpowers/specs/2026-06-10-pr-monitor-design.md.
  """

  @type action :: :move_done | :move_rework | {:stay, :limit_reached | :unrelated | :needs_human}

  @spec decide(:merged | :ci_failure | :review_findings, String.t() | nil, non_neg_integer(), pos_integer()) ::
          action()
  def decide(:merged, _verdict, _count, _max), do: :move_done
  def decide(:ci_failure, "pr_caused", count, max) when count < max, do: :move_rework
  def decide(:ci_failure, "pr_caused", _count, _max), do: {:stay, :limit_reached}
  def decide(:ci_failure, "unrelated", _count, _max), do: {:stay, :unrelated}
  def decide(:ci_failure, _verdict, _count, _max), do: {:stay, :needs_human}
  def decide(:review_findings, "fixable_by_agent", count, max) when count < max, do: :move_rework
  def decide(:review_findings, "fixable_by_agent", _count, _max), do: {:stay, :limit_reached}
  def decide(:review_findings, _verdict, _count, _max), do: {:stay, :needs_human}
end
