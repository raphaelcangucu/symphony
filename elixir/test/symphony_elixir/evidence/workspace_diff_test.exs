defmodule SymphonyElixir.Evidence.WorkspaceDiffTest do
  use ExUnit.Case, async: true

  import SymphonyElixir.GitFixtures

  alias SymphonyElixir.Evidence.WorkspaceDiff

  @moduletag :tmp_dir

  test "branch diff includes branch metadata on each repo", %{tmp_dir: tmp_dir} do
    ws = Path.join(tmp_dir, "GAM-9")
    File.mkdir_p!(ws)
    repo = make_repo!(tmp_dir, ws, "frontend")

    sh!(
      repo,
      "git checkout -b feat/x && mkdir -p src && printf 'a\\n' > src/App.tsx && git add -A && git commit -m work"
    )

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
end
