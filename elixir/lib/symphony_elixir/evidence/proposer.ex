defmodule SymphonyElixir.Evidence.Proposer do
  @moduledoc """
  Proposes an initial per-repo `evidence` config for a project by scanning each
  repository in its workspace (package.json test scripts, Playwright, `go test`,
  `vibe`/phpunit, framework markers).

  Mirrors `LocalTracker.DevEnv` propose/save: the scan is a convention-first
  starting point the operator reviews and evolves. UI repos (Playwright or a
  frontend framework) get `ui_paths` + an `e2e` command; non-UI repos get a unit
  command plus `impacts`/`contract_paths` pointing at the detected UI repos so
  the gate's deterministic backstop has something to bite on.
  """

  alias SymphonyElixir.Config
  alias SymphonyElixir.LocalTracker.Context
  alias SymphonyElixir.Workflow

  @ui_dir_candidates ~w(src components pages app)
  @frontend_deps ~w(next vite react @angular/core vue @remix-run/react)

  @type repo :: %{required(:workspace_path) => String.t(), optional(:github_full_name) => String.t() | nil}

  @spec propose_for_project(String.t()) :: {:ok, map()} | {:error, :project_not_found}
  def propose_for_project(project_slug) do
    with {:ok, _project} <- Context.get_project(project_slug) do
      repositories =
        project_slug
        |> Context.list_repositories()
        |> Enum.map(&%{workspace_path: &1.workspace_path, github_full_name: &1.github_full_name})
        |> default_repo(project_slug)

      {:ok, propose(workspace_root(project_slug), repositories)}
    end
  end

  @doc """
  Persists the given evidence config into the project's `workflow_markdown` front
  matter, preserving the prompt body verbatim. Key ordering/comments in the front
  matter are not preserved (it is re-serialized from structured data).
  """
  @spec save_for_project(String.t(), map()) :: {:ok, term()} | {:error, term()}
  def save_for_project(project_slug, %{} = evidence) when is_binary(project_slug) do
    with {:ok, _project} <- Context.get_project(project_slug),
         {:ok, markdown} <- workflow_markdown(project_slug),
         {:ok, %{config: config, prompt: body}} <- Workflow.parse_string(markdown) do
      merged = Map.put(config, "evidence", deep_stringify(evidence))
      new_markdown = Workflow.to_markdown(merged, body || "")
      Context.upsert_project_setup(project_slug, %{"workflow_markdown" => new_markdown})
    end
  end

  @spec propose(Path.t(), [repo()]) :: map()
  def propose(workspace_root, repositories) when is_binary(workspace_root) and is_list(repositories) do
    scans =
      repositories
      |> Enum.map(fn repo ->
        workspace_path = Map.get(repo, :workspace_path) || Map.get(repo, "workspace_path")
        {repo_name(workspace_path, workspace_root), scan_repo(Path.join(workspace_root, to_string(workspace_path)))}
      end)
      |> Enum.reject(fn {name, _scan} -> is_nil(name) end)

    ui_repos = for {name, scan} <- scans, scan.ui?, do: name

    repos =
      scans
      |> Enum.map(fn {name, scan} -> {name, repo_config(scan, ui_repos -- [name])} end)
      |> Enum.reject(fn {_name, config} -> map_size(config) == 0 end)
      |> Map.new()

    %{required: true, repos: repos}
  end

  defp repo_config(scan, other_ui_repos) do
    %{}
    |> put_present(:unit_command, unit_command(scan))
    |> put_present(:e2e, e2e_block(scan))
    |> put_present(:ui_paths, ui_paths(scan))
    |> put_impacts(scan, other_ui_repos)
  end

  defp put_impacts(config, %{ui?: true}, _other_ui_repos), do: config
  defp put_impacts(config, _scan, []), do: config

  defp put_impacts(config, scan, other_ui_repos) do
    config
    |> Map.put(:impacts, other_ui_repos)
    |> put_present(:contract_paths, contract_paths(scan))
  end

  defp unit_command(scan) do
    cond do
      scan.vibe? -> "./vibe test"
      scan.node? and scan.test_script? -> "#{scan.pm} test"
      scan.go? -> "go test ./..."
      scan.mix? -> "mix test"
      scan.php? -> "vendor/bin/phpunit"
      true -> nil
    end
  end

  defp e2e_block(%{playwright?: true}), do: %{command: "npx playwright test"}
  defp e2e_block(_scan), do: nil

  defp ui_paths(%{ui?: true, ui_dirs: []}), do: ["src/**"]
  defp ui_paths(%{ui?: true, ui_dirs: dirs}), do: Enum.map(dirs, &"#{&1}/**")
  defp ui_paths(_scan), do: nil

  defp contract_paths(%{php?: true}), do: ["app/Http/**", "routes/**", "graphql/**"]
  defp contract_paths(%{go?: true}), do: ["**/*.proto", "internal/handler/**", "internal/handlers/**"]
  defp contract_paths(_scan), do: nil

  defp scan_repo(root) do
    package = package_json(root)
    scripts = scripts(package)
    deps = dependencies(package)

    %{
      root: root,
      node?: File.exists?(Path.join(root, "package.json")),
      pm: package_manager(root),
      test_script?: Map.has_key?(scripts, "test"),
      go?: File.exists?(Path.join(root, "go.mod")),
      mix?: File.exists?(Path.join(root, "mix.exs")),
      php?: File.exists?(Path.join(root, "composer.json")),
      vibe?: File.exists?(Path.join(root, "vibe")),
      playwright?: playwright?(root, deps),
      ui_dirs: Enum.filter(@ui_dir_candidates, &File.dir?(Path.join(root, &1)))
    }
    |> put_ui_flag(deps)
  end

  defp put_ui_flag(scan, deps) do
    Map.put(scan, :ui?, scan.playwright? or frontend_dep?(deps))
  end

  defp frontend_dep?(deps), do: Enum.any?(@frontend_deps, &Map.has_key?(deps, &1))

  defp playwright?(root, deps) do
    Map.has_key?(deps, "@playwright/test") or
      Enum.any?(
        ~w(playwright.config.ts playwright.config.js playwright.config.mjs),
        &File.exists?(Path.join(root, &1))
      )
  end

  defp package_manager(root) do
    cond do
      File.exists?(Path.join(root, "pnpm-lock.yaml")) -> "pnpm"
      File.exists?(Path.join(root, "yarn.lock")) -> "yarn"
      true -> "npm"
    end
  end

  defp package_json(root) do
    with {:ok, body} <- File.read(Path.join(root, "package.json")),
         {:ok, package} when is_map(package) <- Jason.decode(body) do
      package
    else
      _error -> %{}
    end
  end

  defp scripts(package) do
    case Map.get(package, "scripts") do
      scripts when is_map(scripts) -> scripts
      _ -> %{}
    end
  end

  defp dependencies(package) do
    Map.merge(map_or_empty(package["dependencies"]), map_or_empty(package["devDependencies"]))
  end

  defp map_or_empty(value) when is_map(value), do: value
  defp map_or_empty(_value), do: %{}

  defp repo_name(".", workspace_root), do: Path.basename(workspace_root)
  defp repo_name(path, _root) when is_binary(path) and path != "", do: Path.basename(path)
  defp repo_name(_path, _root), do: nil

  defp default_repo([], project_slug), do: [%{workspace_path: ".", github_full_name: project_slug}]
  defp default_repo(repositories, _project_slug), do: repositories

  defp workspace_root(project_slug), do: Path.join(Config.workspace_root(), project_slug)

  defp workflow_markdown(project_slug) do
    case Context.get_project_setup(project_slug) do
      %{workflow_markdown: markdown} when is_binary(markdown) and markdown != "" -> {:ok, markdown}
      _ -> {:error, :setup_missing}
    end
  end

  defp put_present(map, _key, nil), do: map
  defp put_present(map, key, value), do: Map.put(map, key, value)

  defp deep_stringify(%{} = map) do
    Map.new(map, fn {key, value} -> {to_string(key), deep_stringify(value)} end)
  end

  defp deep_stringify(list) when is_list(list), do: Enum.map(list, &deep_stringify/1)
  defp deep_stringify(value), do: value
end
