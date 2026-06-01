defmodule SymphonyElixir.GitHub.RequestGatewayTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.RequestGateway

  # A constant clock keeps the monotonic schedule math deterministic: each reserved
  # slot still advances `next_slot`, so successive `acquire/2` calls return strictly
  # increasing wait times even though "now" never moves.
  defp start_gateway(opts) do
    name = :"gateway_#{System.unique_integer([:positive])}"
    opts = Keyword.merge([name: name, clock: fn -> 0 end], opts)
    start_supervised!(Supervisor.child_spec({RequestGateway, opts}, id: name))
    name
  end

  describe "acquire/2 scheduling" do
    test "staggers successive read acquisitions by the read interval" do
      gateway = start_gateway(read_interval_ms: 100)

      assert {0, _} = RequestGateway.acquire(gateway, :read)
      assert {100, _} = RequestGateway.acquire(gateway, :read)
      assert {200, _} = RequestGateway.acquire(gateway, :read)
    end

    test "spaces mutations by at least the mutation interval" do
      gateway = start_gateway(read_interval_ms: 50, mutation_interval_ms: 1_000)

      assert {0, _} = RequestGateway.acquire(gateway, :mutation)
      assert {1_000, _} = RequestGateway.acquire(gateway, :mutation)
      assert {2_000, _} = RequestGateway.acquire(gateway, :mutation)
    end

    test "report_rate_limited/2 pushes the next slot past the backoff window" do
      gateway = start_gateway(read_interval_ms: 100)

      assert {0, _} = RequestGateway.acquire(gateway, :read)
      assert :ok = RequestGateway.report_rate_limited(gateway, 5_000)

      assert {5_000, _} = RequestGateway.acquire(gateway, :read)
    end
  end

  describe "run/2 retries" do
    test "retries a rate-limited response then returns the eventual success" do
      gateway = start_gateway(read_interval_ms: 0)
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      fun = fn ->
        n = Agent.get_and_update(counter, fn count -> {count + 1, count + 1} end)
        if n == 1, do: {:ok, %{status: 429, headers: %{}, body: %{}}}, else: {:ok, %{status: 200, body: %{"ok" => true}}}
      end

      result =
        RequestGateway.run(
          [gateway: gateway, kind: :read, sleep_fun: fn _ -> :ok end, base_backoff_ms: 1, max_retries: 4],
          fun
        )

      assert {:ok, %{status: 200}} = result
      assert Agent.get(counter, & &1) == 2
    end

    test "gives up after max_retries and returns the last rate-limited response" do
      gateway = start_gateway(read_interval_ms: 0)
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      fun = fn ->
        Agent.update(counter, &(&1 + 1))
        {:ok, %{status: 429, headers: %{}, body: %{}}}
      end

      result =
        RequestGateway.run(
          [gateway: gateway, kind: :read, sleep_fun: fn _ -> :ok end, base_backoff_ms: 1, max_retries: 3],
          fun
        )

      assert {:ok, %{status: 429}} = result
      assert Agent.get(counter, & &1) == 3
    end

    test "returns transport errors without retrying" do
      gateway = start_gateway(read_interval_ms: 0)
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      fun = fn ->
        Agent.update(counter, &(&1 + 1))
        {:error, :nxdomain}
      end

      assert {:error, :nxdomain} =
               RequestGateway.run([gateway: gateway, sleep_fun: fn _ -> :ok end], fun)

      assert Agent.get(counter, & &1) == 1
    end

    test "runs the function directly when the gateway is not running" do
      assert {:ok, :direct} =
               RequestGateway.run([gateway: :gateway_not_started], fn -> {:ok, :direct} end)
    end
  end
end
