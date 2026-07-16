defmodule SymphonyElixir.DevServer.RuntimeReportTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServer.{RuntimeContract, RuntimeReport}

  defp contract(overrides \\ %{}) do
    {:ok, contract} =
      RuntimeContract.new(
        Map.merge(
          %{
            contract_id: "ctr_abc123",
            revision: 3,
            project_slug: "advising",
            issue_identifier: "1131",
            server_slug: "advising",
            source: :managed,
            preferred_port: 4300,
            allowed_ports: [4300, 4310, 4320],
            report_path: "/tmp/ws/.symphony/preview-report.json",
            ready_probe: "http",
            ready_path: "/",
            url_path: "/",
            port_env: "INSPIRE_PORT",
            expires_at: ~U[2026-07-16 12:00:00.000000Z]
          },
          overrides
        )
      )

    contract
  end

  defp report_map(overrides \\ %{}) do
    Map.merge(
      %{
        "version" => 1,
        "contract_id" => "ctr_abc123",
        "revision" => 3,
        "server_slug" => "advising",
        "state" => "ready",
        "selected_port" => 4310,
        "actual_port" => 4310,
        "pid" => 4242,
        "session_name" => "sym-dev-advising-1131-advising",
        "reported_at" => "2026-07-16T11:59:00.000000Z",
        "error" => nil
      },
      overrides
    )
  end

  describe "parse/1" do
    test "parses a valid JSON report" do
      {:ok, json} = Jason.encode(report_map())
      assert {:ok, %RuntimeReport{contract_id: "ctr_abc123", actual_port: 4310, state: "ready"}} = RuntimeReport.parse(json)
    end

    test "rejects malformed JSON" do
      assert {:error, :invalid_json} = RuntimeReport.parse("{not-json")
    end

    test "rejects a non-object JSON document" do
      assert {:error, :invalid_report_shape} = RuntimeReport.parse("[1,2,3]")
    end
  end

  describe "from_map/1" do
    test "reads string-keyed maps and coerces string ports" do
      assert {:ok, report} = RuntimeReport.from_map(report_map(%{"actual_port" => "4320"}))
      assert report.actual_port == 4320
    end

    test "rejects an unsupported version" do
      assert {:error, :unsupported_version} = RuntimeReport.from_map(report_map(%{"version" => 9}))
    end

    test "rejects an unknown lifecycle state" do
      assert {:error, :invalid_state} = RuntimeReport.from_map(report_map(%{"state" => "spinning"}))
    end

    test "rejects a blank contract id" do
      assert {:error, :invalid_contract_id} = RuntimeReport.from_map(report_map(%{"contract_id" => ""}))
    end
  end

  describe "evaluate/2" do
    test "accepts a ready in-range report that echoes the contract" do
      {:ok, report} = RuntimeReport.from_map(report_map())
      assert {:ok, 4310} = RuntimeReport.evaluate(report, contract())
    end

    test "rejects a contract id mismatch" do
      {:ok, report} = RuntimeReport.from_map(report_map(%{"contract_id" => "ctr_other"}))
      assert {:error, :contract_id_mismatch} = RuntimeReport.evaluate(report, contract())
    end

    test "rejects a mismatched server slug" do
      {:ok, report} = RuntimeReport.from_map(report_map(%{"server_slug" => "frontend"}))
      assert {:error, :server_mismatch} = RuntimeReport.evaluate(report, contract())
    end

    test "rejects a stale revision" do
      {:ok, report} = RuntimeReport.from_map(report_map(%{"revision" => 2}))
      assert {:error, :stale_revision} = RuntimeReport.evaluate(report, contract())
    end

    test "rejects a future revision" do
      {:ok, report} = RuntimeReport.from_map(report_map(%{"revision" => 4}))
      assert {:error, :revision_mismatch} = RuntimeReport.evaluate(report, contract())
    end

    test "rejects an out-of-range actual port" do
      {:ok, report} = RuntimeReport.from_map(report_map(%{"actual_port" => 59_595}))
      assert {:error, :port_out_of_range} = RuntimeReport.evaluate(report, contract())
    end

    test "rejects an explicit error state" do
      {:ok, report} = RuntimeReport.from_map(report_map(%{"state" => "error", "error" => "boom"}))
      assert {:error, :reported_error} = RuntimeReport.evaluate(report, contract())
    end

    test "reports a not-yet-ready state" do
      {:ok, report} = RuntimeReport.from_map(report_map(%{"state" => "starting", "actual_port" => nil}))
      assert {:error, :not_ready} = RuntimeReport.evaluate(report, contract())
    end

    test "rejects a ready report with no actual port" do
      {:ok, report} = RuntimeReport.from_map(report_map(%{"actual_port" => nil}))
      assert {:error, :missing_actual_port} = RuntimeReport.evaluate(report, contract())
    end
  end

  describe "to_map/1 and encode/1" do
    test "round-trips through JSON" do
      {:ok, report} = RuntimeReport.from_map(report_map())
      {:ok, json} = RuntimeReport.encode(report)
      assert {:ok, ^report} = RuntimeReport.parse(json)
    end
  end
end
