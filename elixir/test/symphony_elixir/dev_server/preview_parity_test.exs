defmodule SymphonyElixir.DevServer.PreviewParityTest do
  @moduledoc """
  Cross-layer parity for the Unified Preview Runtime Contract.

  One shared fixture drives every consumer: the preferred port (4300) is busy, so
  the serve process bound the first *allowed* fallback (4310) and reported it. The
  report is accepted, the snapshot is `in_sync` at 4310, and REST, SSE, the
  `list_previews` tool, and the coding-agent prompt all render that same port and
  URL — proving the plan's invariant that every surface renders one snapshot.

  It also locks in the reversal of the old "fallback may desync the dock"
  contract: an out-of-lease report is a `conflict`, never an adopted port.
  """
  use ExUnit.Case, async: true

  alias SymphonyElixir.Assistant.ListPreviewTools
  alias SymphonyElixir.DevServer.{RuntimeContract, RuntimeReport, Snapshot}
  alias SymphonyElixir.PromptBuilder
  alias SymphonyElixirWeb.DevServerPresenter

  @project_slug "advising"
  @identifier "CDE-1131"
  @server_slug "advising"
  @preferred_port 4300
  @allowed_ports [4300, 4310, 4320]
  @actual_port 4310
  @out_of_lease_port 59_595
  @contract_id "ctr_parity_fixture"
  @revision 3
  @snapshot_id "snap_parityfixture"
  @step %{slug: @server_slug, ready_path: "/health", url_path: "/"}

  defp contract do
    {:ok, contract} =
      RuntimeContract.new(%{
        contract_id: @contract_id,
        revision: @revision,
        project_slug: @project_slug,
        issue_identifier: @identifier,
        server_slug: @server_slug,
        source: :contracted_manual,
        preferred_port: @preferred_port,
        allowed_ports: @allowed_ports,
        report_path: "/tmp/#{@contract_id}/preview-report.json",
        ready_probe: "http",
        ready_path: "/health",
        url_path: "/",
        port_env: "INSPIRE_PORT",
        expires_at: DateTime.add(DateTime.utc_now(), 3600, :second)
      })

    contract
  end

  defp report(actual_port) do
    {:ok, report} =
      RuntimeReport.from_map(%{
        version: 1,
        contract_id: @contract_id,
        revision: @revision,
        server_slug: @server_slug,
        state: "ready",
        selected_port: @preferred_port,
        actual_port: actual_port,
        reported_at: DateTime.to_iso8601(DateTime.utc_now())
      })

    report
  end

  # The per-server view as Snapshot.build/2 assembles it for the accepted runtime:
  # local_url and sync_state come from the same public Snapshot helpers every
  # consumer routes through, so the fixture cannot drift from real snapshots.
  defp server_view(status, port) do
    c = contract()
    {sync_state, sync_reason} = Snapshot.sync_state(status, port, @allowed_ports)

    %{
      id: 1,
      slug: @server_slug,
      working_dir: "advising",
      port: port,
      url: nil,
      local_url: Snapshot.local_url(port, @step),
      public_url: nil,
      status: status,
      primary: true,
      session_name: "sym-dev-advising-CDE-1131-advising",
      source: c.source,
      contract_id: c.contract_id,
      revision: c.revision,
      preferred_port: c.preferred_port,
      allowed_ports: c.allowed_ports,
      actual_port: port,
      sync_state: sync_state,
      sync_reason: sync_reason
    }
  end

  defp snapshot(status, port) do
    %{
      snapshot_id: @snapshot_id,
      as_of: DateTime.utc_now(),
      project_slug: @project_slug,
      identifier: @identifier,
      available: true,
      reason: nil,
      tunnel: %{enabled: false, running: false},
      servers: [server_view(status, port)]
    }
  end

  defp list_previews(snapshot) do
    {:ok, result} =
      ListPreviewTools.execute(@project_slug, %{},
        running_issue_keys: fn -> [{@project_slug, @identifier}] end,
        issue_targets: fn @project_slug, @identifier -> {:ok, snapshot} end,
        tunnel_summary: fn _slug -> %{enabled: false, running: false} end
      )

    result
  end

  describe "bounded fallback selection + report acceptance" do
    test "the preferred port is busy, so an allowed fallback is chosen (not an arbitrary port)" do
      # The fixture models the exact plan scenario: preferred unavailable, a
      # disjoint in-lease fallback selected.
      assert @preferred_port in @allowed_ports
      assert @actual_port in @allowed_ports
      refute @actual_port == @preferred_port
    end

    test "a report on the leased fallback is accepted for the contract" do
      assert RuntimeReport.evaluate(report(@actual_port), contract()) == {:ok, @actual_port}
    end

    test "the accepted runtime is in_sync at the fallback port" do
      assert Snapshot.sync_state("ready", @actual_port, @allowed_ports) == {:in_sync, nil}
    end
  end

  describe "one snapshot, identical port/URL across every surface" do
    setup do
      snapshot = snapshot("ready", @actual_port)
      canonical_url = Snapshot.local_url(@actual_port, @step)
      %{snapshot: snapshot, canonical_url: canonical_url}
    end

    test "the canonical URL is the leased fallback on the loopback health path", %{
      canonical_url: canonical_url
    } do
      assert canonical_url == "http://127.0.0.1:#{@actual_port}/health"
    end

    test "REST + SSE (DevServerPresenter) render the fallback port, URL, and shared snapshot id",
         %{snapshot: snapshot, canonical_url: canonical_url} do
      view = DevServerPresenter.view(snapshot)
      # REST and SSE both render via view/1, so they carry the same snapshot id.
      assert view.snapshot_id == @snapshot_id

      [server] = view.servers
      assert server.port == @actual_port
      assert server.actual_port == @actual_port
      assert server.local_url == canonical_url
      assert server.sync_state == "in_sync"
      assert server.source == "contracted_manual"
      assert server.allowed_ports == @allowed_ports
    end

    test "the list_previews tool renders the same fallback port and URL", %{
      snapshot: snapshot,
      canonical_url: canonical_url
    } do
      result = list_previews(snapshot)
      [preview] = result.data.previews
      [server] = preview.servers

      assert server.port == @actual_port
      assert server.local_url == canonical_url
    end

    test "the coding-agent prompt renders the same fallback URL", %{canonical_url: canonical_url} do
      assert PromptBuilder.local_preview_url_for_tests(server_view("ready", @actual_port)) ==
               canonical_url
    end

    test "REST, tool, and prompt agree on the exact same local URL", %{
      snapshot: snapshot,
      canonical_url: canonical_url
    } do
      [rest_server] = DevServerPresenter.view(snapshot).servers
      [tool_server] = list_previews(snapshot).data.previews |> hd() |> Map.fetch!(:servers)
      prompt_url = PromptBuilder.local_preview_url_for_tests(server_view("ready", @actual_port))

      assert rest_server.local_url == canonical_url
      assert tool_server.local_url == canonical_url
      assert prompt_url == canonical_url
    end
  end

  describe "an out-of-lease report never desyncs the snapshot (supersedes 'dock may lag')" do
    test "a report on an out-of-lease port is rejected, never adopted" do
      assert RuntimeReport.evaluate(report(@out_of_lease_port), contract()) ==
               {:error, :port_out_of_range}
    end

    test "a ready server bound outside the lease is surfaced as a conflict, not embedded" do
      {state, reason} = Snapshot.sync_state("ready", @out_of_lease_port, @allowed_ports)
      assert state == :conflict
      assert reason =~ "#{@out_of_lease_port}"

      [server] = DevServerPresenter.view(snapshot("ready", @out_of_lease_port)).servers
      assert server.sync_state == "conflict"
      assert server.sync_reason =~ "outside allowed ports"
    end
  end
end
