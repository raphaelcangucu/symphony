defmodule SymphonyElixir.LocalTracker.DevEnv.ConventionReader do
  @moduledoc "Reads `.symphony/devenv.yaml` or `.symphony/devenv.md` from a repo root."

  alias SymphonyElixir.LocalTracker.DevEnv.ProposedStep

  @yaml_names [".symphony/devenv.yaml", ".symphony/devenv.yml"]
  @md_name ".symphony/devenv.md"

  @spec read(Path.t()) :: {:ok, [ProposedStep.t()]} | :none | {:error, term()}
  def read(repo_root) when is_binary(repo_root) do
    cond do
      path = first_existing(repo_root, @yaml_names) -> read_yaml(path)
      File.exists?(Path.join(repo_root, @md_name)) -> read_markdown(Path.join(repo_root, @md_name))
      true -> :none
    end
  end

  defp first_existing(root, names) do
    Enum.find_value(names, fn name ->
      path = Path.join(root, name)
      if File.exists?(path), do: path
    end)
  end

  defp read_yaml(path) do
    with {:ok, content} <- File.read(path),
         {:ok, %{"steps" => steps}} when is_list(steps) <- YamlElixir.read_from_string(content) do
      {:ok, Enum.map(steps, &to_proposed/1)}
    else
      {:ok, _} -> {:error, :invalid_convention}
      {:error, reason} -> {:error, reason}
    end
  rescue
    _ -> {:error, :invalid_convention}
  end

  defp to_proposed(map) do
    ProposedStep.new(%{
      "description" => Map.get(map, "description", Map.get(map, "command", "step")),
      "command" => Map.fetch!(map, "command"),
      "stop_command" => Map.get(map, "stop_command"),
      "working_dir" => Map.get(map, "working_dir"),
      "source" => "convention",
      "optional" => Map.get(map, "optional", false),
      "role" => Map.get(map, "role", "setup"),
      "port_env" => Map.get(map, "port_env"),
      "url_path" => Map.get(map, "url_path", "/"),
      "ready_probe" => Map.get(map, "ready", Map.get(map, "ready_probe", "tcp")),
      "ready_path" => Map.get(map, "ready_path", "/"),
      "primary" => Map.get(map, "primary", false),
      "run_spec" => Map.get(map, "run_spec")
    })
  end

  defp read_markdown(path) do
    with {:ok, content} <- File.read(path) do
      steps =
        content
        |> extract_bash_blocks()
        |> Enum.flat_map(&split_commands/1)
        |> Enum.map(fn command ->
          ProposedStep.new(%{description: command, command: command, source: "convention"})
        end)

      {:ok, steps}
    end
  end

  defp extract_bash_blocks(content) do
    ~r/```(?:bash|sh|shell)?\n(.*?)```/s
    |> Regex.scan(content, capture: :all_but_first)
    |> Enum.map(fn [block] -> String.trim(block) end)
  end

  defp split_commands(block) do
    block
    |> String.split("\n")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(fn line -> line == "" or String.starts_with?(line, "#") end)
  end
end
