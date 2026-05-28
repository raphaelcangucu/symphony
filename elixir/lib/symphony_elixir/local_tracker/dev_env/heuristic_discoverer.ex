defmodule SymphonyElixir.LocalTracker.DevEnv.HeuristicDiscoverer do
  @moduledoc """
  Proposes dev-env steps from repo conventions when no `.symphony/devenv.*` exists:
  mise, Docker Compose, `.env.example`, and package-manager install/test scripts.
  """

  alias SymphonyElixir.LocalTracker.DevEnv.ProposedStep

  @compose_files ~w(docker-compose.yml docker-compose.yaml compose.yml compose.yaml)

  @install_markers [
    {"mix.exs", "Fetch Elixir deps", "mix deps.get"},
    {"pnpm-lock.yaml", "Install JS deps", "pnpm install"},
    {"yarn.lock", "Install JS deps", "yarn install"},
    {"package-lock.json", "Install JS deps", "npm ci"},
    {"package.json", "Install JS deps", "npm install"},
    {"requirements.txt", "Install Python deps", "pip install -r requirements.txt"},
    {"Gemfile", "Install Ruby deps", "bundle install"},
    {"go.mod", "Download Go modules", "go mod download"},
    {"Cargo.toml", "Fetch Rust crates", "cargo fetch"}
  ]

  @spec discover(Path.t()) :: [ProposedStep.t()]
  def discover(repo_root) when is_binary(repo_root) do
    [
      mise_step(repo_root),
      env_step(repo_root),
      install_step(repo_root),
      compose_step(repo_root)
    ]
    |> Enum.reject(&is_nil/1)
  end

  defp mise_step(root) do
    if exists_any?(root, [".mise.toml", "mise.toml", ".tool-versions"]) do
      step("Install tool versions", "mise install")
    end
  end

  defp env_step(root) do
    if File.exists?(Path.join(root, ".env.example")) do
      step("Create .env from example", "cp .env.example .env", optional: true)
    end
  end

  defp compose_step(root) do
    if exists_any?(root, @compose_files) do
      step("Start Docker services", "docker compose up -d", optional: true)
    end
  end

  defp install_step(root) do
    Enum.find_value(@install_markers, fn {file, description, command} ->
      if File.exists?(Path.join(root, file)), do: step(description, command)
    end)
  end

  defp exists_any?(root, names), do: Enum.any?(names, &File.exists?(Path.join(root, &1)))

  defp step(description, command, opts \\ []) do
    ProposedStep.new(%{
      description: description,
      command: command,
      source: "heuristic",
      optional: Keyword.get(opts, :optional, false)
    })
  end
end
