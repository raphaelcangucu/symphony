defmodule Mix.Tasks.Symphony.Tunnel.Dns do
  @shortdoc "Ensure Cloudflare CNAMEs for the public preview tunnel namespace"
  @moduledoc """
  Ensures the apex + wildcard CNAME records for the resolved public-tunnel
  namespace point at `<CLOUDFLARE_TUNNEL_ID>.cfargotunnel.com`.

  Reads from the environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_TUNNEL_ID,
  CLOUDFLARE_ZONE_NAME (and optional CLOUDFLARE_ZONE_ID).
  """

  use Mix.Task

  alias SymphonyElixir.Cloudflare.Dns
  alias SymphonyElixir.Config
  alias SymphonyElixir.PublicRouting

  @impl true
  def run(_args) do
    Mix.Task.run("app.start")

    api_token =
      System.get_env("CLOUDFLARE_API_TOKEN") || Mix.raise("CLOUDFLARE_API_TOKEN is required")

    tunnel_id =
      System.get_env("CLOUDFLARE_TUNNEL_ID") || Mix.raise("CLOUDFLARE_TUNNEL_ID is required")

    zone_name =
      System.get_env("CLOUDFLARE_ZONE_NAME") || Mix.raise("CLOUDFLARE_ZONE_NAME is required")

    zone_id = System.get_env("CLOUDFLARE_ZONE_ID")

    namespace =
      case PublicRouting.resolve_namespace() do
        {:ok, ns} ->
          ns

        {:error, _} ->
          Mix.raise("Cannot resolve namespace (set PUBLIC_NAMESPACE or configure a GitHub token)")
      end

    base_domain = Config.public_tunnel_base_domain()

    records =
      Dns.build_cname_records(namespace: namespace, base_domain: base_domain, tunnel_id: tunnel_id)

    case Dns.ensure_records(records, api_token: api_token, zone_name: zone_name, zone_id: zone_id) do
      {:ok, results} ->
        Enum.each(results, fn %{name: name, action: action} ->
          Mix.shell().info("#{action}: #{name}")
        end)

      {:error, reason} ->
        Mix.raise("Cloudflare DNS update failed: #{inspect(reason)}")
    end
  end
end
