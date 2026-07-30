defmodule SymphonyElixir.MobileRpc.Methods.MobileSessionsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileRpc.{Dispatcher, MobileSessionService, MobileSubscription}

  @methods ~w(
    session.tabs.list
    session.tabs.subscribe
    session.tabs.activate
    session.tabs.createTerminal
    session.tabs.close
    terminal.list
    terminal.subscribe
    terminal.send
    terminal.updateViewport
    terminal.focus
    terminal.rename
    terminal.close
    terminal.clearBuffer
    terminal.setDisplayMode
    terminal.getAutoRestoreFit
    terminal.setAutoRestoreFit
    markdown.readTab
    markdown.saveTab
  )

  defmodule FakeSessionService do
    def call("session.tabs.list", %{"worktree" => "id:42"}, context) do
      {:ok, snapshot(context)}
    end

    def call("terminal.list", %{"worktree" => "id:42"}, context) do
      {:ok,
       %{
         "terminals" => [
           %{
             "handle" => "thread:42",
             "title" => "#{context.host_id} terminal",
             "isActive" => true
           }
         ],
         "totalCount" => 1,
         "truncated" => false
       }}
    end

    def call("terminal.send", %{"terminal" => "thread:42", "text" => "Continue"}, context) do
      {:ok,
       %{
         "send" => %{
           "handle" => "thread:42",
           "accepted" => true,
           "bytesWritten" => byte_size("Continue"),
           "hostId" => context.host_id
         }
       }}
    end

    def call("markdown.readTab", %{"worktree" => "id:42", "tabId" => "notes.md"}, _context) do
      {:ok,
       %{
         "tabId" => "notes.md",
         "content" => "# Notes",
         "baseVersion" => "v1",
         "editable" => true
       }}
    end

    def call(method, params, context) do
      {:ok, %{"method" => method, "params" => params, "hostId" => context.host_id}}
    end

    def subscribe("session.tabs.subscribe", %{"worktree" => "id:42"}, context) do
      subscription_id = "session-tabs:#{context.host_id}:42"
      parent = context.connection_pid

      {:ok,
       {:subscription, subscription_id, %{"subscription_id" => subscription_id}, fn -> :ok end,
        fn ->
          send(
            parent,
            {:mobile_rpc_event, subscription_id, "session.tabs.snapshot", Map.put(snapshot(context), "type", "snapshot")}
          )

          send(
            parent,
            {:mobile_rpc_event, subscription_id, "session.tabs.updated",
             snapshot(context)
             |> Map.put("type", "updated")
             |> Map.put("snapshotVersion", 8)}
          )
        end}}
    end

    def subscribe("terminal.subscribe", %{"terminal" => "thread:42"}, context) do
      subscription_id = "terminal:#{context.host_id}:thread:42"
      parent = context.connection_pid

      {:ok,
       {:subscription, subscription_id, %{"subscription_id" => subscription_id}, fn -> :ok end,
        fn ->
          send(
            parent,
            {:mobile_rpc_event, subscription_id, "terminal.scrollback",
             %{
               "type" => "scrollback",
               "serialized" => "#{context.host_id}\n$ ",
               "cols" => 80,
               "rows" => 24
             }}
          )
        end}}
    end

    defp snapshot(context) do
      %{
        "worktree" => "42",
        "publicationEpoch" => "#{context.host_id}:42",
        "snapshotVersion" => 7,
        "tabs" => [
          %{
            "type" => "terminal",
            "id" => "thread:42",
            "title" => "#{context.host_id} terminal",
            "terminal" => "thread:42",
            "isActive" => true,
            "status" => "ready"
          }
        ],
        "activeTabId" => "thread:42",
        "activeTabType" => "terminal"
      }
    end
  end

  defmodule FakeHistory do
    def get_thread(42) do
      {:ok,
       %{
         id: 42,
         project_slug: "symphony",
         workspace_path: "/workspace/symphony",
         title: "Dev10x mobile",
         agent_kind: "codex",
         metadata: %{
           "mobileActiveTabId" => "thread:42",
           "mobileSessionSnapshotVersion" => 3
         }
       }}
    end

    def get_thread(_id), do: {:error, :not_found}

    def update_thread(thread, attrs) do
      send(self(), {:updated_thread, attrs})

      {:ok,
       thread
       |> Map.merge(Map.drop(attrs, [:metadata]))
       |> Map.put(:metadata, Map.get(attrs, :metadata, thread.metadata))}
    end
  end

  defmodule FakeTerminalRegistry do
    def list_tabs("symphony", "42") do
      {:ok,
       [
         %{
           id: "tab-a",
           title: "Tests",
           cwd: "/workspace/symphony",
           state: "running",
           output: "$ mix test"
         }
       ]}
    end

    def create_tab("symphony", "42", attrs) do
      {:ok,
       %{
         id: "tab-new",
         title: attrs["title"] || "Terminal",
         cwd: attrs["cwd"],
         state: "running",
         output: ""
       }}
    end

    def send_input_workspace("symphony", "/workspace/symphony", _data), do: :ok
    def send_input_tab("symphony", "tab-a", _data), do: :ok
    def resize_workspace("symphony", "/workspace/symphony", _cols, _rows), do: :ok
    def resize_tab("symphony", "tab-a", _cols, _rows), do: :ok

    def rename_tab("symphony", "42", "tab-a", title) do
      {:ok,
       %{
         id: "tab-a",
         title: title,
         cwd: "/workspace/symphony",
         state: "running",
         output: ""
       }}
    end

    def close_tab("symphony", "42", "tab-a"), do: :ok
  end

  defmodule FakeThreadDocuments do
    def read(42, "notes.md"), do: {:ok, "# Dev10x notes"}
    def read(_thread_id, _path), do: {:error, :not_found}
  end

  setup do
    %{dispatcher: dispatcher("host-a")}
  end

  test "registers the exact copied session, terminal and markdown surface", %{
    dispatcher: dispatcher
  } do
    assert MapSet.subset?(MapSet.new(@methods), MapSet.new(Map.keys(dispatcher.methods)))
  end

  test "returns copied session and terminal shapes from the selected host", %{
    dispatcher: dispatcher
  } do
    assert %{
             "worktree" => "42",
             "snapshotVersion" => 7,
             "activeTabType" => "terminal",
             "tabs" => [
               %{
                 "type" => "terminal",
                 "terminal" => "thread:42",
                 "status" => "ready"
               }
             ]
           } = dispatch(dispatcher, "session.tabs.list", %{"worktree" => "id:42"})

    assert %{
             "terminals" => [
               %{"handle" => "thread:42", "title" => "host-a terminal", "isActive" => true}
             ],
             "totalCount" => 1,
             "truncated" => false
           } = dispatch(dispatcher, "terminal.list", %{"worktree" => "id:42"})

    assert %{
             "send" => %{
               "handle" => "thread:42",
               "accepted" => true,
               "bytesWritten" => 8,
               "hostId" => "host-a"
             }
           } =
             dispatch(dispatcher, "terminal.send", %{
               "terminal" => "thread:42",
               "text" => "Continue"
             })

    assert %{"content" => "# Notes", "baseVersion" => "v1", "editable" => true} =
             dispatch(dispatcher, "markdown.readTab", %{
               "worktree" => "id:42",
               "tabId" => "notes.md"
             })

    assert %{
             "method" => "terminal.setAutoRestoreFit",
             "params" => %{"ms" => nil}
           } = dispatch(dispatcher, "terminal.setAutoRestoreFit", %{"ms" => nil})
  end

  test "activates tab streaming only after returning its subscription result", %{
    dispatcher: dispatcher
  } do
    {response, subscribed} =
      subscribe(dispatcher, "tabs-sub", "session.tabs.subscribe", %{"worktree" => "id:42"})

    assert %{
             "ok" => true,
             "result" => %{"subscription_id" => subscription_id}
           } = response

    assert_receive first_event
    assert {:reply, first_frame, subscribed} = Dispatcher.handle_info(first_event, subscribed)

    assert %{
             "type" => "event",
             "subscription_id" => ^subscription_id,
             "sequence" => 1,
             "event" => "session.tabs.snapshot",
             "payload" => %{"type" => "snapshot", "snapshotVersion" => 7}
           } = Jason.decode!(first_frame)

    assert_receive second_event
    assert {:reply, second_frame, _next} = Dispatcher.handle_info(second_event, subscribed)

    assert %{
             "sequence" => 2,
             "event" => "session.tabs.updated",
             "payload" => %{"type" => "updated", "snapshotVersion" => 8}
           } = Jason.decode!(second_frame)
  end

  test "keeps terminal subscriptions scoped to each authenticated host" do
    {response_a, state_a} =
      subscribe(dispatcher("host-a"), "terminal-a", "terminal.subscribe", %{
        "terminal" => "thread:42"
      })

    {response_b, state_b} =
      subscribe(dispatcher("host-b"), "terminal-b", "terminal.subscribe", %{
        "terminal" => "thread:42"
      })

    id_a = response_a["result"]["subscription_id"]
    id_b = response_b["result"]["subscription_id"]
    assert id_a != id_b

    assert_receive {:mobile_rpc_event, ^id_a, _, _} = event_a
    assert {:reply, frame_a, _state_a} = Dispatcher.handle_info(event_a, state_a)
    assert Jason.decode!(frame_a)["payload"]["serialized"] == "host-a\n$ "

    assert_receive {:mobile_rpc_event, ^id_b, _, _} = event_b
    assert {:reply, frame_b, _state_b} = Dispatcher.handle_info(event_b, state_b)
    assert Jason.decode!(frame_b)["payload"]["serialized"] == "host-b\n$ "
  end

  test "adapts Symphony History, Terminal.Registry and ThreadDocuments without a second store" do
    context = %{
      host_id: "host-real",
      orca_history: FakeHistory,
      orca_terminal_registry: FakeTerminalRegistry,
      orca_thread_documents: FakeThreadDocuments
    }

    assert {:ok,
            %{
              "worktree" => "42",
              "snapshotVersion" => 3,
              "activeTabId" => "thread:42",
              "tabs" => [
                %{
                  "id" => "thread:42",
                  "terminal" => "thread:42",
                  "launchAgent" => "codex"
                },
                %{
                  "id" => "tab:42:c3ltcGhvbnk:tab-a",
                  "terminal" => "tab:42:c3ltcGhvbnk:tab-a",
                  "title" => "Tests"
                }
              ]
            }} =
             MobileSessionService.call("session.tabs.list", %{"worktree" => "id:42"}, context)

    assert {:ok,
            %{
              "terminals" => [
                %{"handle" => "thread:42", "isActive" => true},
                %{"handle" => "tab:42:c3ltcGhvbnk:tab-a", "isActive" => false}
              ],
              "totalCount" => 2,
              "truncated" => false
            }} =
             MobileSessionService.call("terminal.list", %{"worktree" => "id:42"}, context)

    assert {:ok,
            %{
              "send" => %{
                "handle" => "thread:42",
                "accepted" => true,
                "bytesWritten" => 9
              }
            }} =
             MobileSessionService.call(
               "terminal.send",
               %{"terminal" => "thread:42", "text" => "Continue", "enter" => true},
               context
             )

    assert {:ok,
            %{
              "tabId" => "notes.md",
              "content" => "# Dev10x notes",
              "baseVersion" => base_version,
              "editable" => false
            }} =
             MobileSessionService.call(
               "markdown.readTab",
               %{"worktree" => "id:42", "tabId" => "notes.md"},
               context
             )

    assert is_binary(base_version)

    assert {:ok,
            %{
              "rename" => %{
                "handle" => "tab:42:c3ltcGhvbnk:tab-a",
                "title" => "Verification"
              }
            }} =
             MobileSessionService.call(
               "terminal.rename",
               %{
                 "terminal" => "tab:42:c3ltcGhvbnk:tab-a",
                 "title" => "Verification"
               },
               context
             )

    assert_receive {:updated_thread,
                    %{
                      metadata: %{
                        "mobileSessionSnapshotVersion" => 4
                      }
                    }}
  end

  test "polling tab subscription stays dormant until activation and emits ordered changes" do
    {:ok, snapshot} =
      Agent.start_link(fn ->
        %{
          "worktree" => "42",
          "snapshotVersion" => 1,
          "tabs" => [],
          "activeTabId" => nil,
          "activeTabType" => nil
        }
      end)

    assert {:ok, {:subscription, "tabs:host-a:42", %{"subscription_id" => "tabs:host-a:42"}, cleanup, activate}} =
             MobileSubscription.subscribe(
               connection_pid: self(),
               subscription_id: "tabs:host-a:42",
               event_prefix: "session.tabs",
               interval_ms: 10,
               load: fn -> {:ok, Agent.get(snapshot, & &1)} end
             )

    refute_receive {:mobile_rpc_event, "tabs:host-a:42", _, _}
    activate.()

    assert_receive {:mobile_rpc_event, "tabs:host-a:42", "session.tabs.snapshot", %{"type" => "snapshot", "snapshotVersion" => 1}}

    Agent.update(snapshot, &Map.put(&1, "snapshotVersion", 2))

    assert_receive {:mobile_rpc_event, "tabs:host-a:42", "session.tabs.updated", %{"type" => "updated", "snapshotVersion" => 2}},
                   100

    cleanup.()
  end

  defp dispatcher(host_id) do
    Dispatcher.new(%{
      host_id: host_id,
      host_name: "Mac Studio",
      protocol: 1,
      device_id: "device-a",
      connection_pid: self(),
      orca_session_service: FakeSessionService
    })
  end

  defp dispatch(dispatcher, method, params) do
    {response, _state} =
      subscribe(
        dispatcher,
        "rpc-#{System.unique_integer([:positive])}",
        method,
        params
      )

    assert response["ok"] == true
    response["result"]
  end

  defp subscribe(dispatcher, id, method, params) do
    frame =
      Jason.encode!(%{
        "type" => "rpc",
        "id" => id,
        "method" => method,
        "params" => params
      })

    assert {:noreply, running} = Dispatcher.handle_frame(frame, dispatcher)
    assert_receive {ref, _result} = task_message when is_reference(ref)
    assert {:reply, response, complete} = Dispatcher.handle_info(task_message, running)
    {Jason.decode!(response), complete}
  end
end
