defmodule SymphonyElixir.Evidence.WorkspacePushTest do
  use ExUnit.Case, async: true

  import SymphonyElixir.GitFixtures

  alias SymphonyElixir.Evidence.WorkspacePush

  @moduletag :tmp_dir

  test "push skips repos with ahead_count 0", %{tmp_dir: tmp_dir} do
    workspace = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(workspace)
    make_repo!(tmp_dir, workspace, "frontend")

    assert {:ok, []} = WorkspacePush.push(workspace)
  end

  test "push runs git push -u origin <branch> for ahead repos", %{tmp_dir: tmp_dir} do
    workspace = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(workspace)
    repo = make_repo!(tmp_dir, workspace, "frontend")

    sh!(
      repo,
      """
      git checkout -b feat/ahead &&
      mkdir -p src && printf 'a\\n' > src/App.tsx && git add -A && git commit -m work &&
      git push -u origin feat/ahead &&
      printf 'b\\n' >> src/App.tsx && git add -A && git commit -m more
      """
    )

    assert {:ok, [%{repo: "frontend", ok: true}]} = WorkspacePush.push(workspace)
  end

  test "push returns per-repo error without force on failure", %{tmp_dir: tmp_dir} do
    workspace = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(workspace)
    repo = make_repo!(tmp_dir, workspace, "frontend")

    sh!(
      repo,
      """
      git checkout -b feat/ahead &&
      mkdir -p src && printf 'a\\n' > src/App.tsx && git add -A && git commit -m work &&
      git push -u origin feat/ahead &&
      printf 'b\\n' >> src/App.tsx && git add -A && git commit -m more
      """
    )

    runner = fn
      "git", ["push" | _], _opts -> {"rejected non-fast-forward", 1}
      "git", args, opts -> System.cmd("git", args, opts)
    end

    assert {:ok, [%{repo: "frontend", ok: false, error: error}]} =
             WorkspacePush.push(workspace, runner: runner)

    assert is_binary(error)
    assert error != ""
    assert error =~ "non-fast-forward"
  end

  test "missing workspace yields an empty list", %{tmp_dir: tmp_dir} do
    assert {:ok, []} = WorkspacePush.push(Path.join(tmp_dir, "nope"))
  end
end
