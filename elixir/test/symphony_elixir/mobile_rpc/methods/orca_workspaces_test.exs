defmodule SymphonyElixir.MobileRpc.Methods.OrcaWorkspacesTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.MobileRpc.Dispatcher

  @methods ~w(
    repo.list
    repo.hooks
    repo.searchRefs
    repo.baseRefDefault
    repo.sparsePresets
    repo.saveSparsePreset
    ui.get
    ui.set
    worktree.ps
    worktree.show
    worktree.create
    worktree.activate
    worktree.set
    worktree.sleep
    worktree.rm
  )

  setup do
    dispatcher =
      Dispatcher.new(%{
        host_id: "host-a",
        host_name: "Mac Studio",
        protocol: 1,
        device_id: "device-a",
        orca_repos: [
          %{"id" => "symphony", "displayName" => "Symphony", "path" => "/workspace/symphony"}
        ],
        orca_worktrees: [
          %{
            "worktreeId" => "thread-42",
            "repo" => "Symphony",
            "branch" => "agent/mobile",
            "displayName" => "Mobile",
            "liveTerminalCount" => 1,
            "status" => "active"
          }
        ]
      })

    %{dispatcher: dispatcher}
  end

  test "registers the exact Orca repo, UI and worktree compatibility surface", %{
    dispatcher: dispatcher
  } do
    assert MapSet.subset?(MapSet.new(@methods), MapSet.new(Map.keys(dispatcher.methods)))
  end

  test "presents real Symphony repositories and workspaces", %{dispatcher: dispatcher} do
    assert %{"repos" => [%{"id" => "symphony", "displayName" => "Symphony"}]} =
             dispatch(dispatcher, "repo.list", %{})

    assert %{"worktrees" => [%{"worktreeId" => "thread-42", "status" => "active"}]} =
             dispatch(dispatcher, "worktree.ps", %{"limit" => 100})
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
