defmodule SymphonyElixir.Claude.ApprovalBrokerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Claude.ApprovalBroker

  test "resolve delivers an approve decision to a waiter" do
    request_id = "req-#{System.unique_integer([:positive])}"
    parent = self()

    waiter =
      spawn(fn ->
        send(parent, {:ready, self()})
        send(parent, {:result, ApprovalBroker.await(request_id, 5_000)})
      end)

    assert_receive {:ready, ^waiter}
    # Give the waiter a moment to register before resolving.
    Process.sleep(20)

    ApprovalBroker.resolve(request_id, :approve)

    assert_receive {:result, :approve}, 1_000
  end

  test "resolve delivers a deny decision to a waiter" do
    request_id = "req-#{System.unique_integer([:positive])}"
    parent = self()

    spawn(fn -> send(parent, {:result, ApprovalBroker.await(request_id, 5_000)}) end)
    Process.sleep(20)

    ApprovalBroker.resolve(request_id, :deny)

    assert_receive {:result, :deny}, 1_000
  end

  test "await returns :deny on timeout" do
    request_id = "req-#{System.unique_integer([:positive])}"
    assert ApprovalBroker.await(request_id, 30) == :deny
  end

  test "resolve is a no-op when nobody is waiting" do
    assert ApprovalBroker.resolve("nobody-#{System.unique_integer([:positive])}", :approve) == :ok
  end

  test "a decision for one request does not leak to another waiter" do
    id_a = "req-a-#{System.unique_integer([:positive])}"
    id_b = "req-b-#{System.unique_integer([:positive])}"
    parent = self()

    spawn(fn -> send(parent, {:a, ApprovalBroker.await(id_a, 500)}) end)
    spawn(fn -> send(parent, {:b, ApprovalBroker.await(id_b, 5_000)}) end)
    Process.sleep(20)

    ApprovalBroker.resolve(id_b, :approve)

    assert_receive {:b, :approve}, 1_000
    # id_a was never resolved, so it should time out to :deny, not receive B's decision.
    assert_receive {:a, :deny}, 2_000
  end
end
