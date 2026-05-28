defmodule SymphonyElixir.LocalTracker.TemplateYaml do
  @moduledoc "Converts workspace templates to/from YAML."

  alias SymphonyElixir.LocalTracker.WorkspaceTemplate

  @spec decode(binary()) :: {:ok, map()} | {:error, :invalid_yaml}
  def decode(yaml) when is_binary(yaml) do
    case YamlElixir.read_from_string(yaml) do
      {:ok, %{} = map} -> {:ok, normalize(map)}
      _ -> {:error, :invalid_yaml}
    end
  end

  @spec encode(WorkspaceTemplate.t()) :: binary()
  def encode(%WorkspaceTemplate{} = template) do
    %{
      "slug" => template.slug,
      "name" => template.name,
      "description" => template.description,
      "validation_commands" => WorkspaceTemplate.validation_commands_list(template),
      "workflow_statuses" => WorkspaceTemplate.workflow_statuses_list(template),
      "after_create_hook" => template.after_create_hook,
      "prompt_template" => template.prompt_template,
      "dev_env_markdown" => template.dev_env_markdown,
      "metadata" => template.metadata || %{},
      "repositories" =>
        Enum.map(template.repositories, fn repo ->
          %{
            "github_full_name" => repo.github_full_name,
            "clone_url" => repo.clone_url,
            "default_branch" => repo.default_branch,
            "workspace_path" => repo.workspace_path,
            "role" => repo.role
          }
        end)
    }
    |> reject_nil()
    |> to_yaml()
  end

  defp normalize(map) do
    map
    |> Map.take([
      "slug",
      "name",
      "description",
      "validation_commands",
      "workflow_statuses",
      "after_create_hook",
      "before_run_hook",
      "after_run_hook",
      "before_remove_hook",
      "prompt_template",
      "dev_env_markdown",
      "metadata",
      "repositories"
    ])
  end

  defp reject_nil(map), do: Map.reject(map, fn {_k, v} -> is_nil(v) end)

  # Minimal YAML emitter: we only need a stable, re-parseable document.
  defp to_yaml(map), do: encode_value(map, 0)

  defp encode_value(map, indent) when is_map(map) do
    map
    |> Enum.map_join("\n", fn {k, v} -> "#{pad(indent)}#{k}:#{encode_inline_or_block(v, indent)}" end)
  end

  defp encode_value(list, indent) when is_list(list) do
    Enum.map_join(list, "\n", fn item ->
      "#{pad(indent)}- #{String.trim_leading(encode_value(item, indent + 1))}"
    end)
  end

  defp encode_value(value, _indent), do: scalar(value)

  defp encode_inline_or_block(value, indent) when is_map(value) or is_list(value) do
    "\n" <> encode_value(value, indent + 1)
  end

  defp encode_inline_or_block(value, _indent), do: " " <> scalar(value)

  defp scalar(value) when is_binary(value) do
    if String.contains?(value, "\n") do
      "|\n" <> (value |> String.split("\n") |> Enum.map_join("\n", &("  " <> &1)))
    else
      ~s("#{String.replace(value, "\"", "\\\"")}")
    end
  end

  defp scalar(value) when is_boolean(value), do: to_string(value)
  defp scalar(value) when is_number(value), do: to_string(value)
  defp scalar(nil), do: "null"
  defp scalar(value), do: ~s("#{to_string(value)}")

  defp pad(indent), do: String.duplicate("  ", indent)
end
