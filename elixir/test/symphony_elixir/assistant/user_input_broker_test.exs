defmodule SymphonyElixir.Assistant.UserInputBrokerTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Assistant.UserInputBroker

  test "resolve delivers answers to await" do
    request_id = "req-#{System.unique_integer([:positive])}"
    answers = %{"q1" => %{"answers" => ["Use default"]}}

    task =
      Task.async(fn ->
        UserInputBroker.await(request_id, 2_000)
      end)

    Process.sleep(20)
    assert :ok = UserInputBroker.resolve(request_id, answers)
    assert {:ok, ^answers} = Task.await(task)
  end

  test "await times out with error" do
    request_id = "req-timeout-#{System.unique_integer([:positive])}"
    assert {:error, :timeout} = UserInputBroker.await(request_id, 50)
  end

  test "bind_session and lookup_session round-trip" do
    token = "tok-#{System.unique_integer([:positive])}"
    binding = %{channel_pid: self(), thread_id: 7999, agent: "claude"}

    assert :ok = UserInputBroker.bind_session(token, binding)
    assert {:ok, ^binding} = UserInputBroker.lookup_session(token)
    assert :ok = UserInputBroker.unbind_session(token)
    assert :error = UserInputBroker.lookup_session(token)
  end
end
