defmodule SymphonyElixir.AssistantCommands do
  @moduledoc "Lists slash-command palette entries (built-ins + workspace skills)."

  alias SymphonyElixir.Skills

  @skill_file "SKILL.md"
  @superpowers_dir "superpowers"
  @execution_context "execution"
  @authoring_context "authoring"
  @frontmatter_regex ~r/\A---\r?\n(?<yaml>.*?)\r?\n---(?:\r?\n|$)/s

  @authoring_only_skills ~w(brainstorming using-superpowers writing-plans writing-skills)

  @builtin_commands [
    %{
      slug: "goal",
      name: "goal",
      description: "Set or update the issue goal.",
      kind: "builtin",
      category: "builtin",
      submit_kind: "goal",
      source: "builtin"
    },
    %{
      slug: "infer",
      name: "infer",
      description: "Infer next actions from the current issue context.",
      kind: "builtin",
      category: "builtin",
      submit_kind: "infer",
      source: "builtin"
    },
    %{
      slug: "btw",
      name: "btw",
      description: "Send a brief side note without changing the goal.",
      kind: "builtin",
      category: "builtin",
      submit_kind: "btw",
      source: "builtin"
    }
  ]

  @type command :: %{
          required(:slug) => String.t(),
          required(:name) => String.t(),
          required(:description) => String.t(),
          required(:kind) => String.t(),
          required(:category) => String.t(),
          required(:submit_kind) => String.t() | nil,
          required(:source) => String.t()
        }

  @spec list(String.t()) :: [command()]
  def list(context \\ @execution_context)

  def list(context) when is_binary(context) do
    @builtin_commands ++ skill_commands(context)
  end

  def list(context) do
    raise ArgumentError,
          "context must be a string, got: #{inspect(context)}"
  end

  defp skill_commands(context) do
    root = Skills.root()

    if File.dir?(root) do
      root
      |> top_level_skill_paths()
      |> Kernel.++(superpower_skill_paths(root, context))
      |> Enum.map(&skill_command/1)
      |> Enum.sort_by(& &1.slug)
    else
      []
    end
  end

  defp top_level_skill_paths(root) do
    root
    |> child_skill_paths("workflow")
    |> Enum.reject(fn {slug, _path, _category} -> slug == @superpowers_dir end)
  end

  defp superpower_skill_paths(root, context) do
    root
    |> Path.join(@superpowers_dir)
    |> child_skill_paths("superpowers")
    |> maybe_reject_authoring_only(context)
  end

  defp maybe_reject_authoring_only(skill_paths, context) do
    if context == @authoring_context do
      skill_paths
    else
      Enum.reject(skill_paths, fn {slug, _path, _category} -> slug in @authoring_only_skills end)
    end
  end

  defp child_skill_paths(root, category) do
    case File.ls(root) do
      {:ok, entries} ->
        entries
        |> Enum.map(fn slug -> {slug, Path.join(root, slug), category} end)
        |> Enum.filter(fn {_slug, path, _category} -> File.regular?(Path.join(path, @skill_file)) end)

      {:error, _reason} ->
        []
    end
  end

  defp skill_command({slug, skill_path, category}) do
    skill_file = Path.join(skill_path, @skill_file)
    metadata = parse_metadata(skill_file, slug)

    %{
      slug: slug,
      name: metadata.name,
      description: metadata.description,
      kind: "skill",
      category: category,
      submit_kind: nil,
      source: "skills"
    }
  end

  defp parse_metadata(skill_file, slug) do
    with {:ok, content} <- File.read(skill_file),
         %{"yaml" => yaml} <- Regex.named_captures(@frontmatter_regex, content),
         {:ok, yaml_map} <- YamlElixir.read_from_string(yaml),
         true <- is_map(yaml_map) do
      %{
        name: normalize_optional_string(map_get(yaml_map, "name"), slug),
        description: normalize_optional_string(map_get(yaml_map, "description"), "")
      }
    else
      _ -> %{name: slug, description: ""}
    end
  end

  defp map_get(map, "name") when is_map(map), do: Map.get(map, "name") || Map.get(map, :name)
  defp map_get(map, "description") when is_map(map), do: Map.get(map, "description") || Map.get(map, :description)
  defp map_get(map, key) when is_map(map) and is_binary(key), do: Map.get(map, key)

  defp normalize_optional_string(value, default) when is_binary(value) do
    case String.trim(value) do
      "" -> default
      trimmed -> trimmed
    end
  end

  defp normalize_optional_string(_value, default), do: default
end
