defmodule SymphonyElixir.LocalTracker.DevEnv.ProposerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.DevEnv.Proposer

  setup do
    root = Path.join(System.tmp_dir!(), "prop-#{System.unique_integer([:positive])}")
    File.mkdir_p!(Path.join(root, "api"))
    File.mkdir_p!(Path.join(root, "web"))
    on_exit(fn -> File.rm_rf!(root) end)
    %{root: root}
  end

  test "convention file wins over heuristics for that repo", %{root: root} do
    File.mkdir_p!(Path.join(root, "api/.symphony"))
    File.write!(Path.join(root, "api/.symphony/devenv.yaml"), "steps:\n  - command: make setup\n")
    File.write!(Path.join(root, "api/mix.exs"), "defmodule X do\nend\n")

    steps = Proposer.propose(root, [%{workspace_path: "api", github_full_name: "g/api"}])
    api_commands = Enum.map(steps, & &1.command)
    assert "make setup" in api_commands
    refute "mix deps.get" in api_commands
    assert Enum.all?(steps, &(&1.working_dir == "api"))
  end

  test "falls back to heuristics when no convention", %{root: root} do
    File.write!(Path.join(root, "web/package.json"), "{}")
    steps = Proposer.propose(root, [%{workspace_path: "web", github_full_name: "g/web"}])
    assert Enum.any?(steps, &(&1.command == "npm install"))
    assert Enum.all?(steps, &(&1.working_dir == "web"))
  end

  test "keeps a step's own working_dir instead of the repo workspace_path", %{root: root} do
    File.mkdir_p!(Path.join(root, "api/.symphony"))
    File.write!(Path.join(root, "api/.symphony/devenv.yaml"), "steps:\n  - command: make x\n    working_dir: sub\n")

    steps = Proposer.propose(root, [%{workspace_path: "api", github_full_name: "g/api"}])

    assert [%{command: "make x", working_dir: "sub"}] = steps
  end

  test "merges multiple repos preserving order", %{root: root} do
    File.write!(Path.join(root, "api/mix.exs"), "x")
    File.write!(Path.join(root, "web/package.json"), "{}")

    steps =
      Proposer.propose(root, [
        %{workspace_path: "api", github_full_name: "g/api"},
        %{workspace_path: "web", github_full_name: "g/web"}
      ])

    dirs = steps |> Enum.map(& &1.working_dir) |> Enum.uniq()
    assert dirs == ["api", "web"]
  end
end
