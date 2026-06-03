defmodule SymphonyElixir.CtlTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Ctl

  # Build a throwaway top supervisor whose "subtrees" are Agents, so we can
  # observe which ones get restarted (pid changes) without booting the real app.
  defp start_fake_tree do
    children = [
      Supervisor.child_spec({Agent, fn -> :web end}, id: :web_sup),
      Supervisor.child_spec({Agent, fn -> :orchestrator end}, id: :orchestrator_sup),
      Supervisor.child_spec({Agent, fn -> :editor end}, id: :editor_sup)
    ]

    {:ok, sup} = Supervisor.start_link(children, strategy: :one_for_one)
    sup
  end

  defp child_pid(sup, id) do
    {^id, pid, _, _} = Enum.find(Supervisor.which_children(sup), &(elem(&1, 0) == id))
    pid
  end

  test "restart/2 restarts only the requested subtrees and reloads modules first" do
    sup = start_fake_tree()
    ids = %{web: :web_sup, orchestrator: :orchestrator_sup, editor: :editor_sup}

    test_pid = self()

    reload_fun = fn ->
      send(test_pid, :reloaded)
      [SomeModule]
    end

    before_web = child_pid(sup, :web_sup)
    before_orch = child_pid(sup, :orchestrator_sup)

    assert {:ok, %{restarted: [:web], reloaded: [SomeModule]}} =
             Ctl.restart([:web], supervisor: sup, ids: ids, reload_fun: reload_fun)

    assert_received :reloaded
    refute child_pid(sup, :web_sup) == before_web
    assert child_pid(sup, :orchestrator_sup) == before_orch
  end

  test "stop_subtrees/2 terminates only the requested subtrees (no restart)" do
    sup = start_fake_tree()
    ids = %{web: :web_sup, orchestrator: :orchestrator_sup, editor: :editor_sup}

    assert :ok = Ctl.stop_subtrees([:web], supervisor: sup, ids: ids)

    assert {:web_sup, :undefined, _, _} =
             Enum.find(Supervisor.which_children(sup), &(elem(&1, 0) == :web_sup))

    assert {:orchestrator_sup, pid, _, _} =
             Enum.find(Supervisor.which_children(sup), &(elem(&1, 0) == :orchestrator_sup))

    assert is_pid(pid)
  end

  test "node_name/0 and cookie/0 honor env overrides with dev defaults" do
    assert Ctl.node_name(%{}) == "symphony@127.0.0.1"
    assert Ctl.node_name(%{"SYMPHONY_NODE_NAME" => "sym2"}) == "sym2@127.0.0.1"
    assert Ctl.cookie(%{}) == "symphony-dev-cookie"
    assert Ctl.cookie(%{"SYMPHONY_NODE_COOKIE" => "abc"}) == "abc"
  end
end
