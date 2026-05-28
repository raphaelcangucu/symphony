defmodule SymphonyElixir.LocalTracker.DevEnv.HeuristicDiscovererTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.LocalTracker.DevEnv.{HeuristicDiscoverer, ProposedStep}

  setup do
    root = Path.join(System.tmp_dir!(), "heur-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    on_exit(fn -> File.rm_rf!(root) end)
    %{root: root}
  end

  test "proposes mise install when .mise.toml present", %{root: root} do
    File.write!(Path.join(root, ".mise.toml"), "[tools]\nerlang = \"28\"\n")
    steps = HeuristicDiscoverer.discover(root)
    assert Enum.any?(steps, &(&1.command == "mise install"))
    assert Enum.all?(steps, &match?(%ProposedStep{source: "heuristic"}, &1))
  end

  test "proposes docker compose up when compose file present", %{root: root} do
    File.write!(Path.join(root, "docker-compose.yml"), "services: {}\n")
    steps = HeuristicDiscoverer.discover(root)
    assert Enum.any?(steps, &(&1.command =~ "docker compose"))
  end

  test "proposes env copy when .env.example present", %{root: root} do
    File.write!(Path.join(root, ".env.example"), "KEY=1\n")
    steps = HeuristicDiscoverer.discover(root)
    assert Enum.any?(steps, &(&1.command == "cp .env.example .env"))
  end

  test "returns empty list for an empty repo", %{root: root} do
    assert HeuristicDiscoverer.discover(root) == []
  end
end
