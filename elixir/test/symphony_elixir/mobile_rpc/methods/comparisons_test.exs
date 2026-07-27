defmodule SymphonyElixir.MobileRpc.Methods.ComparisonsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileRpc.Dispatcher
  alias SymphonyElixir.MobileRpc.Methods.Comparisons

  defmodule FakeComparisonService do
    def call(method, params, context) do
      send(context.test_pid, {:comparison_call, method, params, context.device_id})
      {:ok, %{"method" => method, "identifier" => params["identifier"]}}
    end
  end

  defmodule FakeSubscription do
    def subscribe(connection_pid, params, context) do
      send(context.test_pid, {:comparison_subscribe, connection_pid, params})
      Agent.start_link(fn -> context.test_pid end)
    end

    def activate(pid) do
      send(Agent.get(pid, & &1), :comparison_subscription_activated)
      :ok
    end

    def stop(pid) do
      send(Agent.get(pid, & &1), :comparison_subscription_stopped)
      Agent.stop(pid)
    end
  end

  setup do
    context = %{
      host_id: "host-a",
      protocol: 1,
      device_id: "device-a",
      connection_pid: self(),
      test_pid: self(),
      mobile_comparison_service: FakeComparisonService,
      comparison_subscription: FakeSubscription
    }

    %{context: context}
  end

  test "validates and delegates start, get and retry to the selected host context", %{
    context: context
  } do
    start = %{
      "project_slug" => "dev10x",
      "identifier" => "DEV-1",
      "request_key" => "mobile-key-1"
    }

    assert {:ok, ^start} = Comparisons.Start.validate(start)
    assert {:ok, %{"method" => "comparisons.start"}} = Comparisons.Start.call(start, context)
    assert_receive {:comparison_call, "comparisons.start", ^start, "device-a"}

    get = Map.take(start, ["project_slug", "identifier"])
    assert {:ok, ^get} = Comparisons.Get.validate(get)
    assert {:ok, %{"method" => "comparisons.get"}} = Comparisons.Get.call(get, context)
    assert_receive {:comparison_call, "comparisons.get", ^get, "device-a"}

    retry = Map.merge(start, %{"cell_id" => "session-codex"})
    assert {:ok, ^retry} = Comparisons.RetryCell.validate(retry)

    assert {:ok, %{"method" => "comparisons.retry_cell"}} =
             Comparisons.RetryCell.call(retry, context)

    assert_receive {:comparison_call, "comparisons.retry_cell", ^retry, "device-a"}
  end

  test "rejects missing request keys, unknown cells and extra parameters" do
    assert {:error, :invalid_params} =
             Comparisons.Start.validate(%{
               "project_slug" => "dev10x",
               "identifier" => "DEV-1"
             })

    assert {:error, :invalid_params} =
             Comparisons.Get.validate(%{
               "project_slug" => "dev10x",
               "identifier" => "DEV-1",
               "secret" => "no"
             })

    assert {:error, :invalid_params} =
             Comparisons.RetryCell.validate(%{
               "project_slug" => "dev10x",
               "identifier" => "DEV-1",
               "request_key" => "mobile-key-1",
               "cell_id" => "session-nope"
             })
  end

  test "returns a dispatcher-owned comparison subscription lifecycle", %{context: context} do
    params = %{"project_slug" => "dev10x", "identifier" => "DEV-1"}
    assert {:ok, ^params} = Comparisons.Subscribe.validate(params)

    assert {:ok, {:subscription, subscription_id, %{"subscription_id" => subscription_id}, cleanup, activate}} = Comparisons.Subscribe.call(params, context)

    assert String.starts_with?(subscription_id, "comparison:DEV-1:")
    assert_receive {:comparison_subscribe, connection_pid, ^params}
    assert connection_pid == self()

    assert :ok = activate.()
    assert_receive :comparison_subscription_activated
    assert :ok = cleanup.()
    assert_receive :comparison_subscription_stopped
  end

  test "registers all comparison capabilities in the default dispatcher" do
    dispatcher =
      Dispatcher.new(%{
        host_id: "host-a",
        protocol: 1,
        device_id: "device-a",
        connection_pid: self()
      })

    assert MapSet.subset?(
             MapSet.new(~w(
               comparisons.start
               comparisons.get
               comparisons.subscribe
               comparisons.retry_cell
             )),
             MapSet.new(Map.keys(dispatcher.methods))
           )
  end
end
