defmodule SymphonyElixir.LocalTracker.RepositoryScanner do
  @moduledoc "Read-only scanner for repository metadata used by the workspace wizard."

  @known_instruction_files ["AGENTS.md", "README.md"]

  @spec scan(map()) :: {:ok, map()} | {:error, String.t()}
  def scan(attrs) when is_map(attrs) do
    local_path = attr(attrs, :local_path)
    workspace_path = attr(attrs, :workspace_path)

    cond do
      !is_binary(local_path) or String.trim(local_path) == "" ->
        {:error, "local_path is required"}

      !File.dir?(local_path) ->
        {:error, "local_path does not exist"}

      true ->
        {:ok,
         %{
           local_path: local_path,
           workspace_path: workspace_path,
           stack: detect_stack(local_path),
           package_manager: detect_package_manager(local_path),
           scripts: detect_package_scripts(local_path),
           agent_instruction_files: detect_instruction_files(local_path),
           validation_commands: validation_commands(local_path)
         }}
    end
  end

  defp detect_stack(path) do
    []
    |> put_if(File.exists?(Path.join(path, "package.json")), "node")
    |> put_if(File.exists?(Path.join(path, "mix.exs")), "elixir")
    |> put_if(File.exists?(Path.join(path, "pyproject.toml")), "python")
    |> put_if(File.exists?(Path.join(path, "composer.json")), "php")
    |> Enum.reverse()
  end

  defp detect_package_manager(path) do
    cond do
      File.exists?(Path.join(path, "pnpm-lock.yaml")) -> "pnpm"
      File.exists?(Path.join(path, "yarn.lock")) -> "yarn"
      File.exists?(Path.join(path, "package-lock.json")) -> "npm"
      File.exists?(Path.join(path, "package.json")) -> "npm"
      true -> nil
    end
  end

  defp detect_package_scripts(path) do
    path
    |> package_json_scripts()
    |> Map.keys()
    |> Enum.sort()
  end

  defp detect_instruction_files(path) do
    @known_instruction_files
    |> Enum.filter(&File.exists?(Path.join(path, &1)))
  end

  defp validation_commands(path) do
    node_commands(path) ++ elixir_commands(path) ++ make_commands(path)
  end

  defp node_commands(path) do
    package_manager = detect_package_manager(path)

    if package_manager do
      path
      |> package_json_scripts()
      |> Map.keys()
      |> Enum.sort()
      |> Enum.filter(&(&1 in ["lint", "test"]))
      |> Enum.map(fn
        "test" -> "#{package_manager} test"
        script -> "#{package_manager} run #{script}"
      end)
    else
      []
    end
  end

  defp elixir_commands(path) do
    if File.exists?(Path.join(path, "mix.exs")), do: ["mix test"], else: []
  end

  defp make_commands(path) do
    if File.exists?(Path.join(path, "Makefile")), do: ["make test"], else: []
  end

  defp package_json_scripts(path) do
    package_json_path = Path.join(path, "package.json")

    with true <- File.exists?(package_json_path),
         {:ok, body} <- File.read(package_json_path),
         {:ok, %{"scripts" => scripts}} when is_map(scripts) <- Jason.decode(body) do
      scripts
    else
      _ -> %{}
    end
  end

  defp put_if(values, true, value), do: [value | values]
  defp put_if(values, false, _value), do: values

  defp attr(attrs, key), do: Map.get(attrs, key, Map.get(attrs, Atom.to_string(key)))
end
