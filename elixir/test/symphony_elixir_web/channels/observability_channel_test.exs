defmodule SymphonyElixirWeb.ObservabilityChannelTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias SymphonyElixir.Observability.Registry

  @endpoint SymphonyElixirWeb.Endpoint

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)

    {:ok, _, socket} =
      socket(SymphonyElixirWeb.UserSocket, nil, %{tracker_token_valid: true})
      |> subscribe_and_join(
        SymphonyElixirWeb.ObservabilityChannel,
        "observability:global"
      )

    %{socket: socket}
  end

  test "pushes runtime_updated when a report arrives", %{socket: _socket} do
    Registry.put_report(%{
      "runtime_id" => "r1",
      "snapshot" => %{
        "counts" => %{"running" => 0, "retrying" => 0},
        "running" => [],
        "retrying" => [],
        "agent_totals" => %{},
        "rate_limits" => nil
      }
    })

    assert_push("runtime_updated", %{runtime_id: "r1"})
  end

  test "rejects observability topic without valid token" do
    assert {:error, %{reason: "unauthorized"}} =
             socket(SymphonyElixirWeb.UserSocket, nil, %{})
             |> subscribe_and_join(
               SymphonyElixirWeb.ObservabilityChannel,
               "observability:global"
             )
  end
end
