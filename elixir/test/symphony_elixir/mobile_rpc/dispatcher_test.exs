defmodule SymphonyElixir.MobileRpc.DispatcherTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileRpc.{Dispatcher, Envelope, Subscriptions}

  defmodule EchoMethod do
    @behaviour SymphonyElixir.MobileRpc.Method
    def name, do: "test.echo"
    def scope, do: :mobile
    def timeout_ms, do: 100
    def validate(%{"value" => value}), do: {:ok, %{"value" => value}}
    def validate(_params), do: {:error, :invalid_params}
    def call(params, _context), do: {:ok, params}
  end

  defmodule SlowMethod do
    @behaviour SymphonyElixir.MobileRpc.Method
    def name, do: "test.slow"
    def scope, do: :mobile
    def timeout_ms, do: 10
    def validate(params), do: {:ok, params}

    def call(params, _context) do
      Process.sleep(Map.get(params, "sleep_ms", 50))
      {:ok, %{"finished" => true}}
    end
  end

  setup do
    context = %{
      host_id: "host_01",
      host_name: "Mac Studio",
      protocol: 1,
      device_id: "device_01"
    }

    dispatcher =
      Dispatcher.new(context,
        methods: [EchoMethod, SlowMethod],
        max_concurrency: 1
      )

    %{dispatcher: dispatcher}
  end

  test "validates envelopes and never reflects secret params in errors", %{dispatcher: dispatcher} do
    assert {:error, response, ^dispatcher} =
             Dispatcher.handle_frame(
               Jason.encode!(%{
                 "type" => "rpc",
                 "id" => "rpc_bad",
                 "method" => "admin.secret",
                 "params" => %{"device_token" => "never-log-this"}
               }),
               dispatcher
             )

    decoded = Jason.decode!(response)
    assert decoded["error"]["code"] == "method_not_allowed"
    refute response =~ "never-log-this"

    assert {:error, invalid, ^dispatcher} = Dispatcher.handle_frame(~s({"type":"rpc"}), dispatcher)
    assert Jason.decode!(invalid)["error"]["code"] == "invalid_envelope"
  end

  test "dispatches allowlisted methods with metadata and rejects duplicate ids", %{
    dispatcher: dispatcher
  } do
    request = rpc("rpc_01", "test.echo", %{"value" => "hello"})
    assert {:noreply, running} = Dispatcher.handle_frame(request, dispatcher)

    assert {:error, duplicate, ^running} = Dispatcher.handle_frame(request, running)
    assert Jason.decode!(duplicate)["error"]["code"] == "duplicate_request_id"

    assert_receive message
    assert {:reply, response, complete} = Dispatcher.handle_info(message, running)
    decoded = Jason.decode!(response)
    assert decoded["result"] == %{"value" => "hello"}
    assert decoded["meta"]["host_id"] == "host_01"
    assert decoded["meta"]["protocol"] == 1
    assert is_binary(decoded["meta"]["server_timestamp"])
    assert complete.in_flight == %{}
  end

  test "enforces concurrency, cancellation and per-method timeout", %{dispatcher: dispatcher} do
    assert {:noreply, slow} =
             Dispatcher.handle_frame(rpc("rpc_slow", "test.slow", %{"sleep_ms" => 100}), dispatcher)

    assert {:error, busy, ^slow} =
             Dispatcher.handle_frame(rpc("rpc_busy", "test.echo", %{"value" => 1}), slow)

    assert Jason.decode!(busy)["error"]["code"] == "concurrency_limit"

    assert {:reply, cancelled, after_cancel} =
             Dispatcher.handle_frame(~s({"type":"cancel","id":"rpc_slow"}), slow)

    assert Jason.decode!(cancelled)["error"]["code"] == "cancelled"
    assert after_cancel.in_flight == %{}

    assert {:noreply, timing_out} =
             Dispatcher.handle_frame(rpc("rpc_timeout", "test.slow", %{}), after_cancel)

    assert_receive timeout_message, 100

    assert {:reply, timeout_response, timed_out} =
             Dispatcher.handle_info(timeout_message, timing_out)

    assert Jason.decode!(timeout_response)["error"]["code"] == "deadline_exceeded"
    assert timed_out.in_flight == %{}
  end

  test "implements host identity, health, capabilities and heartbeat system RPCs" do
    dispatcher =
      Dispatcher.new(%{
        host_id: "host_01",
        host_name: "Mac Studio",
        protocol: 1,
        device_id: "device_01"
      })

    for {id, method, params, expected} <- [
          {"identity", "system.identity", %{}, %{"host_id" => "host_01", "name" => "Mac Studio"}},
          {"health", "system.health", %{}, %{"status" => "healthy"}},
          {"heartbeat", "system.heartbeat", %{"nonce" => "n1"}, %{"nonce" => "n1"}}
        ] do
      assert {:noreply, running} = Dispatcher.handle_frame(rpc(id, method, params), dispatcher)
      assert_receive message
      assert {:reply, response, _complete} = Dispatcher.handle_info(message, running)
      assert Map.merge(Jason.decode!(response)["result"], expected) == Jason.decode!(response)["result"]
    end
  end

  test "cleans each registered subscription exactly once" do
    parent = self()

    subscriptions =
      Subscriptions.new()
      |> Subscriptions.put("sub_1", fn -> send(parent, :cleaned_1) end)
      |> Subscriptions.put("sub_2", fn -> send(parent, :cleaned_2) end)

    assert {:ok, subscriptions} = Subscriptions.remove(subscriptions, "sub_1")
    assert_receive :cleaned_1
    assert :ok = Subscriptions.cleanup(subscriptions)
    assert_receive :cleaned_2
    refute_receive :cleaned_1
  end

  test "envelope rejects oversized deadlines and malformed event sequences" do
    assert {:error, :invalid_deadline} =
             Envelope.decode(%{
               "type" => "rpc",
               "id" => "rpc",
               "method" => "system.health",
               "params" => %{},
               "deadline_ms" => 120_001
             })

    assert {:error, :invalid_sequence} =
             Envelope.decode(%{
               "type" => "event",
               "subscription_id" => "sub",
               "sequence" => 0,
               "event" => "delta",
               "payload" => %{}
             })
  end

  defp rpc(id, method, params) do
    Jason.encode!(%{"type" => "rpc", "id" => id, "method" => method, "params" => params})
  end
end
