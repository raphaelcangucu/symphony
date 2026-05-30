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

  test "proposes a Next.js serve step on PORT/3000", %{root: root} do
    File.write!(Path.join(root, "package.json"), ~s({"dependencies":{"next":"14.0.0"}}))
    File.write!(Path.join(root, "next.config.js"), "module.exports = {}")

    steps = HeuristicDiscoverer.discover(root)
    serve = Enum.find(steps, &(&1.role == "serve"))

    assert serve
    assert serve.command == "npm run dev"
    assert serve.port_env == "PORT"
    assert serve.ready_probe == "http"
    assert serve.primary
  end

  test "proposes a Vite serve step", %{root: root} do
    File.write!(Path.join(root, "package.json"), ~s({"devDependencies":{"vite":"5.0.0"}}))
    File.write!(Path.join(root, "vite.config.ts"), "export default {}")

    serve = root |> HeuristicDiscoverer.discover() |> Enum.find(&(&1.role == "serve"))
    assert serve
    assert serve.command == "npm run dev"
    assert serve.ready_probe == "http"
  end

  test "proposes a Phoenix serve step", %{root: root} do
    File.write!(Path.join(root, "mix.exs"), "defmodule App.MixProject do\n  :phoenix\nend\n")

    serve = root |> HeuristicDiscoverer.discover() |> Enum.find(&(&1.role == "serve"))
    assert serve
    assert serve.description == "Run Phoenix server"
    assert serve.command == "mix phx.server"
    assert serve.ready_probe == "http"
  end

  test "proposes a generic JS dev server when scripts.dev exists", %{root: root} do
    File.write!(Path.join(root, "package.json"), ~s({"scripts":{"dev":"astro dev"}}))

    serve = root |> HeuristicDiscoverer.discover() |> Enum.find(&(&1.role == "serve"))
    assert serve
    assert serve.description == "Run dev server"
    assert serve.command == "npm run dev"
    assert serve.ready_probe == "tcp"
  end

  @install_markers [
    {"mix.exs", "mix deps.get"},
    {"pnpm-lock.yaml", "pnpm install"},
    {"yarn.lock", "yarn install"},
    {"package-lock.json", "npm ci"},
    {"package.json", "npm install"},
    {"requirements.txt", "pip install -r requirements.txt"},
    {"Gemfile", "bundle install"},
    {"go.mod", "go mod download"},
    {"Cargo.toml", "cargo fetch"}
  ]

  for {marker, command} <- @install_markers do
    test "proposes `#{command}` when #{marker} present" do
      root = Path.join(System.tmp_dir!(), "heur-marker-#{System.unique_integer([:positive])}")
      File.mkdir_p!(root)
      on_exit(fn -> File.rm_rf!(root) end)
      File.write!(Path.join(root, unquote(marker)), "x")

      steps = HeuristicDiscoverer.discover(root)
      assert Enum.any?(steps, &(&1.command == unquote(command)))
    end
  end
end
