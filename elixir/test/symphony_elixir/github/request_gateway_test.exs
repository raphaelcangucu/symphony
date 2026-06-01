defmodule SymphonyElixir.GitHub.RequestGatewayTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.GitHub.RequestGateway

  defp start_gateway(opts) do
    name = :"gateway_#{System.unique_integer([:positive])}"
    opts = Keyword.put_new(opts, :name, name)
    start_supervised!(Supervisor.child_spec({RequestGateway, opts}, id: name))
    name
  end

  describe "reserve/2 scheduling" do
    test "reads are never spaced so the UI stays responsive" do
      gateway = start_gateway(clock: fn -> 0 end)

      assert {:proceed, 0} = RequestGateway.reserve(gateway, :read)
      assert {:proceed, 0} = RequestGateway.reserve(gateway, :read)
      assert {:proceed, 0} = RequestGateway.reserve(gateway, :read)
    end

    test "mutations are spaced by the mutation interval, bounded by max_wait_ms" do
      gateway = start_gateway(clock: fn -> 0 end, mutation_interval_ms: 500, max_wait_ms: 1_000)

      assert {:proceed, 0} = RequestGateway.reserve(gateway, :mutation)
      assert {:proceed, 500} = RequestGateway.reserve(gateway, :mutation)
      assert {:proceed, 1_000} = RequestGateway.reserve(gateway, :mutation)
      # The accumulated slot would imply a 1_500ms wait, but it is capped.
      assert {:proceed, 1_000} = RequestGateway.reserve(gateway, :mutation)
    end
  end

  describe "rate-limit window" do
    test "while blocked, reserve returns the reset hint instead of proceeding" do
      reset_at = DateTime.add(DateTime.utc_now(), 30, :second)
      gateway = start_gateway(clock: fn -> 0 end)

      assert :ok = RequestGateway.report_rate_limited(gateway, %{reset_at: reset_at})

      assert {:blocked, ^reset_at} = RequestGateway.reserve(gateway, :read)
      assert {:blocked, ^reset_at} = RequestGateway.reserve(gateway, :mutation)
    end

    test "the block window is bounded by max_block_ms so a far reset cannot wedge the app" do
      {:ok, clock} = Agent.start_link(fn -> 0 end)
      far_reset = DateTime.add(DateTime.utc_now(), 3_600, :second)

      gateway =
        start_gateway(
          clock: fn -> Agent.get(clock, & &1) end,
          min_block_ms: 1,
          max_block_ms: 5_000
        )

      assert :ok = RequestGateway.report_rate_limited(gateway, %{reset_at: far_reset})
      assert {:blocked, _} = RequestGateway.reserve(gateway, :read)

      Agent.update(clock, fn _ -> 5_001 end)
      assert {:proceed, 0} = RequestGateway.reserve(gateway, :read)
    end
  end

  describe "run/2" do
    test "returns a synthetic 429 without calling fun while blocked" do
      reset_at = DateTime.add(DateTime.utc_now(), 30, :second)
      gateway = start_gateway(clock: fn -> 0 end)
      :ok = RequestGateway.report_rate_limited(gateway, %{reset_at: reset_at})

      {:ok, counter} = Agent.start_link(fn -> 0 end)

      fun = fn ->
        Agent.update(counter, &(&1 + 1))
        {:ok, %{status: 200, body: %{"ok" => true}}}
      end

      assert {:ok, %{status: 429}} =
               RequestGateway.run([gateway: gateway, kind: :read, sleep_fun: fn _ -> :ok end], fun)

      assert Agent.get(counter, & &1) == 0
    end

    test "a real rate-limited response opens the window for later callers" do
      gateway = start_gateway(clock: fn -> 0 end)

      reset_unix = DateTime.utc_now() |> DateTime.add(30, :second) |> DateTime.to_unix()

      limited =
        {:ok, %{status: 429, headers: [{"x-ratelimit-reset", Integer.to_string(reset_unix)}], body: %{}}}

      assert ^limited =
               RequestGateway.run([gateway: gateway, sleep_fun: fn _ -> :ok end], fn -> limited end)

      assert {:blocked, _reset_at} = RequestGateway.reserve(gateway, :read)
    end

    test "returns transport errors without opening the window" do
      gateway = start_gateway(clock: fn -> 0 end)
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      fun = fn ->
        Agent.update(counter, &(&1 + 1))
        {:error, :nxdomain}
      end

      assert {:error, :nxdomain} =
               RequestGateway.run([gateway: gateway, sleep_fun: fn _ -> :ok end], fun)

      assert {:proceed, 0} = RequestGateway.reserve(gateway, :read)
      assert Agent.get(counter, & &1) == 1
    end

    test "runs the function directly when the gateway is not running" do
      assert {:ok, :direct} =
               RequestGateway.run([gateway: :gateway_not_started], fn -> {:ok, :direct} end)
    end
  end
end
