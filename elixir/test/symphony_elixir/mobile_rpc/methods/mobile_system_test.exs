defmodule SymphonyElixir.MobileRpc.Methods.MobileSystemTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileRpc.Dispatcher

  @methods ~w(
    status.get
    settings.get
    settings.update
    preflight.check
    preflight.detectAgents
    preflight.detectRemoteAgents
    stats.summary
    accounts.list
    accounts.subscribe
  )

  setup do
    dispatcher =
      Dispatcher.new(%{
        host_id: "host-a",
        host_name: "Mac Studio",
        host_version: "1.4.0",
        protocol: 1,
        device_id: "device-a",
        connection_pid: self()
      })

    %{dispatcher: dispatcher}
  end

  test "registers the exact Orca system compatibility surface", %{dispatcher: dispatcher} do
    assert MapSet.subset?(MapSet.new(@methods), MapSet.new(Map.keys(dispatcher.methods)))
  end

  test "presents Symphony host identity with the upstream status shape", %{
    dispatcher: dispatcher
  } do
    assert %{
             "runtimeId" => "host-a",
             "product" => "Symphony",
             "displayName" => "Mac Studio",
             "version" => "1.4.0",
             "protocolVersion" => 3,
             "minCompatibleMobileVersion" => 2
           } = dispatch(dispatcher, "status.get", %{})
  end

  test "supplies the complete upstream GitHub project settings shape", %{
    dispatcher: dispatcher
  } do
    assert %{
             "settings" => %{
               "githubProjects" => %{
                 "pinned" => [],
                 "recent" => [],
                 "lastViewByProject" => %{},
                 "activeProject" => nil
               }
             }
           } = dispatch(dispatcher, "settings.get", %{})
  end

  test "accounts subscription returns its binding id before streaming a snapshot", %{
    dispatcher: dispatcher
  } do
    frame =
      Jason.encode!(%{
        "type" => "rpc",
        "id" => "rpc-accounts",
        "method" => "accounts.subscribe",
        "params" => %{}
      })

    assert {:noreply, running} = Dispatcher.handle_frame(frame, dispatcher)
    assert_receive task_message
    assert {:reply, response, subscribed} = Dispatcher.handle_info(task_message, running)

    assert %{
             "ok" => true,
             "result" => %{"subscription_id" => subscription_id}
           } = Jason.decode!(response)

    assert_receive event_message
    assert {:reply, event, _next} = Dispatcher.handle_info(event_message, subscribed)

    assert %{
             "type" => "event",
             "subscription_id" => ^subscription_id,
             "event" => "accounts.updated",
             "payload" => %{"claude" => %{}, "codex" => %{}}
           } = Jason.decode!(event)
  end

  defp dispatch(dispatcher, method, params) do
    frame =
      Jason.encode!(%{
        "type" => "rpc",
        "id" => "rpc-#{System.unique_integer([:positive])}",
        "method" => method,
        "params" => params
      })

    assert {:noreply, running} = Dispatcher.handle_frame(frame, dispatcher)
    assert_receive message
    assert {:reply, response, _complete} = Dispatcher.handle_info(message, running)
    decoded = Jason.decode!(response)
    assert decoded["ok"] == true
    decoded["result"]
  end
end
