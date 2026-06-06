defmodule SymphonyElixir.Assistant.ToolSchema do
  @moduledoc false

  @project_slug_property %{
    "type" => "string",
    "description" => "Symphony tracker project slug (from list_tracker_projects)."
  }

  @doc """
  Adds a required `project_slug` field to a Codex tool spec for freeform board tools.

  Uses `Map.put/3` only — never `%{map | key => value}` on schemas that may omit
  `"required"`, which raises `{:badkey, "required"}` on long-lived BEAM loads.
  """
  @spec with_project_slug(map()) :: map()
  def with_project_slug(spec) when is_map(spec) do
    schema =
      spec
      |> Map.get("inputSchema", Map.get(spec, :inputSchema, %{}))
      |> stringify_keys()

    properties =
      schema
      |> Map.get("properties", %{})
      |> Map.put("project_slug", @project_slug_property)

    required =
      schema
      |> Map.get("required", [])
      |> List.wrap()
      |> then(&["project_slug" | &1])
      |> Enum.uniq()

    input_schema =
      schema
      |> Map.put("properties", properties)
      |> Map.put("required", required)

    spec
    |> stringify_keys()
    |> Map.put("inputSchema", input_schema)
  end

  @spec stringify_keys(term()) :: term()
  def stringify_keys(value) when is_map(value) do
    Map.new(value, fn
      {key, nested} when is_atom(key) -> {Atom.to_string(key), stringify_keys(nested)}
      {key, nested} when is_binary(key) -> {key, stringify_keys(nested)}
    end)
  end

  def stringify_keys(value) when is_list(value), do: Enum.map(value, &stringify_keys/1)
  def stringify_keys(value), do: value
end
