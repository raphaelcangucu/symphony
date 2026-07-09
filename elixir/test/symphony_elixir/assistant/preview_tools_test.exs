defmodule SymphonyElixir.Assistant.PreviewToolsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.PreviewTools
  alias SymphonyElixir.Issue

  test "tool specs allow output action and optional server" do
    for spec <- PreviewTools.tool_specs() do
      properties = spec["inputSchema"]["properties"]

      assert properties["server"]["type"] == "string"
      assert "output" in properties["action"]["enum"]
    end
  end

  test "enrich_view adds serve_steps_configured and next_steps for no_serve_step" do
    view = %{available: false, reason: :no_serve_step, servers: []}

    enriched =
      PreviewTools.enrich_view("demo", view, fn _slug ->
        []
      end)

    assert enriched.serve_steps_configured == false
    assert enriched.reason == "no_serve_step"
    assert enriched.next_steps =~ "manage_dev_env"
  end

  test "status returns enriched preview view with local_url" do
    issue = %Issue{id: "1", identifier: "DEMO-1", project_slug: "demo"}

    assert {:ok, result} =
             PreviewTools.execute("demo", %{"action" => "status"},
               issue: issue,
               issue_targets: fn _slug, _id ->
                 {:ok,
                  %{
                    available: true,
                    reason: nil,
                    servers: [
                      %{slug: "distributionmachine-admin", status: "ready", port: 4201, primary: true},
                      %{slug: "distributionmachine-api", status: "ready", port: 4200}
                    ]
                  }}
               end,
               list_serve_steps: fn _slug -> [%{role: "serve"}] end
             )

    assert result.tool == "manage_preview"
    [admin, api] = result.data.servers
    assert admin.local_url == "http://127.0.0.1:4201/"
    assert api.local_url == "http://127.0.0.1:4200/api/health"
  end

  test "status returns enriched preview view for disabled" do
    issue = %Issue{id: "1", identifier: "DEMO-1", project_slug: "demo"}

    assert {:ok, result} =
             PreviewTools.execute("demo", %{"action" => "status"},
               issue: issue,
               issue_targets: fn _slug, _id ->
                 {:ok, %{available: false, reason: :disabled, servers: [%{slug: "front", status: "stopped"}]}}
               end,
               list_serve_steps: fn _slug -> [%{role: "serve"}] end
             )

    assert result.tool == "manage_preview"
    assert result.data.serve_steps_configured == true
    assert result.data.reason == "disabled"
    assert result.data.next_steps =~ "dev_server"
    assert [%{slug: "front"}] = result.data.servers
  end

  test "issue-bound execute uses bound issue identifier" do
    issue = %Issue{id: "1", identifier: "DEMO-2", project_slug: "demo"}

    assert {:ok, result} =
             PreviewTools.execute("demo", %{"action" => "status"},
               issue: issue,
               issue_targets: fn _slug, identifier ->
                 assert identifier == "DEMO-2"
                 {:ok, %{available: true, reason: nil, servers: []}}
               end,
               list_serve_steps: fn _slug -> [%{role: "serve"}] end
             )

    assert result.data.available == true
    assert result.data.next_steps == nil
  end

  test "start passes the bounded ready timeout and gives non-blocking guidance while booting" do
    issue = %Issue{id: "1", identifier: "DEMO-3", project_slug: "demo"}

    assert {:ok, result} =
             PreviewTools.execute("demo", %{"action" => "start"},
               issue: issue,
               start_for_issue: fn slug, identifier, opts ->
                 assert slug == "demo"
                 assert identifier == "DEMO-3"
                 assert Keyword.fetch!(opts, :ready_timeout_ms) == 30_000
                 {:ok, [self()]}
               end,
               issue_targets: fn _slug, _id ->
                 {:ok,
                  %{
                    available: true,
                    reason: nil,
                    servers: [%{slug: "web", status: "starting", port: 4300, primary: true}]
                  }}
               end,
               list_serve_steps: fn _slug -> [%{role: "serve"}] end
             )

    assert result.tool == "manage_preview"
    assert result.message =~ "non-blocking"
    assert result.message =~ "status"
    assert result.data.next_steps =~ "do not block"
    assert [%{slug: "web", status: "starting"}] = result.data.servers
  end

  test "start with server slug targets one instance" do
    issue = %Issue{id: "1", identifier: "DEMO-1", project_slug: "demo"}
    {:ok, started} = Agent.start_link(fn -> nil end)

    assert {:ok, result} =
             PreviewTools.execute("demo", %{"action" => "start", "server" => "front"},
               issue: issue,
               start_instance: fn slug, identifier, server_id ->
                 Agent.update(started, fn _ -> {slug, identifier, server_id} end)
                 {:ok, self()}
               end,
               issue_targets: fn _slug, _id ->
                 {:ok,
                  %{
                    available: true,
                    reason: nil,
                    servers: [
                      %{id: 7, slug: "front", status: "starting", port: 4101, primary: true},
                      %{id: 8, slug: "back", status: "stopped", port: 4100}
                    ]
                  }}
               end,
               list_serve_steps: fn _slug -> [%{role: "serve"}] end
             )

    assert Agent.get(started, & &1) == {"demo", "DEMO-1", 7}
    assert result.tool == "manage_preview"
    assert Enum.any?(result.data.servers, &(&1.slug == "front"))
  end

  test "start reports all servers ready when the preview comes up in time" do
    issue = %Issue{id: "1", identifier: "DEMO-4", project_slug: "demo"}

    assert {:ok, result} =
             PreviewTools.execute("demo", %{"action" => "start"},
               issue: issue,
               start_for_issue: fn _slug, _id, _opts -> {:ok, [self()]} end,
               issue_targets: fn _slug, _id ->
                 {:ok, %{available: true, reason: nil, servers: [%{slug: "web", status: "ready", port: 4300}]}}
               end,
               list_serve_steps: fn _slug -> [%{role: "serve"}] end
             )

    assert result.message =~ "all servers are ready"
    refute result.message =~ "non-blocking"
    assert result.data.next_steps == nil
  end

  test "start converts a crashed dev server into structured non-blocking guidance, not a bare error" do
    issue = %Issue{id: "1", identifier: "DEMO-5", project_slug: "demo"}

    assert {:ok, result} =
             PreviewTools.execute("demo", %{"action" => "start"},
               issue: issue,
               start_for_issue: fn _slug, _id, _opts -> {:error, :crashed} end,
               issue_targets: fn _slug, _id ->
                 {:ok, %{available: true, reason: nil, servers: [%{id: 9, slug: "web", status: "crashed", port: 4300}]}}
               end,
               capture_output: fn "demo", "DEMO-5", 9 ->
                 {:ok, %{output: "boom\nstack\n", session_name: "sym-dev-demo-DEMO-5-web"}}
               end,
               list_serve_steps: fn _slug -> [%{role: "serve"}] end
             )

    assert result.tool == "manage_preview"
    assert result.message =~ "crashed"
    assert result.message =~ "Do not block"
    assert result.data.next_steps =~ "retry"
    assert result.data.output_tail =~ "boom"
  end

  test "start passes config errors such as :disabled straight through as failures" do
    issue = %Issue{id: "1", identifier: "DEMO-6", project_slug: "demo"}

    assert {:error, :disabled} =
             PreviewTools.execute("demo", %{"action" => "start"},
               issue: issue,
               start_for_issue: fn _slug, _id, _opts -> {:error, :disabled} end,
               issue_targets: fn _slug, _id -> flunk("issue_targets must not be called on a passthrough error") end,
               list_serve_steps: fn _slug -> [%{role: "serve"}] end
             )
  end

  test "restart applies the bounded timeout via restart_for_issue" do
    issue = %Issue{id: "1", identifier: "DEMO-7", project_slug: "demo"}

    assert {:ok, result} =
             PreviewTools.execute("demo", %{"action" => "restart"},
               issue: issue,
               restart_for_issue: fn _slug, _id, opts ->
                 assert Keyword.fetch!(opts, :ready_timeout_ms) == 30_000
                 {:ok, [self()]}
               end,
               issue_targets: fn _slug, _id ->
                 {:ok, %{available: true, reason: nil, servers: [%{slug: "web", status: "ready", port: 4300}]}}
               end,
               list_serve_steps: fn _slug -> [%{role: "serve"}] end
             )

    assert result.message =~ "Restarted preview"
    assert result.message =~ "all servers are ready"
  end

  test "output returns bounded output_tail for a server" do
    issue = %Issue{id: "1", identifier: "DEMO-1", project_slug: "demo"}
    output = 1..105 |> Enum.map_join("\n", &"line-#{&1}")

    assert {:ok, result} =
             PreviewTools.execute("demo", %{"action" => "output", "server" => "front"},
               issue: issue,
               issue_targets: fn _slug, _id ->
                 {:ok,
                  %{
                    available: true,
                    reason: nil,
                    servers: [%{id: 7, slug: "front", status: "crashed", port: 4101, primary: true}]
                  }}
               end,
               capture_output: fn _slug, _id, 7 ->
                 {:ok, %{output: output, session_name: "sym-dev-demo-DEMO-1-front"}}
               end,
               list_serve_steps: fn _slug -> [%{role: "serve"}] end
             )

    assert result.tool == "manage_preview"
    assert result.data.reason == "crashed"
    assert result.data.output_tail =~ "line-105"
    refute result.data.output_tail =~ "line-1\n"
    assert length(String.split(result.data.output_tail, "\n")) == 100
    assert result.data.server.slug == "front"
    assert is_binary(result.data.next_steps)
  end

  test "output without server returns structured invalid args" do
    issue = %Issue{id: "1", identifier: "DEMO-1", project_slug: "demo"}

    assert {:error, {:invalid_preview_arguments, message}} =
             PreviewTools.execute("demo", %{"action" => "output"}, issue: issue)

    assert message =~ "server"
  end
end
