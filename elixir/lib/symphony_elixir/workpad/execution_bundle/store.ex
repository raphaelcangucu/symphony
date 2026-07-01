defmodule SymphonyElixir.Workpad.ExecutionBundle.Store do
  @moduledoc "Reads and upserts the `### Execution bundle` YAML block on a workpad body."

  alias SymphonyElixir.Workpad.ExecutionBundle

  @spec upsert_unit(String.t(), map()) :: {:ok, String.t()} | {:error, term()}
  def upsert_unit(workpad, unit) when is_binary(workpad) and is_map(unit) do
    with {:ok, bundle} <- existing_or_empty(workpad) do
      units = put_by_id(serialize_units(bundle.units), normalize_unit(unit))
      render(workpad, %{bundle | units: units})
    end
  end

  @spec remove_unit(String.t(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def remove_unit(workpad, unit_id) when is_binary(workpad) and is_binary(unit_id) do
    case ExecutionBundle.parse(workpad) do
      {:ok, bundle} ->
        units = bundle.units |> serialize_units() |> Enum.reject(&(&1["id"] == unit_id))
        render(workpad, %{bundle | units: units})

      :absent ->
        {:ok, workpad}
    end
  end

  @spec upsert_contract(String.t(), map()) :: {:ok, String.t()} | {:error, term()}
  def upsert_contract(workpad, contract) when is_binary(workpad) and is_map(contract) do
    with {:ok, bundle} <- existing_or_empty(workpad) do
      contracts = put_by_id(serialize_units(bundle.shared_contracts), normalize_contract(contract))
      render(workpad, %{bundle | shared_contracts: contracts})
    end
  end

  defp existing_or_empty(workpad) do
    case ExecutionBundle.parse(workpad) do
      {:ok, bundle} -> {:ok, bundle}
      :absent -> {:ok, %ExecutionBundle{version: 1, mode: "bundle", units: [], shared_contracts: []}}
    end
  end

  defp normalize_unit(unit) do
    %{
      "id" => unit[:id] || unit["id"],
      "type" => to_string(unit[:type] || unit["type"] || "workpad_task"),
      "issue" => unit[:issue] || unit["issue"],
      "repo" => unit[:repo] || unit["repo"],
      "produces" => List.wrap(unit[:produces] || unit["produces"]),
      "consumes" => List.wrap(unit[:consumes] || unit["consumes"]),
      "depends_on" => List.wrap(unit[:depends_on] || unit["depends_on"]),
      "deliverable" => unit[:deliverable] || unit["deliverable"],
      "pr_base" => unit[:pr_base] || unit["pr_base"]
    }
  end

  defp normalize_contract(c) do
    %{
      "id" => c[:id] || c["id"],
      "kind" => c[:kind] || c["kind"],
      "owner_unit" => c[:owner_unit] || c["owner_unit"],
      "consumers" => List.wrap(c[:consumers] || c["consumers"]),
      "artifact" => c[:artifact] || c["artifact"],
      "status" => to_string(c[:status] || c["status"] || "draft")
    }
  end

  defp serialize_units(units) do
    Enum.map(units, fn unit -> Map.new(unit, fn {k, v} -> {to_string(k), serialize(v)} end) end)
  end

  defp serialize(v) when is_atom(v) and not is_boolean(v) and not is_nil(v), do: to_string(v)
  defp serialize(v), do: v

  defp put_by_id(list, item) do
    {_match, rest} = Enum.split_with(list, &(&1["id"] == item["id"]))
    rest ++ [item]
  end

  defp render(workpad, %ExecutionBundle{} = bundle) do
    yaml = to_yaml(bundle)
    block = "### Execution bundle\n\n```yaml\n#{yaml}```\n"

    if String.contains?(workpad, "### Execution bundle") do
      {:ok, Regex.replace(~r/###\s+Execution bundle.*?```ya?ml.*?```\n?/s, workpad, block)}
    else
      {:ok, String.trim_trailing(workpad) <> "\n\n" <> block}
    end
  end

  defp to_yaml(%ExecutionBundle{} = bundle) do
    map = %{
      "version" => bundle.version || 1,
      "mode" => bundle.mode || "bundle",
      "parent" => bundle.parent,
      "shared_contracts" => bundle.shared_contracts,
      "units" => bundle.units
    }

    map
    |> Ymlr.document!()
    |> String.trim_leading("---\n")
  end
end
