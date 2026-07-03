defmodule SymphonyElixir.Terminal.TabStoreTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Terminal.TabStore

  setup do
    start = TabStore.start_link(name: TabStoreTest)
    on_exit(fn -> GenServer.stop(TabStoreTest, :normal, 5000) end)
    start
  end

  test "stores and lists tabs scoped to project and issue" do
    tab = %{
      id: "tab-1",
      project_slug: "demo",
      issue_identifier: "DEMO-1",
      title: "Shell",
      cwd: "/tmp/demo",
      command: nil,
      session_name: "sym-tab-demo-tab-1",
      state: "running"
    }

    :ok = TabStore.put(tab)

    assert TabStore.list("demo", "DEMO-1") == [tab]
    assert TabStore.list("demo", "OTHER-1") == []
  end

  test "renames and deletes tabs" do
    tab = %{
      id: "tab-2",
      project_slug: "demo",
      issue_identifier: "DEMO-1",
      title: "Shell",
      cwd: "/tmp/demo",
      command: nil,
      session_name: "sym-tab-demo-tab-2",
      state: "running"
    }

    :ok = TabStore.put(tab)

    assert {:ok, renamed} = TabStore.rename("demo", "DEMO-1", "tab-2", "Build")
    assert renamed.title == "Build"

    assert :ok = TabStore.delete("demo", "DEMO-1", "tab-2")
    assert {:error, :not_found} = TabStore.get("demo", "tab-2")
  end
end
