defmodule SymphonyElixir.DevServer.PortPlan do
  @moduledoc """
  Pure helpers for the hierarchical preview port scheme:

      port = band_start + slot_index * ports_per_slot + service_offset

  See `docs/superpowers/specs/2026-06-15-smart-preview-port-scheme-design.md`.
  """

  alias SymphonyElixir.DevServer.PortAllocator

  @type allocate_fun ::
          ([pos_integer()], [pos_integer()] -> {:ok, pos_integer()} | {:error, term()})

  @type context :: %{
          optional(:allocate) => allocate_fun(),
          band: {pos_integer(), pos_integer()},
          slot_index: non_neg_integer() | nil,
          ports_per_slot: pos_integer(),
          pool_range: [pos_integer()],
          auto?: boolean()
        }

  @spec band_size(pos_integer(), pos_integer()) :: pos_integer()
  def band_size(slots_per_project, ports_per_slot)
      when is_integer(slots_per_project) and slots_per_project > 0 and
             is_integer(ports_per_slot) and ports_per_slot > 0 do
    slots_per_project * ports_per_slot
  end

  @spec max_bands([pos_integer()], pos_integer()) :: non_neg_integer()
  def max_bands([pool_min, pool_max], band_size)
      when is_integer(pool_min) and is_integer(pool_max) and pool_min <= pool_max and
             is_integer(band_size) and band_size > 0 do
    div(pool_max - pool_min + 1, band_size)
  end

  @spec band_start([pos_integer()], non_neg_integer(), pos_integer()) :: pos_integer()
  def band_start([pool_min, _pool_max], band_index, band_size)
      when is_integer(pool_min) and is_integer(band_index) and band_index >= 0 and
             is_integer(band_size) and band_size > 0 do
    pool_min + band_index * band_size
  end

  @spec port(pos_integer(), non_neg_integer(), non_neg_integer(), pos_integer()) ::
          {:ok, pos_integer()} | {:error, :offset_out_of_range}
  def port(band_start, slot_index, service_offset, ports_per_slot)
      when is_integer(band_start) and band_start > 0 and
             is_integer(slot_index) and slot_index >= 0 and
             is_integer(service_offset) and service_offset >= 0 and
             is_integer(ports_per_slot) and ports_per_slot > 0 do
    if service_offset < ports_per_slot do
      {:ok, band_start + slot_index * ports_per_slot + service_offset}
    else
      {:error, :offset_out_of_range}
    end
  end

  @spec choose_port(context(), non_neg_integer(), [pos_integer()]) ::
          {:ok, pos_integer()} | {:error, :no_free_port}
  def choose_port(%{slot_index: nil} = ctx, _offset, claimed), do: scan(ctx, claimed)

  def choose_port(
        %{slot_index: slot_index, ports_per_slot: ports_per_slot} = ctx,
        offset,
        claimed
      ) do
    {band_start, _band_end} = ctx.band

    case port(band_start, slot_index, offset, ports_per_slot) do
      {:ok, preferred} ->
        if free?(ctx, preferred, claimed), do: {:ok, preferred}, else: scan(ctx, claimed)

      {:error, :offset_out_of_range} ->
        scan(ctx, claimed)
    end
  end

  defp free?(ctx, candidate, claimed) do
    allocate(ctx).([candidate, candidate], claimed) == {:ok, candidate}
  end

  defp scan(ctx, claimed) do
    {band_start, band_end} = ctx.band

    case allocate(ctx).([band_start, band_end], claimed) do
      {:ok, port} -> {:ok, port}
      {:error, _reason} -> pool_scan(ctx, claimed)
    end
  end

  defp pool_scan(%{auto?: true} = ctx, claimed) do
    case allocate(ctx).(ctx.pool_range, claimed) do
      {:ok, port} -> {:ok, port}
      {:error, _reason} -> {:error, :no_free_port}
    end
  end

  defp pool_scan(_ctx, _claimed), do: {:error, :no_free_port}

  defp allocate(ctx), do: Map.get(ctx, :allocate, &PortAllocator.allocate/2)
end
