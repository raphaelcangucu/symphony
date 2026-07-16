defmodule SymphonyElixir.Assistant.TunnelToolsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.TunnelTools
  alias SymphonyElixir.Issue

  test "tool_specs exposes a single manage_tunnel schema for the project assistant" do
    # Codex/Cursor reject duplicate dynamic tool names (-32600). The issue-bound
    # variant is advertised separately via DynamicTool.coding_agent_tool_specs/0.
    assert [spec] = TunnelTools.tool_specs()
    assert spec["name"] == "manage_tunnel"
    assert get_in(spec, ["inputSchema", "properties", "identifier"])
  end

  test "status returns project tunnel summary" do
    issue = %Issue{id: "1", identifier: "DEMO-1", project_slug: "demo"}

    assert {:ok, result} =
             TunnelTools.execute("demo", %{"action" => "status"},
               issue: issue,
               summary: fn "demo" -> %{enabled: true, running: false} end
             )

    assert result.tool == "manage_tunnel"
    assert result.data.enabled == true
    assert result.data.running == false
  end

  test "start calls start_tunnel and returns running summary" do
    assert {:ok, result} =
             TunnelTools.execute("demo", %{"action" => "start"},
               start_tunnel: fn -> {:ok, :running} end,
               summary: fn _ -> %{enabled: true, running: true} end
             )

    assert result.data.running == true
  end

  test "stop returns unsupported structured error" do
    assert {:ok, result} =
             TunnelTools.execute("demo", %{"action" => "stop"}, [])

    assert result.data.ok == false
    assert result.data.reason == "unsupported"
    assert result.data.next_steps =~ "start"
  end

  test "start failure returns tunnel_failed with next_steps" do
    assert {:ok, result} =
             TunnelTools.execute("demo", %{"action" => "start"},
               start_tunnel: fn -> {:error, :cloudflared_missing} end,
               summary: fn _ -> %{enabled: true, running: false} end
             )

    assert result.data.ok == false
    assert result.data.reason == "tunnel_failed"
    assert is_binary(result.data.next_steps)
  end
end
