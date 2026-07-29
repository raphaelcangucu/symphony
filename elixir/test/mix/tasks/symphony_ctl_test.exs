defmodule Mix.Tasks.Symphony.CtlTest do
  use ExUnit.Case, async: true

  alias Mix.Tasks.Symphony.Ctl, as: Task

  test "update defaults to web-only" do
    assert {:update, [:web]} = Task.parse(["update"])
  end

  test "stop defaults to all subtrees (full shutdown)" do
    assert {:stop, :all} = Task.parse(["stop"])
  end

  test "explicit flags accumulate and de-dupe in canonical order" do
    assert {:update, [:web, :orchestrator]} =
             Task.parse(["update", "--orchestrator", "--web", "--web"])
  end

  test "--code-server and --editor are aliases" do
    assert {:update, [:editor]} = Task.parse(["update", "--code-server"])
    assert {:update, [:editor]} = Task.parse(["update", "--editor"])
  end

  test "--all expands to every subtree for update, and :all for stop" do
    assert {:update, [:web, :orchestrator, :editor]} = Task.parse(["update", "--all"])
    assert {:stop, :all} = Task.parse(["stop", "--all"])
  end

  test "stop with a single flag targets just that subtree" do
    assert {:stop, [:orchestrator]} = Task.parse(["stop", "--orchestrator"])
  end

  test "serve ignores subtree flags (full bring-up)" do
    assert {:serve, :all} = Task.parse(["serve"])
    assert {:serve, :all} = Task.parse(["serve", "--web"])
  end

  test "unknown subcommand raises a clear error" do
    assert_raise Mix.Error, ~r/unknown command/i, fn -> Task.parse(["frobnicate"]) end
  end

  test "detached launcher uses the native strategy for Linux, macOS, and Windows" do
    assert {:setsid, "/usr/bin/setsid"} =
             Task.detached_launch_mode({:unix, :linux}, "/usr/bin/setsid", "/usr/bin/nohup")

    assert {:nohup, "/usr/bin/nohup"} =
             Task.detached_launch_mode({:unix, :darwin}, nil, "/usr/bin/nohup")

    assert :windows_start =
             Task.detached_launch_mode({:win32, :nt}, "/usr/bin/setsid", "/usr/bin/nohup")
  end
end
