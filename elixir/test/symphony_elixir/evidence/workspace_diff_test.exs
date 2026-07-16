defmodule SymphonyElixir.Evidence.WorkspaceDiffTest do
  use ExUnit.Case, async: true

  import SymphonyElixir.GitFixtures

  alias SymphonyElixir.Evidence.WorkspaceDiff
  alias SymphonyElixir.RunContract

  @moduletag :tmp_dir

  test "branch diff includes branch metadata on each repo", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "frontend")

    sh!(
      repo,
      """
      git checkout -b feat/x &&
      mkdir -p src && printf 'a\\n' > src/App.tsx && git add -A && git commit -m work &&
      git push -u origin feat/x
      """
    )

    [%{ahead_count: 0}] = RunContract.repo_states(ws)

    assert {:ok, [entry]} = WorkspaceDiff.changes(ws, :branch)
    assert entry.repo == "frontend"
    assert entry.branch == "feat/x"
    assert entry.base == "main"
    assert is_integer(entry.ahead)
    assert entry.ahead >= 1
    assert is_integer(entry.behind) or is_nil(entry.behind)
    assert [%{path: "src/App.tsx"}] = entry.files
  end

  test "branch diff returns per-file patches vs origin default base", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "frontend")

    sh!(repo, "git checkout -b feat/x && mkdir -p src && printf 'a\\n' > src/App.tsx && git add -A && git commit -m work")

    assert {:ok, [%{repo: "frontend", files: files}]} = WorkspaceDiff.changes(ws, :branch)
    assert [%{path: "src/App.tsx", status: "added", old_path: nil, patch: patch}] = files
    assert patch =~ "src/App.tsx"
    assert patch =~ "+a"
  end

  test "uncommitted diff includes tracked edits and untracked files", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "backend")

    sh!(repo, "printf 'changed\\n' > README.md && printf 'new\\n' > new.txt")

    assert {:ok, [%{repo: "backend", files: files}]} = WorkspaceDiff.changes(ws, :uncommitted)
    paths = files |> Enum.map(& &1.path) |> Enum.sort()
    assert paths == ["README.md", "new.txt"]
    assert Enum.find(files, &(&1.path == "new.txt")).status == "added"
    assert Enum.find(files, &(&1.path == "README.md")).status == "modified"
    assert Enum.all?(files, &(&1.patch =~ &1.path))
  end

  test "clean repos are omitted", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    make_repo!(tmp_dir, ws, "frontend")

    assert {:ok, []} = WorkspaceDiff.changes(ws, :uncommitted)
  end

  test "missing workspace yields an empty list", %{tmp_dir: tmp_dir} do
    assert {:ok, []} = WorkspaceDiff.changes(Path.join(tmp_dir, "nope"), :branch)
  end

  test "invalid type is rejected", %{tmp_dir: tmp_dir} do
    assert {:error, :invalid_diff_type} = WorkspaceDiff.changes(tmp_dir, :bogus)
  end

  test "legacy changes caps total files across repos and flags truncation", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)

    {:ok, counter} = Agent.start_link(fn -> 0 end)

    assert {:ok, [entry]} =
             WorkspaceDiff.changes(ws, :branch, runner: counting_fake_runner(counter, 400))

    assert length(entry.files) == 300
    assert entry.truncated == true
  end

  describe "stats/2" do
    test "aggregates numstat totals plus untracked count, no patches", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      repo = make_repo!(tmp_dir, ws, "backend")

      sh!(repo, "printf 'line1\\nline2\\nchanged\\n' > README.md && printf 'new\\n' > new.txt")

      assert {:ok, [stat]} = WorkspaceDiff.stats(ws, type: :uncommitted)
      assert stat.repo == "backend"
      assert stat.files_changed == 2
      assert stat.untracked == 1
      assert stat.additions >= 2
      refute Map.has_key?(stat, :files)
      refute Map.has_key?(stat, :patch)
    end

    test "branch stats omit untracked and use the origin default base", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      repo = make_repo!(tmp_dir, ws, "frontend")

      sh!(repo, "git checkout -b feat/x && mkdir -p src && printf 'a\\nb\\n' > src/App.tsx && git add -A && git commit -m work")

      assert {:ok, [stat]} = WorkspaceDiff.stats(ws, type: :branch)
      assert stat.base == "main"
      assert stat.untracked == 0
      assert stat.files_changed == 1
      assert stat.additions == 2
    end

    test "clean repos are omitted from stats", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      make_repo!(tmp_dir, ws, "frontend")

      assert {:ok, []} = WorkspaceDiff.stats(ws, type: :uncommitted)
    end

    test "invalid type is rejected", %{tmp_dir: tmp_dir} do
      assert {:error, :invalid_diff_type} = WorkspaceDiff.stats(tmp_dir, type: :bogus)
    end

    test "runs a constant number of git commands regardless of how many files changed", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "repo")
      File.mkdir_p!(ws)

      {:ok, small_counter} = Agent.start_link(fn -> 0 end)
      {:ok, large_counter} = Agent.start_link(fn -> 0 end)

      assert {:ok, [small]} = WorkspaceDiff.stats(ws, type: :branch, runner: counting_fake_runner(small_counter, 5))
      assert {:ok, [large]} = WorkspaceDiff.stats(ws, type: :branch, runner: counting_fake_runner(large_counter, 2000))

      assert small.files_changed == 5
      assert large.files_changed == 2000
      assert Agent.get(small_counter, & &1) == Agent.get(large_counter, & &1)
    end
  end

  describe "list_files/2" do
    test "merges name-status, numstat, and untracked files in memory", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      repo = make_repo!(tmp_dir, ws, "backend")

      sh!(repo, "printf 'changed\\n' > README.md && printf 'new\\n' > new.txt")

      assert {:ok, %{files: files, total: 2, limit: 100, next_cursor: nil}} =
               WorkspaceDiff.list_files(ws, type: :uncommitted)

      paths = files |> Enum.map(& &1.path) |> Enum.sort()
      assert paths == ["README.md", "new.txt"]

      readme = Enum.find(files, &(&1.path == "README.md"))
      assert readme.status == "modified"
      assert readme.repo == "backend"
      assert is_integer(readme.additions)
      refute Map.has_key?(readme, :patch)

      untracked = Enum.find(files, &(&1.path == "new.txt"))
      assert untracked.status == "added"
      assert is_nil(untracked.additions)
      assert untracked.binary == false
    end

    test "filters by q (case-insensitive substring on path)", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      repo = make_repo!(tmp_dir, ws, "backend")

      sh!(repo, "printf 'x\\n' > alpha.txt && printf 'y\\n' > beta.txt")

      assert {:ok, %{files: [%{path: "alpha.txt"}]}} = WorkspaceDiff.list_files(ws, type: :uncommitted, q: "ALPHA")
    end

    test "filters by repo across a multi-repo workspace", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      frontend = make_repo!(tmp_dir, ws, "frontend")
      backend = make_repo!(tmp_dir, ws, "backend")
      sh!(frontend, "printf 'x\\n' > a.txt")
      sh!(backend, "printf 'y\\n' > b.txt")

      assert {:ok, %{files: [%{repo: "frontend", path: "a.txt"}]}} =
               WorkspaceDiff.list_files(ws, type: :uncommitted, repo: "frontend")
    end

    test "pages through results with opaque cursors and a small limit", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      repo = make_repo!(tmp_dir, ws, "backend")
      sh!(repo, "printf 'a\\n' > a.txt && printf 'b\\n' > b.txt && printf 'c\\n' > c.txt")

      assert {:ok, %{files: [f1], next_cursor: cursor1, total: 3}} =
               WorkspaceDiff.list_files(ws, type: :uncommitted, limit: 1)

      assert {:ok, %{files: [f2], next_cursor: cursor2, total: 3}} =
               WorkspaceDiff.list_files(ws, type: :uncommitted, limit: 1, cursor: cursor1)

      assert {:ok, %{files: [f3], next_cursor: nil, total: 3}} =
               WorkspaceDiff.list_files(ws, type: :uncommitted, limit: 1, cursor: cursor2)

      assert [f1.path, f2.path, f3.path] |> Enum.sort() == ["a.txt", "b.txt", "c.txt"]
    end

    test "invalid cursor is rejected", %{tmp_dir: tmp_dir} do
      assert {:error, :invalid_cursor} = WorkspaceDiff.list_files(tmp_dir, type: :uncommitted, cursor: "not-base64!!")
    end

    test "invalid type is rejected", %{tmp_dir: tmp_dir} do
      assert {:error, :invalid_diff_type} = WorkspaceDiff.list_files(tmp_dir, type: :bogus)
    end

    test "runs a constant number of git commands regardless of how many files changed", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "repo")
      File.mkdir_p!(ws)

      {:ok, small_counter} = Agent.start_link(fn -> 0 end)
      {:ok, large_counter} = Agent.start_link(fn -> 0 end)

      assert {:ok, %{files: small_files, total: 5}} =
               WorkspaceDiff.list_files(ws, type: :branch, runner: counting_fake_runner(small_counter, 5))

      assert {:ok, %{files: large_files, total: 2000}} =
               WorkspaceDiff.list_files(ws, type: :branch, runner: counting_fake_runner(large_counter, 2000), limit: 500)

      assert length(small_files) == 5
      assert length(large_files) == 500
      assert Agent.get(small_counter, & &1) == Agent.get(large_counter, & &1)
    end
  end

  describe "repo_summaries/1" do
    test "returns branch and ahead metadata for clean repos", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      repo = make_repo!(tmp_dir, ws, "advising")

      sh!(repo, "git checkout -b feat/local")

      assert {:ok, [%{repo: "advising", branch: "feat/local", ahead_count: 0, dirty?: false}]} =
               WorkspaceDiff.repo_summaries(ws)
    end

    test "includes dirty repos with uncommitted files", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      repo = make_repo!(tmp_dir, ws, "frontend")

      sh!(repo, "printf 'dirty\\n' > dirty.txt")

      assert {:ok, [summary]} = WorkspaceDiff.repo_summaries(ws)
      assert summary.repo == "frontend"
      assert summary.dirty? == true
    end

    test "reports ahead_count when local commits are not on origin", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      repo = make_repo!(tmp_dir, ws, "frontend")

      sh!(
        repo,
        """
        git checkout -b feat/ahead &&
        mkdir -p src && printf 'a\\n' > src/App.tsx && git add -A && git commit -m work &&
        git push -u origin feat/ahead &&
        printf 'b\\n' >> src/App.tsx && git add -A && git commit -m more
        """
      )

      assert {:ok, [summary]} = WorkspaceDiff.repo_summaries(ws)
      assert summary.repo == "frontend"
      assert summary.branch == "feat/ahead"
      assert summary.ahead_count >= 1
      assert summary.dirty? == false
    end

    test "missing workspace yields an empty list", %{tmp_dir: tmp_dir} do
      assert {:ok, []} = WorkspaceDiff.repo_summaries(Path.join(tmp_dir, "nope"))
    end
  end

  describe "patch/3" do
    test "returns the patch for exactly one tracked file", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      repo = make_repo!(tmp_dir, ws, "backend")
      sh!(repo, "printf 'changed\\n' > README.md")

      assert {:ok, result} = WorkspaceDiff.patch(ws, :uncommitted, repo: "backend", path: "README.md")
      assert result.repo == "backend"
      assert result.path == "README.md"
      assert result.status == "modified"
      assert result.binary == false
      assert result.truncated == false
      assert result.patch =~ "README.md"
      assert result.patch =~ "+changed"
    end

    test "returns the patch for an untracked file", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      repo = make_repo!(tmp_dir, ws, "backend")
      sh!(repo, "printf 'new\\n' > new.txt")

      assert {:ok, result} = WorkspaceDiff.patch(ws, :uncommitted, repo: "backend", path: "new.txt")
      assert result.status == "added"
      assert result.patch =~ "+new"
    end

    test "truncates a huge patch by line count", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      repo = make_repo!(tmp_dir, ws, "backend")
      original = Enum.map_join(1..500, "\n", &"line #{&1}")
      changed = Enum.map_join(1..500, "\n", &"line #{&1}x")
      File.write!(Path.join(repo, "big.txt"), original <> "\n")
      sh!(repo, "git add -A && git commit -m big")
      File.write!(Path.join(repo, "big.txt"), changed <> "\n")

      assert {:ok, result} =
               WorkspaceDiff.patch(ws, :uncommitted, repo: "backend", path: "big.txt", max_lines: 10)

      assert result.truncated == true
      assert length(String.split(result.patch, "\n")) <= 10
    end

    test "flags binary diffs", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      repo = make_repo!(tmp_dir, ws, "backend")
      File.write!(Path.join(repo, "bin.dat"), <<0, 1, 2, 3, 0, 255>>)

      assert {:ok, result} = WorkspaceDiff.patch(ws, :uncommitted, repo: "backend", path: "bin.dat")
      assert result.binary == true
    end

    test "rejects path traversal outside the repo", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      make_repo!(tmp_dir, ws, "backend")

      assert {:error, :invalid_file_path} =
               WorkspaceDiff.patch(ws, :uncommitted, repo: "backend", path: "../../etc/passwd")
    end

    test "rejects an unknown repo", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      make_repo!(tmp_dir, ws, "backend")

      assert {:error, :repo_not_found} =
               WorkspaceDiff.patch(ws, :uncommitted, repo: "nope", path: "README.md")
    end

    test "reports a missing file as not found", %{tmp_dir: tmp_dir} do
      ws = Path.join(tmp_dir, "GAM-9")
      File.mkdir_p!(ws)
      make_repo!(tmp_dir, ws, "backend")

      assert {:error, :file_not_found} =
               WorkspaceDiff.patch(ws, :uncommitted, repo: "backend", path: "does-not-exist.txt")
    end

    test "requires repo and path", %{tmp_dir: tmp_dir} do
      assert {:error, :repo_required} = WorkspaceDiff.patch(tmp_dir, :uncommitted, path: "README.md")
      assert {:error, :path_required} = WorkspaceDiff.patch(tmp_dir, :uncommitted, repo: "backend")
    end
  end

  # Simulates a workspace with a single repo (the workspace root itself) that
  # has `file_count` changed files, without touching disk or spawning real git
  # processes for each file — lets tests assert the number of git subprocess
  # calls stays constant as the simulated diff size grows.
  defp counting_fake_runner(counter, file_count) do
    fn "git", args, opts ->
      Agent.update(counter, &(&1 + 1))
      cd = Keyword.fetch!(opts, :cd)
      {fake_git_output(args, cd, file_count), 0}
    end
  end

  defp fake_git_output(["rev-parse", "--show-toplevel"], cd, _n), do: cd
  defp fake_git_output(["branch", "--show-current"], _cd, _n), do: "main"
  defp fake_git_output(["rev-parse", "--abbrev-ref", "origin/HEAD"], _cd, _n), do: "origin/main"
  defp fake_git_output(["ls-files", "--others", "--exclude-standard"], _cd, _n), do: ""

  defp fake_git_output(["diff", "--no-color", "--no-renames", "--name-status" | _rest], _cd, n) do
    Enum.map_join(1..n, "\n", &"M\tfile#{&1}.txt")
  end

  defp fake_git_output(["diff", "--no-color", "--no-renames", "--numstat" | _rest], _cd, n) do
    Enum.map_join(1..n, "\n", &"1\t1\tfile#{&1}.txt")
  end

  defp fake_git_output(["diff", "--no-color", "--name-status" | _rest], _cd, n) do
    Enum.map_join(1..n, "\n", &"M\tfile#{&1}.txt")
  end

  defp fake_git_output(["diff", "--no-color" | _rest], _cd, _n), do: "diff --git a/f b/f\n+fake\n"
  defp fake_git_output(_other, _cd, _n), do: ""
end
