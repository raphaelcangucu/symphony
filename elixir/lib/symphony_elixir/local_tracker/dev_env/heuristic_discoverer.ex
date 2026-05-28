defmodule SymphonyElixir.LocalTracker.DevEnv.HeuristicDiscoverer do
  @moduledoc """
  Proposes dev-env steps from repo conventions when no `.symphony/devenv.*` exists:
  mise, Docker Compose, `.env.example`, and package-manager install/test scripts.
  """

  alias SymphonyElixir.LocalTracker.DevEnv.ProposedStep

  @compose_files ~w(docker-compose.yml docker-compose.yaml compose.yml compose.yaml)

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
    cond do
      File.exists?(Path.join(root, "mix.exs")) -> step("Fetch Elixir deps", "mix deps.get")
      File.exists?(Path.join(root, "pnpm-lock.yaml")) -> step("Install JS deps", "pnpm install")
      File.exists?(Path.join(root, "yarn.lock")) -> step("Install JS deps", "yarn install")
      File.exists?(Path.join(root, "package-lock.json")) -> step("Install JS deps", "npm ci")
      File.exists?(Path.join(root, "package.json")) -> step("Install JS deps", "npm install")
      File.exists?(Path.join(root, "requirements.txt")) -> step("Install Python deps", "pip install -r requirements.txt")
      File.exists?(Path.join(root, "Gemfile")) -> step("Install Ruby deps", "bundle install")
      File.exists?(Path.join(root, "go.mod")) -> step("Download Go modules", "go mod download")
      File.exists?(Path.join(root, "Cargo.toml")) -> step("Fetch Rust crates", "cargo fetch")
      true -> nil
    end
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
