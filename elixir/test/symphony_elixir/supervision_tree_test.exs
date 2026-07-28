defmodule SymphonyElixir.SupervisionTreeTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.{SharedSupervisor, OrchestratorSupervisor, WebSupervisor, EditorSupervisor}

  defp ids(child_specs) do
    Enum.map(child_specs, fn
      %{id: id} -> id
      {mod, _opts} -> mod
      mod when is_atom(mod) -> mod
    end)
  end

  test "shared subtree owns the single SQLite writer and the shared TaskSupervisor" do
    ids = ids(SharedSupervisor.child_specs())
    assert SymphonyElixir.Repo in ids
    assert Phoenix.PubSub in ids
    assert {Task.Supervisor, name: SymphonyElixir.TaskSupervisor} in SharedSupervisor.child_specs()
  end

  test "orchestrator subtree pairs the Orchestrator and its Codex TaskSupervisor" do
    assert SymphonyElixir.Orchestrator.RunnerSupervisor in ids(OrchestratorSupervisor.child_specs())
    assert SymphonyElixir.AgentLifecycle.Maintenance in ids(OrchestratorSupervisor.child_specs())

    runner_specs = SymphonyElixir.Orchestrator.RunnerSupervisor.child_specs()
    assert SymphonyElixir.Orchestrator in ids(runner_specs)
    assert {Task.Supervisor, name: SymphonyElixir.Orchestrator.TaskSupervisor} in runner_specs
    refute {Task.Supervisor, name: SymphonyElixir.Orchestrator.TaskSupervisor} in OrchestratorSupervisor.child_specs()
  end

  test "runner subtree restarts the Orchestrator and TaskSupervisor together (one_for_all)" do
    assert {:ok, {flags, _children}} = SymphonyElixir.Orchestrator.RunnerSupervisor.init([])
    assert flags.strategy == :one_for_all
  end

  test "web subtree owns the HTTP server and dashboard only" do
    ids = ids(WebSupervisor.child_specs())
    assert SymphonyElixir.HttpServer in ids
    assert SymphonyElixir.StatusDashboard in ids
    refute SymphonyElixir.Orchestrator in ids
  end

  test "editor subtree is empty when the editor is disabled" do
    assert EditorSupervisor.child_specs(false) == []
    assert SymphonyElixir.Editor.Server in ids(EditorSupervisor.child_specs(true))
  end

  test "application root lists exactly the four named sub-supervisors in order" do
    assert SymphonyElixir.Application.root_children() == [
             SymphonyElixir.SharedSupervisor,
             SymphonyElixir.OrchestratorSupervisor,
             SymphonyElixir.WebSupervisor,
             SymphonyElixir.EditorSupervisor
           ]
  end
end
