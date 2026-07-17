defmodule SymphonyElixir.Assistant.ListPreviewToolsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.ListPreviewTools

  test "tool spec describes list_previews without arguments" do
    assert [spec] = ListPreviewTools.tool_specs()

    assert spec["name"] == "list_previews"
    assert spec["description"] =~ "List active issue previews"

    assert spec["inputSchema"] == %{
             "type" => "object",
             "additionalProperties" => false,
             "properties" => %{}
           }
  end

  test "tool description prefers manage_preview leased ports and forbids inventing ports" do
    spec = ListPreviewTools.assistant_tool_spec()
    desc = spec["description"]
    assert desc =~ "manage_preview"
    assert desc =~ ~r/leased|in_sync/i
    assert desc =~ "invent"
    refute desc =~ "dock may"
  end

  test "next_steps forbid unmanaged bring-up when previews are unhealthy" do
    assert {:ok, result} =
             ListPreviewTools.execute("demo", %{},
               running_issue_keys: fn -> [{"demo", "DEMO-1"}] end,
               issue_targets: fn _slug, _id ->
                 {:ok,
                  %{
                    available: true,
                    reason: nil,
                    servers: [%{slug: "web", status: "crashed", port: 4300}]
                  }}
               end,
               tunnel_summary: fn _ -> %{enabled: false, running: false} end
             )

    assert result.data.next_steps =~ "manage_preview"
    assert result.data.next_steps =~ "prepare"
    assert result.data.next_steps =~ "in_sync"
    refute result.data.next_steps =~ "dock may"
  end

  test "lists running preview issues for a project" do
    assert {:ok, result} =
             ListPreviewTools.execute("demo", %{},
               running_issue_keys: fn -> MapSet.new([{"demo", "DEMO-1"}, {"other", "X-1"}]) end,
               issue_targets: fn
                 "demo", "DEMO-1" ->
                   {:ok,
                    %{
                      available: true,
                      reason: nil,
                      servers: [
                        %{
                          id: 1,
                          slug: "front",
                          status: "crashed",
                          port: 4101,
                          primary: true,
                          public_url: "https://front.example.test"
                        }
                      ],
                      tunnel: %{enabled: true, running: false}
                    }}
               end,
               tunnel_summary: fn _project_slug -> flunk("view tunnel should be preferred") end
             )

    assert result.tool == "list_previews"
    assert result.message == "Found 1 preview(s) for demo."
    assert [entry] = result.data.previews
    assert entry.identifier == "DEMO-1"
    assert entry.available == true
    assert entry.reason == nil
    assert entry.tunnel == %{enabled: true, running: false}
    assert [%{slug: "front", status: "crashed", local_url: "http://127.0.0.1:4101/api/health"}] = entry.servers
    assert hd(entry.servers).public_url == "https://front.example.test"
    assert result.data.next_steps =~ "manage_preview"
  end

  test "filters keys to the current project before loading issue targets" do
    loaded_identifiers =
      start_supervised!({Agent, fn -> [] end})

    assert {:ok, result} =
             ListPreviewTools.execute("demo", %{},
               running_issue_keys: fn -> [{"demo", "DEMO-2"}, {"other", "OTHER-1"}] end,
               issue_targets: fn project_slug, identifier ->
                 Agent.update(loaded_identifiers, &[identifier | &1])
                 assert project_slug == "demo"

                 {:ok,
                  %{
                    available: true,
                    reason: nil,
                    servers: [%{"id" => "2", "slug" => "api", "status" => "ready", "port" => 4102}]
                  }}
               end,
               tunnel_summary: fn "demo" -> %{enabled: false, running: false} end
             )

    assert Agent.get(loaded_identifiers, & &1) == ["DEMO-2"]
    assert [entry] = result.data.previews
    assert entry.identifier == "DEMO-2"
    assert entry.tunnel == %{enabled: false, running: false}
    assert result.data.next_steps == nil
    assert [%{id: 2, slug: "api", status: "ready", port: 4102}] = entry.servers
  end

  test "discovers contract-backed previews when the in-memory registry is empty" do
    assert {:ok, result} =
             ListPreviewTools.execute("demo", %{},
               running_issue_keys: fn -> MapSet.new() end,
               contracted_issue_identifiers: fn "demo" -> ["DEMO-9"] end,
               issue_targets: fn "demo", "DEMO-9" ->
                 {:ok,
                  %{
                    available: true,
                    reason: nil,
                    servers: [%{id: 9, slug: "app", status: "ready", port: 4300, primary: true}]
                  }}
               end,
               tunnel_summary: fn "demo" -> %{enabled: false, running: false} end
             )

    assert result.message == "Found 1 preview(s) for demo."
    assert [entry] = result.data.previews
    assert entry.identifier == "DEMO-9"
    assert [%{slug: "app", status: "ready", port: 4300}] = entry.servers
  end

  test "drops contract-discovered previews whose servers are all stopped" do
    assert {:ok, result} =
             ListPreviewTools.execute("demo", %{},
               running_issue_keys: fn -> MapSet.new([{"demo", "DEMO-1"}]) end,
               contracted_issue_identifiers: fn "demo" -> ["DEMO-1", "DEMO-2"] end,
               issue_targets: fn
                 "demo", "DEMO-1" ->
                   {:ok,
                    %{
                      available: true,
                      reason: nil,
                      servers: [%{id: 1, slug: "app", status: "stopped", port: 4300, primary: true}]
                    }}

                 "demo", "DEMO-2" ->
                   {:ok,
                    %{
                      available: true,
                      reason: nil,
                      servers: [%{id: 2, slug: "app", status: "stopped", port: 4308, primary: true}]
                    }}
               end,
               tunnel_summary: fn "demo" -> %{enabled: false, running: false} end
             )

    # DEMO-1 is registry-backed so it stays even while stopped; DEMO-2 is a
    # contract leftover with nothing serving and is dropped.
    assert [entry] = result.data.previews
    assert entry.identifier == "DEMO-1"
  end

  test "surfaces unavailable previews and lookup errors with next steps" do
    assert {:ok, result} =
             ListPreviewTools.execute("demo", %{},
               running_issue_keys: fn -> [{"demo", "DEMO-3"}, {"demo", "DEMO-4"}] end,
               issue_targets: fn
                 "demo", "DEMO-3" ->
                   {:ok, %{available: false, reason: :no_serve_step, servers: []}}

                 "demo", "DEMO-4" ->
                   {:error, :project_not_found}
               end,
               tunnel_summary: fn "demo" -> %{enabled: true, running: true} end
             )

    assert [unavailable, error_entry] = result.data.previews
    assert unavailable.identifier == "DEMO-3"
    assert unavailable.available == false
    assert unavailable.reason == "no_serve_step"
    assert unavailable.tunnel == %{enabled: true, running: true}

    assert error_entry.identifier == "DEMO-4"
    assert error_entry.available == false
    assert error_entry.reason == "project_not_found"
    assert error_entry.servers == []

    assert result.data.next_steps =~ "Inspect unhealthy entries"
  end
end
