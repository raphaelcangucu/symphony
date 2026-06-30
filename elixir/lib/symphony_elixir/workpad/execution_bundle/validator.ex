defmodule SymphonyElixir.Workpad.ExecutionBundle.Validator do
  @moduledoc "Static checks over a parsed execution bundle before it is published."

  alias SymphonyElixir.Workpad.ExecutionBundle

  @type warning :: %{code: atom(), message: String.t()}

  @spec validate(ExecutionBundle.t(), keyword()) :: :ok | {:error, [warning()]}
  def validate(%ExecutionBundle{} = bundle, opts) do
    parent_repo = Keyword.get(opts, :parent_repo)

    warnings =
      cycle_warnings(bundle.units) ++
        producer_warnings(bundle.units) ++
        cross_repo_warnings(bundle.units, parent_repo) ++
        cross_repo_subagent_warnings(bundle.units, parent_repo)

    if warnings == [], do: :ok, else: {:error, warnings}
  end

  defp cycle_warnings(units) do
    graph = Map.new(units, &{&1.id, &1.depends_on})

    if Enum.any?(units, &cyclic?(&1.id, graph, MapSet.new())) do
      [%{code: :dependency_cycle, message: "execution bundle has a dependency cycle"}]
    else
      []
    end
  end

  defp cyclic?(id, graph, seen) do
    cond do
      MapSet.member?(seen, id) ->
        true

      true ->
        seen = MapSet.put(seen, id)
        graph |> Map.get(id, []) |> Enum.any?(&cyclic?(&1, graph, seen))
    end
  end

  defp producer_warnings(units) do
    produced = units |> Enum.flat_map(& &1.produces) |> MapSet.new()

    units
    |> Enum.flat_map(& &1.consumes)
    |> Enum.uniq()
    |> Enum.reject(&MapSet.member?(produced, &1))
    |> Enum.map(fn id ->
      %{code: :missing_contract_producer, message: "contract #{id} is consumed but never produced"}
    end)
  end

  defp cross_repo_warnings(units, parent_repo) when is_binary(parent_repo) do
    units
    |> Enum.filter(&(&1.type == :workpad_task and is_binary(&1.repo) and &1.repo != parent_repo))
    |> Enum.map(fn u ->
      %{code: :cross_repo_inline, message: "workpad_task #{u.id} targets a different repo than the parent"}
    end)
  end

  defp cross_repo_warnings(_units, _parent_repo), do: []

  defp cross_repo_subagent_warnings(units, parent_repo) when is_binary(parent_repo) do
    units
    |> Enum.filter(&(&1.type == :subagent_unit and is_binary(&1.repo) and &1.repo != parent_repo))
    |> Enum.map(fn u ->
      %{
        code: :cross_repo_subagent,
        message:
          "subagent_unit #{u.id} targets a different repo than the parent; use child_run for cross-repo work"
      }
    end)
  end

  defp cross_repo_subagent_warnings(_units, _parent_repo), do: []
end
