defmodule SymphonyElixir.MobileRpc.Methods.MobileTasksTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileRpc.Dispatcher

  @native_methods ~w(
    symphony.tasks.list
    symphony.tasks.get
    notifications.subscribe
    notifications.unsubscribe
  )

  @provider_and_voice_methods ~w(
    github.listWorkItems
    github.project.listAccessible
    github.project.listViews
    github.project.resolveRef
    linear.status
    linear.listIssues
    linear.listTeams
    linear.searchIssues
    linear.teamStates
    linear.createIssue
    linear.updateIssue
    linear.selectWorkspace
    gitlab.listWorkItems
    gitlab.todos
    gitlab.updateIssue
    gitlab.updateMRState
    speech.dictation.setup
    speech.dictation.start
    speech.dictation.chunk
    speech.dictation.cancel
    speech.models.list
    speech.models.download
    speech.models.delete
  )

  defmodule FakeTasksService do
    def call("symphony.tasks.list", %{"query" => "mobile"}, context) do
      {:ok,
       %{
         "items" => [
           %{
             "id" => "101",
             "identifier" => "DEV-101",
             "title" => "Dev10x mobile",
             "projectSlug" => "dev10x",
             "projectName" => "Dev10x",
             "status" => "In Progress",
             "updatedAt" => "2026-07-25T21:00:00Z",
             "agent" => "codex",
             "agentState" => "live",
             "executionSessionId" => 73,
             "blockedBy" => ["DEV-99"],
             "subtaskCount" => 2,
             "pendingApproval" => true,
             "pendingQuestion" => false,
             "hostId" => context.host_id
           }
         ],
         "totalCount" => 1
       }}
    end

    def call("symphony.tasks.get", %{"projectSlug" => "dev10x", "identifier" => "DEV-101"}, _context) do
      {:ok,
       %{
         "identifier" => "DEV-101",
         "description" => "Copied Orca task detail, backed by Symphony.",
         "comments" => [%{"id" => 1, "author" => "Raphael", "body" => "Approved"}],
         "blockers" => [%{"identifier" => "DEV-99", "title" => "RPC contract"}],
         "subtasks" => [%{"identifier" => "DEV-102", "title" => "Android evidence"}]
       }}
    end

    def call("notifications.unsubscribe", %{"subscriptionId" => id}, _context),
      do: {:ok, %{"unsubscribed" => true, "subscriptionId" => id}}

    def subscribe("notifications.subscribe", %{}, context) do
      id = "notifications:#{context.host_id}:#{context.device_id}"
      parent = context.connection_pid

      {:ok,
       {:subscription, id, %{"subscription_id" => id}, fn -> :ok end,
        fn ->
          send(parent, {:mobile_rpc_event, id, "notifications.ready", %{"type" => "ready", "subscriptionId" => id}})

          send(
            parent,
            {:mobile_rpc_event, id, "notifications.notification",
             %{
               "type" => "notification",
               "source" => "dev10x-host",
               "title" => "Dev10x host",
               "body" => "DEV-101 needs your input",
               "notificationId" => "DEV-101:input",
               "hostId" => context.host_id
             }}
          )
        end}}
    end
  end

  test "registers native Dev10x task and notification methods without advertising unavailable providers or voice" do
    dispatcher = dispatcher()
    capabilities = Map.keys(dispatcher.methods)

    assert MapSet.subset?(MapSet.new(@native_methods), MapSet.new(capabilities))
    refute Enum.any?(@provider_and_voice_methods, &(&1 in capabilities))

    assert %{
             "items" => [
               %{
                 "identifier" => "DEV-101",
                 "hostId" => "host-a",
                 "executionSessionId" => 73,
                 "blockedBy" => ["DEV-99"],
                 "subtaskCount" => 2,
                 "pendingApproval" => true
               }
             ],
             "totalCount" => 1
           } = dispatch(dispatcher, "symphony.tasks.list", %{"query" => "mobile"})
  end

  test "streams host-routed notifications without secrets in the payload" do
    dispatcher = dispatcher()
    frame = rpc_frame("notifications.subscribe", %{})

    assert {:noreply, running} = Dispatcher.handle_frame(frame, dispatcher)
    assert_receive {ref, _result} = task_message when is_reference(ref)
    assert {:reply, response, subscribed} = Dispatcher.handle_info(task_message, running)

    assert %{"ok" => true, "result" => %{"subscription_id" => subscription_id}} =
             Jason.decode!(response)

    assert_receive {:mobile_rpc_event, ^subscription_id, "notifications.ready", ready}

    assert {:reply, ready_frame, with_ready} =
             Dispatcher.handle_info(
               {:mobile_rpc_event, subscription_id, "notifications.ready", ready},
               subscribed
             )

    assert Jason.decode!(ready_frame)["event"] == "notifications.ready"

    assert_receive {:mobile_rpc_event, ^subscription_id, "notifications.notification", payload}
    serialized = Jason.encode!(payload)
    refute serialized =~ "token"
    refute serialized =~ "pair"
    refute serialized =~ "session_key"
    assert payload["hostId"] == "host-a"

    assert {:reply, event_frame, _state} =
             Dispatcher.handle_info(
               {:mobile_rpc_event, subscription_id, "notifications.notification", payload},
               with_ready
             )

    assert %{"sequence" => 2, "payload" => %{"source" => "dev10x-host"}} =
             Jason.decode!(event_frame)
  end

  test "the production notification subscription receives Symphony push events" do
    dispatcher = production_dispatcher()
    frame = rpc_frame("notifications.subscribe", %{})

    assert {:noreply, running} = Dispatcher.handle_frame(frame, dispatcher)
    assert_receive {ref, _result} = task_message when is_reference(ref)
    assert {:reply, response, subscribed} = Dispatcher.handle_info(task_message, running)

    assert %{"result" => %{"subscription_id" => subscription_id}} =
             Jason.decode!(response)

    assert_receive {:mobile_rpc_event, ^subscription_id, "notifications.ready", ready}

    assert {:reply, _ready_frame, active} =
             Dispatcher.handle_info(
               {:mobile_rpc_event, subscription_id, "notifications.ready", ready},
               subscribed
             )

    Phoenix.PubSub.broadcast(
      SymphonyElixir.PubSub,
      SymphonyElixir.MobileRpc.NotificationSubscription.topic(),
      {:mobile_notification, "assistant_input_needed",
       %{
         title: "Needs your input",
         body: "DEV-101 is waiting",
         tag: "assistant_input:dev10x:DEV-101"
       }}
    )

    assert_receive {:mobile_rpc_event, ^subscription_id, "notifications.notification", payload}
    assert payload["hostId"] == "host-a"
    assert payload["source"] == "dev10x-host"
    refute Map.has_key?(payload, "token")

    assert {:reply, event_frame, _state} =
             Dispatcher.handle_info(
               {:mobile_rpc_event, subscription_id, "notifications.notification", payload},
               active
             )

    assert %{"payload" => %{"body" => "DEV-101 is waiting"}} =
             Jason.decode!(event_frame)
  end

  defp dispatcher do
    Dispatcher.new(%{
      host_id: "host-a",
      protocol: 1,
      device_id: "device-a",
      connection_pid: self(),
      orca_tasks_service: FakeTasksService
    })
  end

  defp production_dispatcher do
    Dispatcher.new(%{
      host_id: "host-a",
      protocol: 1,
      device_id: "device-a",
      connection_pid: self()
    })
  end

  defp dispatch(dispatcher, method, params) do
    assert {:noreply, running} = Dispatcher.handle_frame(rpc_frame(method, params), dispatcher)
    assert_receive {ref, _result} = task_message when is_reference(ref)
    assert {:reply, response, _complete} = Dispatcher.handle_info(task_message, running)
    decoded = Jason.decode!(response)
    assert decoded["ok"] == true
    decoded["result"]
  end

  defp rpc_frame(method, params) do
    Jason.encode!(%{
      "type" => "rpc",
      "id" => "rpc-#{System.unique_integer([:positive])}",
      "method" => method,
      "params" => params
    })
  end
end
