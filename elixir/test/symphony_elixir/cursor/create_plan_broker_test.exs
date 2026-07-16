defmodule SymphonyElixir.Cursor.CreatePlanBrokerTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Cursor.CreatePlanBroker

  test "await/2 receives resolve/2 decision" do
    CreatePlanBroker.ensure_started()
    request_id = "plan-#{System.unique_integer([:positive])}"

    task = Task.async(fn -> CreatePlanBroker.await(request_id, 2_000) end)
    Process.sleep(20)
    assert :ok = CreatePlanBroker.resolve(request_id, :accept)
    assert :accept = Task.await(task)
  end
end
