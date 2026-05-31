defmodule SymphonyElixir.Cloudflare.DnsTest do
  use ExUnit.Case, async: true

  alias SymphonyElixir.Cloudflare.Dns

  test "build_cname_records/1 returns apex and wildcard records" do
    assert Dns.build_cname_records(namespace: "octocat", base_domain: "tracker.cods.dev", tunnel_id: "tunnel-123") ==
             [
               %{name: "octocat.tracker.cods.dev", content: "tunnel-123.cfargotunnel.com", type: "CNAME", proxied: true},
               %{name: "*.octocat.tracker.cods.dev", content: "tunnel-123.cfargotunnel.com", type: "CNAME", proxied: true}
             ]
  end

  test "ensure_records/2 creates when absent (POST) resolving zone by name" do
    parent = self()

    transport = fn method, path, opts ->
      send(parent, {:call, method, path, opts})

      cond do
        method == "GET" and String.ends_with?(path, "/zones") -> %{"success" => true, "result" => [%{"id" => "zone-1"}]}
        method == "GET" and String.contains?(path, "/dns_records") -> %{"success" => true, "result" => []}
        true -> %{"success" => true, "result" => %{"id" => "rec-1"}}
      end
    end

    records = Dns.build_cname_records(namespace: "octocat", base_domain: "tracker.cods.dev", tunnel_id: "tunnel-123")

    assert {:ok, results} = Dns.ensure_records(records, api_token: "tok", zone_name: "cods.dev", transport: transport)
    assert Enum.all?(results, &(&1.action == "created"))
    assert_received {:call, "POST", _path, _opts}
  end

  test "ensure_records/2 updates when present (PUT) with explicit zone_id" do
    transport = fn method, path, _opts ->
      if method == "GET" and String.contains?(path, "/dns_records") do
        %{"result" => [%{"id" => "rec-existing"}]}
      else
        %{"result" => %{"id" => "rec-existing"}}
      end
    end

    records = Dns.build_cname_records(namespace: "octocat", base_domain: "tracker.cods.dev", tunnel_id: "tunnel-123")

    assert {:ok, results} = Dns.ensure_records(records, api_token: "tok", zone_id: "zone-xyz", transport: transport)
    assert Enum.all?(results, &(&1.action == "updated"))
  end

  test "ensure_records/2 returns error when zone cannot be resolved by name" do
    transport = fn "GET", path, _opts ->
      if String.ends_with?(path, "/zones"), do: %{"result" => []}, else: %{"result" => []}
    end

    records = Dns.build_cname_records(namespace: "octocat", base_domain: "tracker.cods.dev", tunnel_id: "t")

    assert {:error, {:zone_not_found, "cods.dev"}} =
             Dns.ensure_records(records, api_token: "tok", zone_name: "cods.dev", transport: transport)
  end
end
