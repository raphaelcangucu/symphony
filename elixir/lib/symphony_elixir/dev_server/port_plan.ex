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

  @doc """
  Pick a port for `offset` within the context's band/slot.

  `owned` is the port this exact service was previously assigned (from its
  `DevServerRecord`). When the canonical slot port equals `owned` and is not
  claimed by another live instance, it is reclaimed directly — skipping the
  `:gen_tcp` bind probe. This keeps a service on its deterministic port across
  restarts even when a long-lived resource it owns (e.g. a shared docker
  container that is not torn down on stop) is still bound to that port. Without
  this, the bind probe would treat the service's own lingering port as occupied
  and drift it onto the next free port, colliding with sibling services.
  """
  @spec choose_port(context(), non_neg_integer(), [pos_integer()], pos_integer() | nil) ::
          {:ok, pos_integer()} | {:error, :no_free_port}
  def choose_port(ctx, offset, claimed, owned \\ nil)

  def choose_port(%{slot_index: nil} = ctx, _offset, claimed, _owned), do: scan(ctx, claimed)

  def choose_port(
        %{slot_index: slot_index, ports_per_slot: ports_per_slot} = ctx,
        offset,
        claimed,
        owned
      ) do
    {band_start, _band_end} = ctx.band

    case port(band_start, slot_index, offset, ports_per_slot) do
      {:ok, preferred} ->
        cond do
          preferred == owned and preferred not in claimed -> {:ok, preferred}
          free?(ctx, preferred, claimed) -> {:ok, preferred}
          true -> scan(ctx, claimed)
        end

      {:error, :offset_out_of_range} ->
        scan(ctx, claimed)
    end
  end

  @doc """
  Deterministic, ordered candidate ports for one service inside its issue slot.

  Returns `[preferred | fallbacks]`, all inside the slot. `preferred` is the
  service's canonical port (offset). Fallback offsets are the remaining in-slot
  offsets, partitioned across the `service_count` sibling services round-robin so
  that no two services can ever choose the same fallback port. This lets a serve
  script pick an alternate leased port (e.g. when its preferred host port is
  already published by an unmanaged container) without colliding with a sibling.

  Returns `[]` when there is no bounded slot (pool-scan mode) or the offset does
  not fit the slot; callers then fall back to `choose_port/4` scanning.
  """
  @spec candidate_ports(context(), non_neg_integer(), pos_integer()) :: [pos_integer()]
  def candidate_ports(ctx, offset, service_count \\ 1)

  def candidate_ports(%{slot_index: nil}, _offset, _service_count), do: []

  def candidate_ports(
        %{slot_index: slot_index, ports_per_slot: ports_per_slot, band: {band_start, _band_end}},
        offset,
        service_count
      )
      when is_integer(slot_index) and slot_index >= 0 and
             is_integer(ports_per_slot) and ports_per_slot > 0 and
             is_integer(offset) and offset >= 0 and
             is_integer(service_count) and service_count >= 1 do
    offset
    |> candidate_offsets(ports_per_slot, service_count)
    |> Enum.flat_map(fn candidate_offset ->
      case port(band_start, slot_index, candidate_offset, ports_per_slot) do
        {:ok, candidate_port} -> [candidate_port]
        {:error, _reason} -> []
      end
    end)
  end

  def candidate_ports(_ctx, _offset, _service_count), do: []

  defp candidate_offsets(offset, _ports_per_slot, _service_count) when offset < 0, do: []

  defp candidate_offsets(offset, ports_per_slot, _service_count) when offset >= ports_per_slot, do: []

  defp candidate_offsets(offset, ports_per_slot, service_count) do
    fallback_offsets =
      for candidate_offset <- service_count..(ports_per_slot - 1)//1,
          rem(candidate_offset - service_count, service_count) == offset,
          do: candidate_offset

    Enum.uniq([offset | fallback_offsets])
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
