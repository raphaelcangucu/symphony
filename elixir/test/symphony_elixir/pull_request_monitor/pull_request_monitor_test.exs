defmodule SymphonyElixir.PullRequestMonitorTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.PullRequestMonitor
  alias SymphonyElixir.Repo

  setup do
    migrate_repo()
    SymphonyElixir.TestSupport.truncate_tracker!(Repo)
    :ok
  end

  describe "decide/4" do
    test "verdict table" do
      assert PullRequestMonitor.decide(:merged, nil, 0, 2) == :move_done
      assert PullRequestMonitor.decide(:ci_failure, "pr_caused", 0, 2) == :move_rework
      assert PullRequestMonitor.decide(:ci_failure, "pr_caused", 1, 2) == :move_rework
      assert PullRequestMonitor.decide(:ci_failure, "pr_caused", 2, 2) == {:stay, :limit_reached}
      assert PullRequestMonitor.decide(:ci_failure, "unrelated", 0, 2) == {:stay, :unrelated}
      assert PullRequestMonitor.decide(:ci_failure, "needs_human", 0, 2) == {:stay, :needs_human}
      assert PullRequestMonitor.decide(:review_findings, "fixable_by_agent", 0, 2) == :move_rework
      assert PullRequestMonitor.decide(:review_findings, "fixable_by_agent", 2, 2) == {:stay, :limit_reached}
      assert PullRequestMonitor.decide(:review_findings, "needs_human", 0, 2) == {:stay, :needs_human}
      assert PullRequestMonitor.decide(:review_findings, "unrelated", 0, 2) == {:stay, :needs_human}
    end
  end

  defp migrate_repo do
    {:ok, _repo, _apps} =
      Ecto.Migrator.with_repo(Repo, fn repo ->
        Ecto.Migrator.run(repo, :up, all: true)
      end)
  end
end
