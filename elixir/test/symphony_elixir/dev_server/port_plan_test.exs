defmodule SymphonyElixir.DevServer.PortPlanTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServer.PortPlan

  test "band_size multiplies slots by ports per slot" do
    assert PortPlan.band_size(32, 8) == 256
  end

  test "max_bands divides the pool by the band size" do
    assert PortPlan.max_bands([10_000, 30_000], 256) == 78
    assert PortPlan.max_bands([10_000, 10_100], 256) == 0
  end

  test "band_start offsets from the pool minimum" do
    assert PortPlan.band_start([10_000, 30_000], 0, 256) == 10_000
    assert PortPlan.band_start([10_000, 30_000], 1, 256) == 10_256
  end

  test "port composes band, slot and offset" do
    assert PortPlan.port(10_000, 0, 0, 8) == {:ok, 10_000}
    assert PortPlan.port(10_000, 0, 2, 8) == {:ok, 10_002}
    assert PortPlan.port(10_000, 1, 0, 8) == {:ok, 10_008}
    assert PortPlan.port(10_000, 1, 2, 8) == {:ok, 10_010}
  end

  test "port rejects an offset that does not fit the slot" do
    assert PortPlan.port(10_000, 0, 8, 8) == {:error, :offset_out_of_range}
  end

  defp fake_allocate do
    fn [min, max], claimed ->
      claimed_set = MapSet.new(claimed)

      case Enum.find(min..max//1, &(not MapSet.member?(claimed_set, &1))) do
        nil -> {:error, :no_free_port}
        port -> {:ok, port}
      end
    end
  end

  defp ctx(overrides) do
    Map.merge(
      %{
        band: {10_000, 10_255},
        slot_index: 0,
        ports_per_slot: 8,
        pool_range: [10_000, 30_000],
        auto?: true,
        allocate: fake_allocate()
      },
      Map.new(overrides)
    )
  end

  test "choose_port returns the preferred port when free" do
    assert PortPlan.choose_port(ctx(%{}), 2, []) == {:ok, 10_002}
  end

  test "choose_port scans the band when the preferred port is claimed" do
    assert PortPlan.choose_port(ctx(%{}), 2, [10_002]) == {:ok, 10_000}
  end

  test "choose_port scans the band when there is no slot" do
    assert PortPlan.choose_port(ctx(%{slot_index: nil}), 0, [10_000, 10_001]) == {:ok, 10_002}
  end

  test "choose_port scans the band when the offset does not fit the slot" do
    assert PortPlan.choose_port(ctx(%{}), 8, []) == {:ok, 10_000}
  end

  test "choose_port falls back to the pool for auto bands when the band is full" do
    band_ports = Enum.to_list(10_000..10_255)
    assert PortPlan.choose_port(ctx(%{}), 2, band_ports) == {:ok, 10_256}
  end

  test "choose_port does not leave the band for pinned (non-auto) projects" do
    band_ports = Enum.to_list(10_000..10_255)
    assert PortPlan.choose_port(ctx(%{auto?: false}), 2, band_ports) == {:error, :no_free_port}
  end
end
