defmodule SymphonyElixir.Assistant.SettingsTools do
  @moduledoc """
  Instance-settings tools for the global (freeform) Maestro. Reads the same
  operator settings the Settings page shows (`Settings.all/0`) and applies
  guarded single-key updates through `Settings.put/3`, which validates the group,
  setting name, and casts the value.
  """

  alias SymphonyElixir.Settings

  @tools ~w(get_settings update_setting)

  @spec tools() :: [String.t()]
  def tools, do: @tools

  @spec tool_specs() :: [map()]
  def tool_specs do
    groups = Settings.groups() |> Map.keys() |> Enum.sort()

    [
      tool_spec(
        "get_settings",
        "Read Symphony instance settings (operator config the Settings page shows). Optionally pass a group to scope the read. Groups: #{Enum.join(groups, ", ")}.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "properties" => %{
            "group" => %{
              "type" => "string",
              "description" => "Settings group to read; omit to read every group.",
              "enum" => groups
            }
          }
        }
      ),
      tool_spec(
        "update_setting",
        "Update a single Symphony instance setting. The value is validated and cast for the setting; unknown groups/names and invalid values are rejected. Confirm the change with the user before calling.",
        %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["group", "name", "value"],
          "properties" => %{
            "group" => %{"type" => "string", "description" => "Settings group.", "enum" => groups},
            "name" => %{"type" => "string", "description" => "Setting name within the group."},
            "value" => %{"description" => "New value; cast/validated per the setting."}
          }
        }
      )
    ]
  end

  @spec execute(String.t(), map(), keyword()) :: {:ok, map()} | {:error, term()}
  def execute(tool, arguments, opts \\ [])

  def execute("get_settings", arguments, _opts) when is_map(arguments) do
    case normalize_group(Map.get(arguments, "group")) do
      nil ->
        {:ok, %{tool: "get_settings", message: "All instance settings.", data: %{settings: Settings.all()}}}

      group ->
        case Settings.get_group(group) do
          nil ->
            {:error, {:unknown_settings_group, group}}

          values ->
            {:ok,
             %{
               tool: "get_settings",
               message: "Settings for #{group}.",
               data: %{group: group, settings: values}
             }}
        end
    end
  end

  def execute("update_setting", %{"value" => value} = arguments, _opts) do
    with {:ok, group} <- require_string(Map.get(arguments, "group"), :group),
         {:ok, name} <- require_string(Map.get(arguments, "name"), :name),
         {:ok, cast} <- Settings.put(group, name, value) do
      {:ok,
       %{
         tool: "update_setting",
         message: "Updated #{group}.#{name}.",
         data: %{group: group, name: name, value: cast, settings: Settings.get_group(group)}
       }}
    end
  end

  def execute("update_setting", _arguments, _opts), do: {:error, {:missing_field, :value}}

  def execute(tool, _arguments, _opts), do: {:error, {:unsupported_tool, tool}}

  defp normalize_group(group) when is_binary(group) do
    case String.trim(group) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_group(_group), do: nil

  defp require_string(value, field) when is_binary(value) do
    case String.trim(value) do
      "" -> {:error, {:missing_field, field}}
      trimmed -> {:ok, trimmed}
    end
  end

  defp require_string(_value, field), do: {:error, {:missing_field, field}}

  defp tool_spec(name, description, input_schema) do
    %{"name" => name, "description" => description, "inputSchema" => input_schema}
  end
end
