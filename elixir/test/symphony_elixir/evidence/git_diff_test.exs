defmodule SymphonyElixir.Evidence.GitDiffTest do
  use ExUnit.Case, async: true

  import SymphonyElixir.GitFixtures

  alias SymphonyElixir.Evidence.GitDiff

  @moduletag :tmp_dir

  test "changed_files lists files vs merge-base per repo", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "frontend")

    sh!(repo, """
    git checkout -b feat/x && mkdir -p src &&
    echo a > src/App.tsx && echo b > README2.md &&
    git add -A && git commit -m work
    """)

    assert %{"frontend" => files} = GitDiff.changed_files(ws)
    assert Enum.sort(files) == ["README2.md", "src/App.tsx"]
  end

  test "uncommitted changes are included", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "backend")
    sh!(repo, "echo dirty > new.php")

    assert %{"backend" => ["new.php"]} = GitDiff.changed_files(ws)
  end

  test "clean repos are omitted", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    make_repo!(tmp_dir, ws, "frontend")

    assert GitDiff.changed_files(ws) == %{}
  end

  test "an orphan .git at the workspace root does not mask real sub-repos", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    # A partial/orphan `.git` at the workspace root is not a valid repo; it must
    # not short-circuit discovery and hide the genuine sub-repos beneath it.
    File.mkdir_p!(Path.join(ws, ".git"))
    repo = make_repo!(tmp_dir, ws, "frontend")
    sh!(repo, "mkdir -p src && echo a > src/App.tsx && git add -A && git commit -m work")

    assert %{"frontend" => ["src/App.tsx"]} = GitDiff.changed_files(ws)
  end

  test "ui_change? matches ui_paths globs against repo-prefixed paths" do
    changed = %{"frontend" => ["src/App.tsx"], "backend" => ["app/Service.php"]}
    assert GitDiff.ui_change?(changed, ["frontend/src/**"])
    refute GitDiff.ui_change?(changed, ["frontend/styles/**"])
    refute GitDiff.ui_change?(%{}, ["frontend/src/**"])
    refute GitDiff.ui_change?(changed, [])
  end

  test "paths_match? matches repo-relative files against repo-relative globs" do
    assert GitDiff.paths_match?(["src/App.tsx"], ["src/**"])
    assert GitDiff.paths_match?(["routes/api.php"], ["app/Http/**", "routes/**"])
    refute GitDiff.paths_match?(["app/Services/Internal.php"], ["app/Http/**", "routes/**"])
    refute GitDiff.paths_match?(["src/App.tsx"], [])
    refute GitDiff.paths_match?([], ["src/**"])
  end
end
