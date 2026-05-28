defmodule SymphonyElixir.Tracker.IssueAdapterTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.LocalTracker.Project
  alias SymphonyElixir.Tracker.IssueAdapter

  describe "for/1" do
    test "resolves local adapter by default" do
      assert IssueAdapter.for(%Project{tracker_kind: "local"}) ==
               SymphonyElixir.LocalTracker.IssueAdapter
    end

    test "resolves github adapter" do
      assert IssueAdapter.for(%Project{tracker_kind: "github"}) ==
               SymphonyElixir.GitHub.IssueAdapter
    end

    test "resolves linear adapter" do
      assert IssueAdapter.for(%Project{tracker_kind: "linear"}) ==
               SymphonyElixir.Linear.IssueAdapter
    end

    test "falls back to local for nil/unknown kind" do
      assert IssueAdapter.for(%Project{tracker_kind: nil}) ==
               SymphonyElixir.LocalTracker.IssueAdapter
    end
  end
end
