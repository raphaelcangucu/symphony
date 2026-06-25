defmodule SymphonyElixir.Assistant.ToolText do
  @moduledoc false

  alias Gettext, as: GettextCore
  alias SymphonyElixirWeb.Gettext, as: GettextBackend

  @domain "assistant"

  @spec msg(String.t()) :: String.t()
  def msg(msgid) when is_binary(msgid), do: dgettext(msgid, %{})

  @spec msg(String.t(), map()) :: String.t()
  def msg(msgid, bindings) when is_binary(msgid) and is_map(bindings), do: dgettext(msgid, bindings)

  @spec localize_specs([map()]) :: [map()]
  def localize_specs(specs) when is_list(specs), do: Enum.map(specs, &localize_spec/1)

  @spec localize_spec(map()) :: map()
  def localize_spec(%{"description" => desc} = spec) when is_binary(desc) do
    spec
    |> Map.put("description", msg(String.trim(desc)))
    |> Map.update("inputSchema", %{}, &localize_schema/1)
  end

  def localize_spec(spec) when is_map(spec), do: spec

  defp localize_schema(value) when is_map(value) do
    Map.new(value, fn
      {"description", desc} when is_binary(desc) -> {"description", msg(String.trim(desc))}
      {key, nested} -> {key, localize_schema(nested)}
    end)
  end

  defp localize_schema(value) when is_list(value), do: Enum.map(value, &localize_schema/1)
  defp localize_schema(value), do: value

  defp dgettext(msgid, bindings) do
    GettextCore.dgettext(GettextBackend, @domain, msgid, bindings)
  end
end
