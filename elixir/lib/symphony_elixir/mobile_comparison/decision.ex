defmodule SymphonyElixir.MobileComparison.Decision do
  @moduledoc """
  Validates and embeds the operator-reviewed comparison result in its parent.

  Keeping the decision beside the task makes it durable across host restarts
  without creating a second source of truth. The fenced block is removed from
  prompts before a retry so agents cannot treat the operator's result as input.
  """

  alias SymphonyElixir.MobileComparison.Contract

  @marker ~r/(?:\n{2}|^)```dev10x-decision\n(?<json>\{.*?\})\n```(?:\n|$)/s

  @spec validate(map()) :: {:ok, map()} | {:error, :invalid_decision}
  def validate(%{"ranking" => ranking, "summary" => summary})
      when is_list(ranking) and is_binary(summary) do
    expected_ids = Contract.cells() |> Enum.map(& &1.id) |> MapSet.new()
    ids = ranking |> Enum.map(&value(&1, "cell_id")) |> MapSet.new()
    ranks = Enum.map(ranking, &value(&1, "rank"))

    valid? =
      length(ranking) == MapSet.size(expected_ids) and
        ids == expected_ids and
        Enum.sort(ranks) == Enum.to_list(1..MapSet.size(expected_ids)) and
        String.trim(summary) != "" and
        Enum.all?(ranking, &valid_entry?/1)

    if valid? do
      sorted = Enum.sort_by(ranking, &value(&1, "rank"))

      {:ok,
       %{
         "version" => 1,
         "source" => "mobile-operator",
         "winner_cell_id" => sorted |> hd() |> value("cell_id"),
         "summary" => String.trim(summary),
         "ranking" => sorted
       }}
    else
      {:error, :invalid_decision}
    end
  end

  def validate(_decision), do: {:error, :invalid_decision}

  @spec get(map() | String.t() | nil) :: map() | nil
  def get(parent) when is_map(parent), do: parent |> value("description") |> get()

  def get(description) when is_binary(description) do
    with %{"json" => json} <- Regex.named_captures(@marker, description),
         {:ok, decoded} <- Jason.decode(json),
         {:ok, decision} <- validate(decoded) do
      decision
    else
      _reason -> nil
    end
  end

  def get(_description), do: nil

  @spec put(String.t() | nil, map()) :: String.t()
  def put(description, decision) do
    base = prompt(description)
    {:ok, validated} = validate(decision)
    encoded = Jason.encode!(validated)

    [base, "```dev10x-decision\n#{encoded}\n```"]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n\n")
  end

  @spec prompt(map() | String.t() | nil) :: String.t()
  def prompt(parent) when is_map(parent), do: parent |> value("description") |> prompt()
  def prompt(nil), do: ""

  def prompt(description) when is_binary(description) do
    description
    |> String.replace(@marker, "\n")
    |> String.trim()
  end

  defp valid_entry?(entry) when is_map(entry) do
    cell_id = value(entry, "cell_id")
    rank = value(entry, "rank")
    score = value(entry, "score")

    is_binary(cell_id) and is_integer(rank) and rank > 0 and
      is_integer(score) and score >= 0 and score <= 100
  end

  defp valid_entry?(_entry), do: false

  defp value(map, key) when is_map(map) do
    Map.get(map, key, Map.get(map, String.to_existing_atom(key)))
  rescue
    ArgumentError -> Map.get(map, key)
  end

  defp value(_map, _key), do: nil
end
