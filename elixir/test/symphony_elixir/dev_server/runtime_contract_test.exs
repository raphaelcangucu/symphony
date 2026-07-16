defmodule SymphonyElixir.DevServer.RuntimeContractTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.DevServer.RuntimeContract

  defp valid_attrs(overrides \\ %{}) do
    %{
      contract_id: "ctr_abc123",
      revision: 1,
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
    }
    |> Map.merge(overrides)
  end

  describe "new/1" do
    test "builds a valid contract" do
      assert {:ok, %RuntimeContract{} = contract} = RuntimeContract.new(valid_attrs())
      assert contract.version == RuntimeContract.current_version()
      assert contract.source == :managed
      assert contract.allowed_ports == [4300, 4310, 4320]
    end

    test "accepts string source and injects the preferred port into allowed set" do
      assert {:ok, contract} =
               RuntimeContract.new(valid_attrs(%{source: "contracted_manual", allowed_ports: [4310, 4320]}))

      assert contract.source == :contracted_manual
      assert 4300 in contract.allowed_ports
      assert hd(contract.allowed_ports) == 4300
    end

    test "reads string keys" do
      attrs = for {k, v} <- valid_attrs(), into: %{}, do: {Atom.to_string(k), v}
      attrs = Map.put(attrs, "source", "managed")
      assert {:ok, %RuntimeContract{}} = RuntimeContract.new(attrs)
    end

    test "rejects unsupported version" do
      assert {:error, :unsupported_version} = RuntimeContract.new(valid_attrs(%{version: 2}))
    end

    test "rejects a blank contract id" do
      assert {:error, :invalid_contract_id} = RuntimeContract.new(valid_attrs(%{contract_id: ""}))
    end

    test "rejects a non-monotonic revision" do
      assert {:error, :invalid_revision} = RuntimeContract.new(valid_attrs(%{revision: 0}))
    end

    test "rejects an unknown source" do
      assert {:error, :invalid_source} = RuntimeContract.new(valid_attrs(%{source: "wild"}))
    end

    test "rejects an out-of-range preferred port" do
      assert {:error, :invalid_preferred_port} =
               RuntimeContract.new(valid_attrs(%{preferred_port: 70_000, allowed_ports: [70_000]}))
    end

    test "rejects an out-of-range allowed port" do
      assert {:error, :invalid_allowed_ports} =
               RuntimeContract.new(valid_attrs(%{allowed_ports: [4300, 999_999]}))
    end

    test "rejects a blank port env name" do
      assert {:error, :invalid_port_env} = RuntimeContract.new(valid_attrs(%{port_env: ""}))
    end

    test "rejects a missing expiry" do
      assert {:error, :invalid_expiry} = RuntimeContract.new(valid_attrs(%{expires_at: nil}))
    end
  end

  describe "validate/1" do
    test "rejects a hand-built contract whose preferred port is not allowed" do
      {:ok, contract} = RuntimeContract.new(valid_attrs())
      tampered = %{contract | preferred_port: 4300, allowed_ports: [4310, 4320]}
      assert {:error, :preferred_not_allowed} = RuntimeContract.validate(tampered)
    end

    test "rejects an empty allowed set" do
      {:ok, contract} = RuntimeContract.new(valid_attrs())
      assert {:error, :invalid_allowed_ports} = RuntimeContract.validate(%{contract | allowed_ports: []})
    end
  end

  describe "to_env/1" do
    test "serializes every contract env var including the declared port env" do
      {:ok, contract} = RuntimeContract.new(valid_attrs())
      env = RuntimeContract.to_env(contract)

      assert env["SYMPHONY_PREVIEW_CONTRACT"] == "1"
      assert env["SYMPHONY_PREVIEW_CONTRACT_ID"] == "ctr_abc123"
      assert env["SYMPHONY_PREVIEW_CONTRACT_REVISION"] == "1"
      assert env["SYMPHONY_PREVIEW_CONTRACT_SOURCE"] == "managed"
      assert env["SYMPHONY_PREVIEW_PREFERRED_PORT"] == "4300"
      assert env["SYMPHONY_PREVIEW_ALLOWED_PORTS"] == "4300,4310,4320"
      assert env["SYMPHONY_PREVIEW_REPORT_PATH"] == "/tmp/ws/.symphony/preview-report.json"
      assert env["INSPIRE_PORT"] == "4300"
    end
  end

  describe "port_allowed?/2" do
    test "recognizes ports inside and outside the allowed set" do
      {:ok, contract} = RuntimeContract.new(valid_attrs())
      assert RuntimeContract.port_allowed?(contract, 4310)
      refute RuntimeContract.port_allowed?(contract, 59_595)
    end
  end

  describe "expired?/2" do
    test "compares now against the expiry" do
      {:ok, contract} = RuntimeContract.new(valid_attrs(%{expires_at: ~U[2026-07-16 12:00:00.000000Z]}))
      refute RuntimeContract.expired?(contract, ~U[2026-07-16 11:59:59.000000Z])
      assert RuntimeContract.expired?(contract, ~U[2026-07-16 12:00:01.000000Z])
    end
  end
end
