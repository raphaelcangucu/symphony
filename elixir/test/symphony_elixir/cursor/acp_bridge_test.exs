defmodule SymphonyElixir.Cursor.AcpBridgeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Cursor.AcpBridge

  test "agent_message_chunk becomes item/progress text delta" do
    {:ok, events} = Agent.start_link(fn -> [] end)

    callbacks = %{
      on_event: fn e -> Agent.update(events, &[e | &1]) end,
      on_approval_required: fn _ -> :ok end,
      on_user_input_required: fn _ -> :ok end,
      on_create_plan_required: fn _ -> :ok end,
      respond: fn _, _ -> :ok end
    }

    :ok =
      AcpBridge.handle_server_message(
        %{
          "method" => "session/update",
          "params" => %{
            "update" => %{
              "sessionUpdate" => "agent_message_chunk",
              "content" => %{"type" => "text", "text" => "Hi"}
            }
          }
        },
        callbacks
      )

    assert [%{"method" => "item/progress"} | _] = Agent.get(events, & &1)
  end

  test "request_permission invokes on_approval_required" do
    parent = self()

    callbacks = %{
      on_event: fn _ -> :ok end,
      on_approval_required: fn req -> send(parent, {:approval, req}) end,
      on_user_input_required: fn _ -> :ok end,
      on_create_plan_required: fn _ -> :ok end,
      respond: fn id, result -> send(parent, {:respond, id, result}) end
    }

    :ok =
      AcpBridge.handle_server_message(
        %{
          "id" => 3,
          "method" => "session/request_permission",
          "params" => %{"toolName" => "shell"}
        },
        callbacks
      )

    assert_receive {:approval, req}, 500
    assert req.acp_id == 3
    req.respond.(:approve)
    assert_receive {:respond, 3, %{"outcome" => %{"outcome" => "selected", "optionId" => "allow-once"}}}, 500
  end

  test "create_plan invokes on_create_plan_required" do
    parent = self()

    callbacks = %{
      on_event: fn _ -> :ok end,
      on_approval_required: fn _ -> :ok end,
      on_user_input_required: fn _ -> :ok end,
      on_create_plan_required: fn req -> send(parent, {:plan, req}) end,
      respond: fn id, result -> send(parent, {:respond, id, result}) end
    }

    :ok =
      AcpBridge.handle_server_message(
        %{
          "id" => 4,
          "method" => "cursor/create_plan",
          "params" => %{"name" => "Spec", "overview" => "o", "plan" => "# p"}
        },
        callbacks
      )

    assert_receive {:plan, req}, 500
    assert req.name == "Spec"
    req.respond.(:accept)
    assert_receive {:respond, 4, %{"outcome" => %{"outcome" => "accepted"}}}, 500
  end
end
