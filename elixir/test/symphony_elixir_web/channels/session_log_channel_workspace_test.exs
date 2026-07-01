defmodule SymphonyElixirWeb.SessionLogChannelWorkspaceTest do
  use ExUnit.Case, async: true

  alias SymphonyElixirWeb.SessionLogChannel

  @moduletag :tmp_dir

  describe "worktree_log_workspace/2" do
    test "returns the child worktree path when it exists on disk", %{tmp_dir: tmp} do
      repo = Path.join(tmp, "back")
      worktree = Path.join([repo, ".worktrees", "MAC-13"])
      File.mkdir_p!(worktree)

      run_opts = [worktree: true, worktree_repo: repo, unit_id: "MAC-13"]

      assert SessionLogChannel.worktree_log_workspace(run_opts, "/fallback") == worktree
    end

    test "falls back when the worktree directory is not on disk yet", %{tmp_dir: tmp} do
      repo = Path.join(tmp, "back")
      File.mkdir_p!(repo)

      run_opts = [worktree: true, worktree_repo: repo, unit_id: "MAC-13"]

      assert SessionLogChannel.worktree_log_workspace(run_opts, "/fallback") == "/fallback"
    end

    test "falls back for a standalone run (no worktree opts)" do
      assert SessionLogChannel.worktree_log_workspace([], "/fallback") == "/fallback"
    end

    test "falls back when worktree_repo is missing" do
      assert SessionLogChannel.worktree_log_workspace([worktree: true, unit_id: "MAC-13"], "/fb") ==
               "/fb"
    end

    test "sanitizes the unit id into the worktree slug", %{tmp_dir: tmp} do
      repo = Path.join(tmp, "back")
      worktree = Path.join([repo, ".worktrees", "MAC-13"])
      File.mkdir_p!(worktree)

      run_opts = [worktree: true, worktree_repo: repo, unit_id: "MAC/13"]

      assert SessionLogChannel.worktree_log_workspace(run_opts, "/fallback") == worktree
    end
  end
end
