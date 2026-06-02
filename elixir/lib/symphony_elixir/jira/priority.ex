defmodule SymphonyElixir.Jira.Priority do
  @moduledoc """
  Maps JIRA priority names to Symphony's integer priority scale and back.
  Unknown names/values map to `nil`.
  """

  @by_name %{"highest" => 1, "high" => 2, "medium" => 3, "low" => 4, "lowest" => 5}
  @by_int %{1 => "Highest", 2 => "High", 3 => "Medium", 4 => "Low", 5 => "Lowest"}

  @spec to_int(String.t() | nil) :: integer() | nil
  def to_int(name) when is_binary(name) do
    Map.get(@by_name, name |> String.trim() |> String.downcase())
  end

  def to_int(_name), do: nil

  @spec to_name(integer() | String.t() | nil) :: String.t() | nil
  def to_name(value) when is_integer(value), do: Map.get(@by_int, value)

  def to_name(value) when is_binary(value) do
    trimmed = String.trim(value)

    case Integer.parse(trimmed) do
      {int, ""} -> to_name(int)
      _ -> if Map.has_key?(@by_name, String.downcase(trimmed)), do: String.capitalize(trimmed)
    end
  end

  def to_name(_value), do: nil
end
