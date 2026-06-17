defmodule SymphonyElixir.Evidence.RunStatus do
  @moduledoc """
  Derives evidence outcomes from manifest runs.

  When an agent records both a failed full-suite run and a passing targeted run
  for the same `{kind, repo}`, only the best run counts (passed beats blocked
  beats failed). Supplementary failed runs must not fail the record.
  """

  @type run_map :: map()

  @spec canonical_runs([run_map()]) :: [run_map()]
  def canonical_runs(runs) when is_list(runs) do
    runs
    |> Enum.group_by(&{Map.get(&1, "kind"), Map.get(&1, "repo")})
    |> Enum.map(fn {_key, group} -> pick_best(group) end)
  end

  @spec overall_status([run_map()]) :: String.t()
  def overall_status(runs) when is_list(runs) do
    canonical = canonical_runs(runs)

    cond do
      canonical == [] -> "failed"
      Enum.all?(canonical, &(&1["status"] == "passed")) -> "passed"
      true -> "failed"
    end
  end

  defp pick_best(group) do
    Enum.find(group, &(&1["status"] == "passed")) ||
      Enum.find(group, &(&1["status"] == "blocked")) ||
      hd(group)
  end
end
