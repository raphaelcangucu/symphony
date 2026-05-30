defmodule SymphonyElixir.DevServer.PortAllocatorTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServer.PortAllocator

  test "returns a bindable port within the range, skipping claimed ports" do
    {:ok, port} = PortAllocator.allocate([4100, 4199], [4100, 4101])

    assert port in 4102..4199
  end

  test "errors when the range is exhausted by claims" do
    assert {:error, :no_free_port} = PortAllocator.allocate([4100, 4101], [4100, 4101])
  end

  test "errors when range bounds are invalid" do
    assert {:error, :no_free_port} = PortAllocator.allocate([4199, 4100], [])
  end

  test "errors when range bounds are non-positive" do
    assert {:error, :no_free_port} = PortAllocator.allocate([0, 0], [])
    assert {:error, :no_free_port} = PortAllocator.allocate([-1, 1], [])
  end

  test "errors when range exceeds TCP port bounds" do
    assert {:error, :no_free_port} = PortAllocator.allocate([65_536, 65_536], [])
  end

  test "skips a currently bound port" do
    {:ok, socket} = :gen_tcp.listen(0, [:binary, ip: {127, 0, 0, 1}, reuseaddr: true])
    {:ok, port} = :inet.port(socket)

    try do
      assert {:error, :no_free_port} = PortAllocator.allocate([port, port], [])
    after
      :gen_tcp.close(socket)
    end
  end
end
