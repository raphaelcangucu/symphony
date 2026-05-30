defmodule SymphonyElixir.LocalTracker.DevEnv.HeuristicDiscoverer do
  @moduledoc """
  Proposes dev-env steps from repo conventions when no `.symphony/devenv.*` exists:
  mise, Docker Compose, `.env.example`, and package-manager install/test scripts.
  """

  alias SymphonyElixir.LocalTracker.DevEnv.ProposedStep

  @compose_files ~w(docker-compose.yml docker-compose.yaml compose.yml compose.yaml)
  @next_config_files ~w(next.config.js next.config.mjs next.config.ts)
  @vite_config_files ~w(vite.config.js vite.config.ts vite.config.mjs)

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
      compose_step(repo_root),
      serve_step(repo_root)
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

  defp serve_step(root) do
    cond do
      next?(root) -> serve("Run Next.js dev server", "npm run dev", "PORT", "http")
      vite?(root) -> serve("Run Vite dev server", "npm run dev", "PORT", "http")
      phoenix?(root) -> serve("Run Phoenix server", "mix phx.server", "PORT", "http")
      has_dev_script?(root) -> serve("Run dev server", "npm run dev", "PORT", "tcp")
      true -> nil
    end
  end

  defp next?(root), do: exists_any?(root, @next_config_files) or package_dependency?(root, "next")

  defp vite?(root), do: exists_any?(root, @vite_config_files) or package_dependency?(root, "vite")

  defp phoenix?(root) do
    mix_path = Path.join(root, "mix.exs")

    case File.read(mix_path) do
      {:ok, contents} -> String.contains?(contents, ":phoenix")
      {:error, _reason} -> false
    end
  end

  defp package_dependency?(root, dependency_name) do
    package = package_json(root)

    dependency?(Map.get(package, "dependencies"), dependency_name) or
      dependency?(Map.get(package, "devDependencies"), dependency_name)
  end

  defp dependency?(dependencies, dependency_name) when is_map(dependencies) do
    Map.has_key?(dependencies, dependency_name)
  end

  defp dependency?(_dependencies, _dependency_name), do: false

  defp has_dev_script?(root) do
    scripts = Map.get(package_json(root), "scripts")

    case scripts do
      %{"dev" => dev_script} when is_binary(dev_script) -> String.trim(dev_script) != ""
      _other -> false
    end
  end

  defp package_json(root) do
    with {:ok, contents} <- File.read(Path.join(root, "package.json")),
         {:ok, package} when is_map(package) <- Jason.decode(contents) do
      package
    else
      _error -> %{}
    end
  end

  defp exists_any?(root, names), do: Enum.any?(names, &File.exists?(Path.join(root, &1)))

  defp serve(description, command, port_env, probe) do
    ProposedStep.new(%{
      description: description,
      command: command,
      source: "heuristic",
      optional: true,
      role: "serve",
      port_env: port_env,
      ready_probe: probe,
      primary: true
    })
  end

  defp step(description, command, opts \\ []) do
    ProposedStep.new(%{
      description: description,
      command: command,
      source: "heuristic",
      optional: Keyword.get(opts, :optional, false)
    })
  end
end
