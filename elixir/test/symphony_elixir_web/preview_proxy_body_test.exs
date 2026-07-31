defmodule SymphonyElixirWeb.PreviewProxyBodyTest do
  @moduledoc """
  Regression test guarding the reverse-proxy request-body forwarding for
  public preview hosts.

  `Plug.Parsers` consumes the request body. If it runs before
  `SymphonyElixirWeb.PublicHostPlug`, the proxied request reaches the upstream
  dev server with a `Content-Length` header but an empty payload, which makes
  the upstream hang on POSTs (observed as 504s and "Invalid request
  (Unexpected EOF)" from PHP's built-in server on Livewire updates). The plug
  must therefore proxy preview-host traffic before the body is parsed.
  """

  use ExUnit.Case, async: false

  import Phoenix.ConnTest
  import Plug.Conn

  alias SymphonyElixir.PublicRouting
  alias SymphonyElixir.Workflow

  @endpoint SymphonyElixirWeb.Endpoint
  @namespace "octocat"
  @base_domain "tracker.cods.dev"
  @preview_host "app-1-back.octocat.tracker.cods.dev"

  defmodule EchoUpstream do
    @moduledoc false
    import Plug.Conn

    def init(opts), do: opts

    def call(conn, opts) do
      {:ok, body, conn} = read_body(conn)
      Agent.update(Keyword.fetch!(opts, :sink), fn _ -> body end)
      send_resp(conn, 200, "ok")
    end
  end

  setup do
    start_supervised!(SymphonyElixirWeb.Endpoint)
    ensure_public_routing_started!()

    sink = start_supervised!(%{id: :body_sink, start: {Agent, :start_link, [fn -> :no_request end]}})

    upstream_port = available_port()

    start_supervised!({Bandit, plug: {EchoUpstream, sink: sink}, scheme: :http, ip: {127, 0, 0, 1}, port: upstream_port})

    workflow_root =
      Path.join(System.tmp_dir!(), "symphony-preview-proxy-#{System.unique_integer([:positive])}")

    File.mkdir_p!(workflow_root)
    workflow_file = Path.join(workflow_root, "WORKFLOW.md")
    enable_public_tunnel!(workflow_file)

    PublicRouting.register(@preview_host, upstream_port)

    on_exit(fn ->
      PublicRouting.unregister(@preview_host)
      Workflow.clear_workflow_file_path()
      File.rm_rf(workflow_root)
    end)

    {:ok, sink: sink, workflow_file: workflow_file}
  end

  test "forwards the full JSON request body to the upstream dev server", %{sink: sink} do
    payload = Jason.encode!(%{"_token" => "abc", "calls" => [%{"method" => "authenticate"}]})

    conn =
      :post
      |> build_conn("/livewire/update", payload)
      |> put_req_header("content-type", "application/json")
      |> Map.put(:host, @preview_host)

    conn = @endpoint.call(conn, @endpoint.init([]))

    assert conn.halted
    assert conn.status == 200
    assert Agent.get(sink, & &1) == payload
  end

  test "forwards registered preview hosts when the global workflow tunnel is disabled", %{
    sink: sink,
    workflow_file: workflow_file
  } do
    disable_public_tunnel!(workflow_file)
    payload = Jason.encode!(%{"_token" => "abc", "calls" => [%{"method" => "authenticate"}]})

    conn =
      :post
      |> build_conn("/livewire/update", payload)
      |> put_req_header("content-type", "application/json")
      |> Map.put(:host, @preview_host)

    conn = @endpoint.call(conn, @endpoint.init([]))

    assert conn.halted
    assert conn.status == 200
    assert Agent.get(sink, & &1) == payload
  end

  defp enable_public_tunnel!(workflow_file) do
    front_matter =
      "github:\n  repo: acme/app\n" <>
        "public_tunnel:\n  enabled: true\n  namespace: #{@namespace}\n  base_domain: #{@base_domain}\n"

    File.write!(workflow_file, "---\n" <> front_matter <> "---\n")
    Workflow.set_workflow_file_path(workflow_file)
    reload_workflow_store!()
    :ok
  end

  defp disable_public_tunnel!(workflow_file) do
    front_matter =
      "github:\n  repo: acme/app\n" <>
        "public_tunnel:\n  enabled: false\n  namespace: #{@namespace}\n  base_domain: #{@base_domain}\n"

    File.write!(workflow_file, "---\n" <> front_matter <> "---\n")
    Workflow.set_workflow_file_path(workflow_file)
    reload_workflow_store!()
    :ok
  end

  defp available_port do
    Enum.find_value(4100..4199, fn port ->
      case :gen_tcp.listen(port, [:binary, ip: {127, 0, 0, 1}, active: false, reuseaddr: true]) do
        {:ok, socket} ->
          :ok = :gen_tcp.close(socket)
          port

        {:error, _reason} ->
          nil
      end
    end) || raise "no available preview test port"
  end

  defp ensure_public_routing_started! do
    case Process.whereis(SymphonyElixir.PublicRouting) do
      nil -> start_supervised!(SymphonyElixir.PublicRouting)
      _ -> :ok
    end
  end

  defp reload_workflow_store! do
    :ok
  end
end
