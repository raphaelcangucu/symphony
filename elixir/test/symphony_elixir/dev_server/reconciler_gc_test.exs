defmodule SymphonyElixir.DevServer.ReconcilerGcTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServer.Reconciler

  @now ~U[2026-06-15 23:30:00.000000Z]
  @old DateTime.add(@now, -300, :second)
  @fresh DateTime.add(@now, -10, :second)

  test "releases slots not alive and older than the grace period" do
    leased = [{"p", "1", @old}]
    assert Reconciler.slots_to_release(leased, MapSet.new(), @now) == [{"p", "1"}]
  end

  test "keeps slots whose issue is alive" do
    leased = [{"p", "1", @old}]
    alive = MapSet.new([{"p", "1"}])
    assert Reconciler.slots_to_release(leased, alive, @now) == []
  end

  test "keeps slots that are still within the grace period" do
    leased = [{"p", "1", @fresh}]
    assert Reconciler.slots_to_release(leased, MapSet.new(), @now) == []
  end
end
