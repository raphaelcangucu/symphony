defmodule SymphonyElixirWeb.TrackerChannelTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  @endpoint SymphonyElixirWeb.Endpoint
  @token_env "SYMPHONY_TRACKER_TOKEN"

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)

    previous_token = System.get_env(@token_env)
    System.put_env(@token_env, "secret")

    on_exit(fn ->
      restore_env(@token_env, previous_token)
    end)

    :ok
  end

  test "joins project topic with valid token" do
    assert {:ok, _, _socket} =
             socket(SymphonyElixirWeb.UserSocket, nil, %{token: "secret"})
             |> subscribe_and_join(SymphonyElixirWeb.TrackerChannel, "project:macro-markets")
  end

  test "rejects project topic without valid token" do
    assert {:error, %{reason: "unauthorized"}} =
             socket(SymphonyElixirWeb.UserSocket, nil, %{token: "wrong"})
             |> subscribe_and_join(SymphonyElixirWeb.TrackerChannel, "project:macro-markets")
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end
