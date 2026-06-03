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

  test "orchestrator subtree owns the Codex TaskSupervisor, not the shared one" do
    specs = OrchestratorSupervisor.child_specs()
    ids = ids(specs)
    assert SymphonyElixir.Orchestrator in ids
    assert {Task.Supervisor, name: SymphonyElixir.Orchestrator.TaskSupervisor} in specs
    refute {Task.Supervisor, name: SymphonyElixir.TaskSupervisor} in specs
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
