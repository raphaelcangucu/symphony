defmodule SymphonyElixir.AgentLifecycle.RuntimeRegistry do
  @moduledoc """
  Pins the resolved CLI provenance while one or more sessions use it.

  The first lease for an agent establishes the executable/version tuple. Later
  leases share that tuple until the final lease is released, so an update can
  never change a running session mid-flight.
  """

  @table __MODULE__

  @spec acquire(String.t(), map()) :: {:ok, reference(), map()}
  def acquire(agent, resolution) when is_binary(agent) and is_map(resolution) do
    lease = make_ref()

    transaction(agent, fn ->
      ensure_table()

      pinned =
        case :ets.lookup(@table, {:agent, agent}) do
          [{{:agent, ^agent}, %{resolution: existing, leases: leases}}] ->
            :ets.insert(@table, {{:agent, agent}, %{resolution: existing, leases: MapSet.put(leases, lease)}})
            existing

          [] ->
            :ets.insert(
              @table,
              {{:agent, agent}, %{resolution: resolution, leases: MapSet.new([lease])}}
            )

            resolution
        end

      :ets.insert(@table, {{:lease, lease}, agent})
      {:ok, lease, pinned}
    end)
  end

  @spec release(reference()) :: :ok | {:error, :unknown_lease}
  def release(lease) when is_reference(lease) do
    ensure_table()

    case :ets.lookup(@table, {:lease, lease}) do
      [{{:lease, ^lease}, agent}] ->
        transaction(agent, fn ->
          case :ets.lookup(@table, {:agent, agent}) do
            [{{:agent, ^agent}, %{leases: leases} = entry}] ->
              remaining = MapSet.delete(leases, lease)

              if MapSet.size(remaining) == 0 do
                :ets.delete(@table, {:agent, agent})
              else
                :ets.insert(@table, {{:agent, agent}, %{entry | leases: remaining}})
              end

            [] ->
              :ok
          end

          :ets.delete(@table, {:lease, lease})
          :ok
        end)

      [] ->
        {:error, :unknown_lease}
    end
  end

  @spec active?(String.t()) :: boolean()
  def active?(agent) when is_binary(agent) do
    ensure_table()
    :ets.member(@table, {:agent, agent})
  end

  @spec pinned(String.t()) :: {:ok, map()} | :error
  def pinned(agent) when is_binary(agent) do
    ensure_table()

    case :ets.lookup(@table, {:agent, agent}) do
      [{{:agent, ^agent}, %{resolution: resolution}}] -> {:ok, resolution}
      [] -> :error
    end
  end

  @doc false
  def reset do
    case :ets.whereis(@table) do
      :undefined -> :ok
      _table -> :ets.delete_all_objects(@table)
    end

    :ok
  end

  defp ensure_table do
    case :ets.whereis(@table) do
      :undefined ->
        try do
          :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
        rescue
          ArgumentError -> @table
        end

      table ->
        table
    end
  end

  defp transaction(agent, fun), do: :global.trans({__MODULE__, agent}, fun)
end
