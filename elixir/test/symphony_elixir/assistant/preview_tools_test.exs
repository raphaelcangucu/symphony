defmodule SymphonyElixir.Assistant.PreviewToolsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.PreviewTools
  alias SymphonyElixir.Issue

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
    assert result.data.e2e_command == "cd admin && bash .symphony/run-e2e.sh"
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
end
