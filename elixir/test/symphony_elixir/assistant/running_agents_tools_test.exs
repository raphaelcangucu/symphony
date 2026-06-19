defmodule SymphonyElixir.Assistant.RunningAgentsToolsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.RunningAgentsTools

  test "assistant spec takes no required arguments" do
    spec = RunningAgentsTools.assistant_tool_spec()
    assert spec["name"] == "list_running_agents"
    refute Map.has_key?(spec["inputSchema"], "required")
  end

  test "lists running and retrying agents from the snapshot payload" do
    payload = %{
      running: [%{issue_identifier: "MAC-1", project_slug: "macro", state: "In Progress"}],
      retrying: [%{issue_identifier: "MAC-2", project_slug: "macro", attempt: 2}]
    }

    assert {:ok, result} =
             RunningAgentsTools.execute("macro", %{}, state_payload: fn "macro" -> payload end)

    assert result.tool == "list_running_agents"
    assert result.data.available == true
    assert result.data.project_slug == "macro"
    assert result.data.counts == %{running: 1, retrying: 1}
    assert [%{issue_identifier: "MAC-1"}] = result.data.running
    assert [%{issue_identifier: "MAC-2"}] = result.data.retrying
    assert result.message =~ "1 agent"
  end

  test "reports no running agents when both lists are empty" do
    payload = %{running: [], retrying: []}

    assert {:ok, result} =
             RunningAgentsTools.execute(nil, %{}, state_payload: fn nil -> payload end)

    assert result.data.available == true
    assert result.data.counts == %{running: 0, retrying: 0}
    assert result.message =~ "No agents"
  end

  test "stays graceful when the orchestrator snapshot is unavailable" do
    payload = %{error: %{code: "snapshot_unavailable", message: "Snapshot unavailable"}}

    assert {:ok, result} =
             RunningAgentsTools.execute("macro", %{}, state_payload: fn _slug -> payload end)

    assert result.data.available == false
    assert result.data.running == []
    assert result.data.retrying == []
    assert result.message =~ "unavailable"
  end
end
