defmodule SymphonyElixir.Assistant.ToolCallPresenter do
  @moduledoc """
  Pure derivation of a tool call's presentable input (arguments) and output
  (result message / error) for the assistant chat IN/OUT block.
  """

  @spec arguments(map()) :: map() | nil
  def arguments(payload) when is_map(payload) do
    params = Map.get(payload, "params") || Map.get(payload, :params) || %{}

    case Map.get(params, "arguments") || Map.get(params, :arguments) do
      args when is_map(args) and map_size(args) > 0 -> args
      _ -> nil
    end
  end

  def arguments(_payload), do: nil

  @spec output(map()) :: String.t() | nil
  def output(result) when is_map(result) do
    cond do
      success?(result) -> success_message(result)
      Map.has_key?(result, "contentItems") or Map.has_key?(result, :contentItems) -> error_message(result)
      true -> nil
    end
  end

  def output(_result), do: nil

  defp success?(result) do
    Map.get(result, "success") == true or Map.get(result, :success) == true
  end

  defp success_message(result) do
    tool_result = Map.get(result, "toolResult") || Map.get(result, :toolResult) || %{}

    case Map.get(tool_result, "message") || Map.get(tool_result, :message) do
      message when is_binary(message) and message != "" -> message
      _ -> nil
    end
  end

  defp error_message(result) do
    items = Map.get(result, "contentItems") || Map.get(result, :contentItems) || []

    Enum.find_value(items, fn item ->
      item |> text_field() |> decode_error_message()
    end)
  end

  defp text_field(item) when is_map(item), do: Map.get(item, "text") || Map.get(item, :text)
  defp text_field(_item), do: nil

  defp decode_error_message(text) when is_binary(text) do
    case Jason.decode(text) do
      {:ok, %{"error" => %{"message" => message}}} when is_binary(message) -> message
      {:ok, %{"error" => message}} when is_binary(message) -> message
      _ -> nil
    end
  end

  defp decode_error_message(_text), do: nil
end
