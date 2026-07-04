defmodule SymphonyElixir.Evidence.WorkspaceCommitTest do
  use ExUnit.Case, async: true

  import SymphonyElixir.GitFixtures

  alias SymphonyElixir.Evidence.WorkspaceCommit

  @moduletag :tmp_dir

  test "commits dirty repos in a workspace", %{tmp_dir: tmp_dir} do
    workspace = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(workspace)
    repo = make_repo!(tmp_dir, workspace, "frontend")

    sh!(repo, "printf 'changed\\n' > README.md && printf 'new\\n' > new.txt")

    assert {:ok, [%{repo: "frontend", sha: sha, message: "feat: save workspace changes", files: files}]} =
             WorkspaceCommit.commit(workspace, "feat: save workspace changes")

    assert String.length(sha) == 40
    assert Enum.sort(files) == ["README.md", "new.txt"]
    assert sh!(repo, "git status --porcelain") == ""
    assert String.trim(sh!(repo, "git log -1 --format=%s")) == "feat: save workspace changes"
  end

  test "rejects blank commit messages", %{tmp_dir: tmp_dir} do
    assert {:error, :invalid_commit_message} = WorkspaceCommit.commit(tmp_dir, "  ")
  end
end
