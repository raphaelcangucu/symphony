defmodule SymphonyElixir.Terminal.RegistryTabTest do
  use ExUnit.Case, async: false

  alias SymphonyElixir.Terminal.{Registry, TabStore}

  defmodule FakeWorkspace do
    def create_for_issue(%{identifier: "DEMO-1"}), do: {:ok, "/tmp/symphony-workspaces/DEMO-1"}
  end

  defmodule FakeTmux do
    def available?, do: true
    def has_session?(_name), do: false
    def new_session(_name, _cwd), do: :ok
    def capture_pane(_name), do: {:ok, "ready\n"}
    def send_keys(_name, _data), do: :ok
    def kill_session(_name), do: :ok
    def resize(_name, _cols, _rows), do: :ok
  end

  setup do
    case TabStore.start_link() do
      {:ok, _pid} -> :ok
      {:error, {:already_started, _pid}} -> :ok
    end

    on_exit(fn ->
      for tab <- TabStore.list("demo", "DEMO-1") do
        Registry.close_tab("demo", "DEMO-1", tab.id, tmux: FakeTmux)
      end
    end)

    :ok
  end

  test "creates, lists, renames, and closes dynamic tabs" do
    opts = [
      tmux: FakeTmux,
      workspace: FakeWorkspace,
      issue_fetcher: fn _, _ -> {:ok, %{identifier: "DEMO-1", project: %{slug: "demo"}}} end
    ]

    assert {:ok, tab} = Registry.create_tab("demo", "DEMO-1", %{"title" => "Build"}, opts)
    assert tab.title == "Build"
    assert tab.channel_topic == Registry.tab_channel_topic("demo", tab.id)

    assert {:ok, [listed]} = Registry.list_tabs("demo", "DEMO-1")
    assert listed.id == tab.id

    assert {:ok, renamed} = Registry.rename_tab("demo", "DEMO-1", tab.id, "Tests")
    assert renamed.title == "Tests"

    assert :ok = Registry.close_tab("demo", "DEMO-1", tab.id, opts)
    assert {:ok, []} = Registry.list_tabs("demo", "DEMO-1")
  end

  test "tab session name is stable and safe" do
    assert Registry.tab_session_name("demo", "tab-abc") == "sym-tab-demo-tab-abc"
  end

  test "creates project-scoped tabs without fetching an issue" do
    opts = [tmux: FakeTmux]

    on_exit(fn ->
      for tab <- TabStore.list("demo", "__project__") do
        Registry.close_tab("demo", "__project__", tab.id, tmux: FakeTmux)
      end
    end)

    assert {:ok, tab} = Registry.create_tab("demo", "__project__", %{"title" => "Project shell"}, opts)
    assert tab.issue_identifier == "__project__"
    assert is_binary(tab.cwd)
    assert tab.cwd != ""
  end
end
