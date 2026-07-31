defmodule SymphonyElixir.Mcp.Tools do
  @moduledoc """
  Public MCP tool boundary.

  The tracker assistant's tools are project-scoped because its chat already has
  a project context. Remote MCP clients do not, so this module augments every
  project tool schema with a required `project_slug` and removes it before
  forwarding the call to the existing executor.
  """

  alias SymphonyElixir.Assistant.{DiscoveryTools, ToolExecutor}

  @discovery_tools MapSet.new(DiscoveryTools.tools())

  @spec tool_specs() :: [map()]
  def tool_specs do
    DiscoveryTools.tool_specs() ++ Enum.map(ToolExecutor.tool_specs(), &add_project_slug/1)
  end

  @spec execute(String.t() | nil, term()) :: {:ok, ToolExecutor.result()} | {:error, term()}
  def execute(name, arguments) when is_binary(name) and is_map(arguments) do
    arguments = stringify_keys(arguments)

    if MapSet.member?(@discovery_tools, name) do
      DiscoveryTools.execute(name, arguments)
    else
      with {:ok, project_slug} <- project_slug(arguments) do
        ToolExecutor.execute(project_slug, name, Map.delete(arguments, "project_slug"))
      end
    end
  end

  def execute(_name, _arguments), do: {:error, :invalid_arguments}

  defp add_project_slug(%{"inputSchema" => input_schema} = spec) do
    properties = Map.get(input_schema, "properties", %{})
    required = Map.get(input_schema, "required", []) |> Enum.uniq()

    input_schema =
      input_schema
      |> Map.put("properties", Map.put(properties, "project_slug", project_slug_schema()))
      |> Map.put("required", Enum.uniq(["project_slug" | required]))

    Map.put(spec, "inputSchema", input_schema)
  end

  defp project_slug_schema do
    %{
      "type" => "string",
      "description" => "Symphony project slug. Call list_tracker_projects first when it is unknown."
    }
  end

  defp project_slug(arguments) do
    case Map.get(arguments, "project_slug") do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> {:error, {:missing_required_field, :project_slug}}
          slug -> {:ok, slug}
        end

      _ ->
        {:error, {:missing_required_field, :project_slug}}
    end
  end

  defp stringify_keys(arguments) do
    Map.new(arguments, fn {key, value} -> {to_string(key), value} end)
  end
end
