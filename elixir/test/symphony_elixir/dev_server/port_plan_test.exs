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

  defp fake_allocate(occupied \\ []) do
    occupied_set = MapSet.new(occupied)

    fn [min, max], claimed ->
      claimed_set = MapSet.union(MapSet.new(claimed), occupied_set)

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

  test "choose_port reclaims an owned port even when the bind probe reports it busy" do
    # 10_002 is bound at the OS level (e.g. a shared container the service owns
    # that was not torn down on stop), so the probe would reject it and drift.
    c = ctx(%{allocate: fake_allocate([10_002])})

    assert PortPlan.choose_port(c, 2, [], 10_002) == {:ok, 10_002}
  end

  test "choose_port does not reclaim an owned port a live sibling instance holds" do
    c = ctx(%{allocate: fake_allocate([10_002])})

    # 10_002 is claimed by another tracked instance, so it must not be reclaimed;
    # it scans to the next free port instead.
    assert PortPlan.choose_port(c, 2, [10_002], 10_002) == {:ok, 10_000}
  end

  test "choose_port ignores a stale owned port that is not the canonical slot port" do
    assert PortPlan.choose_port(ctx(%{}), 2, [], 99_999) == {:ok, 10_002}
  end

  describe "candidate_ports/3" do
    test "leads with the preferred port then in-slot fallbacks" do
      assert PortPlan.candidate_ports(ctx(%{}), 0, 2) == [10_000, 10_002, 10_004, 10_006]
      assert PortPlan.candidate_ports(ctx(%{}), 1, 2) == [10_001, 10_003, 10_005, 10_007]
    end

    test "partitions fallbacks disjointly across sibling services" do
      s0 = PortPlan.candidate_ports(ctx(%{}), 0, 3)
      s1 = PortPlan.candidate_ports(ctx(%{}), 1, 3)
      s2 = PortPlan.candidate_ports(ctx(%{}), 2, 3)

      assert hd(s0) == 10_000
      assert hd(s1) == 10_001
      assert hd(s2) == 10_002

      # Every candidate stays inside the slot and no two services overlap.
      all = s0 ++ s1 ++ s2
      assert Enum.all?(all, &(&1 in 10_000..10_007))
      assert length(Enum.uniq(all)) == length(all)
    end

    test "gives a single service the whole slot" do
      assert PortPlan.candidate_ports(ctx(%{}), 0, 1) ==
               Enum.map(0..7, &(10_000 + &1))
    end

    test "returns an empty list when there is no bounded slot" do
      assert PortPlan.candidate_ports(ctx(%{slot_index: nil}), 0, 2) == []
    end

    test "returns an empty list when the offset does not fit the slot" do
      assert PortPlan.candidate_ports(ctx(%{}), 8, 2) == []
    end
  end
end
