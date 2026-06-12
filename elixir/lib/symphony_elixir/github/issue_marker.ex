defmodule SymphonyElixir.GitHub.IssueMarker do
  @moduledoc """
  Builds and parses the machine-readable marker that links a pull request to a
  Symphony tracker issue, e.g. `Symphony-Issue: GAM-2`. This explicit marker
  replaces heuristic branch/title guessing for PR↔issue association.
  """

  @default_key "Symphony-Issue"

  @spec default_key() :: String.t()
  def default_key, do: @default_key

  @spec marker_line(String.t(), String.t()) :: String.t()
  def marker_line(identifier, key \\ @default_key)
      when is_binary(identifier) and is_binary(key) do
    "#{key}: #{String.trim(identifier)}"
  end

  @spec extract(String.t() | nil, String.t()) :: [String.t()]
  def extract(body, key \\ @default_key)

  def extract(body, key) when is_binary(body) and is_binary(key) do
    pattern = ~r/^\s*#{Regex.escape(key)}\s*:\s*(\S.*?)\s*$/im

    pattern
    |> Regex.scan(body)
    |> Enum.map(fn [_, id] -> String.trim(id) end)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  def extract(_body, _key), do: []
end
