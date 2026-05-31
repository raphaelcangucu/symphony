defmodule SymphonyElixir.Cloudflare.Dns do
  @moduledoc """
  Minimal Cloudflare DNS API client to ensure the apex + wildcard CNAME records
  pointing the public tunnel namespace at `<tunnel-id>.cfargotunnel.com`.
  Ported from the Distribution Machine `cloudflare_dns.py`.
  """

  @base_url "https://api.cloudflare.com/client/v4"

  @type record :: %{name: String.t(), content: String.t(), type: String.t(), proxied: boolean()}

  @spec build_cname_records(keyword()) :: [record()]
  def build_cname_records(opts) do
    namespace = Keyword.fetch!(opts, :namespace)
    base_domain = Keyword.fetch!(opts, :base_domain)
    tunnel_id = Keyword.fetch!(opts, :tunnel_id)
    target = "#{tunnel_id}.cfargotunnel.com"

    [
      %{name: "#{namespace}.#{base_domain}", content: target, type: "CNAME", proxied: true},
      %{name: "*.#{namespace}.#{base_domain}", content: target, type: "CNAME", proxied: true}
    ]
  end

  @spec ensure_records([record()], keyword()) :: {:ok, [map()]} | {:error, term()}
  def ensure_records(records, opts) do
    transport = Keyword.get(opts, :transport, &request_json/3)
    api_token = Keyword.fetch!(opts, :api_token)

    with {:ok, zone_id} <- resolve_zone_id(opts, transport, api_token) do
      results = Enum.map(records, &ensure_one(&1, zone_id, transport, api_token))
      {:ok, results}
    end
  end

  defp ensure_one(record, zone_id, transport, api_token) do
    opts = [api_token: api_token, query: %{"type" => "CNAME", "name" => record.name}]

    case call(transport, "GET", "/zones/#{zone_id}/dns_records", opts) do
      %{"result" => [%{"id" => id} | _]} ->
        call(transport, "PUT", "/zones/#{zone_id}/dns_records/#{id}", api_token: api_token, payload: record)
        %{name: record.name, action: "updated"}

      _ ->
        call(transport, "POST", "/zones/#{zone_id}/dns_records", api_token: api_token, payload: record)
        %{name: record.name, action: "created"}
    end
  end

  defp resolve_zone_id(opts, transport, api_token) do
    case Keyword.get(opts, :zone_id) do
      id when is_binary(id) and id != "" ->
        {:ok, id}

      _ ->
        zone_name = Keyword.fetch!(opts, :zone_name)

        case call(transport, "GET", "/zones", api_token: api_token, query: %{"name" => zone_name}) do
          %{"result" => [%{"id" => id} | _]} -> {:ok, id}
          _ -> {:error, {:zone_not_found, zone_name}}
        end
    end
  end

  defp call(transport, method, path, opts), do: transport.(method, path, opts)

  defp request_json(method, path, opts) do
    api_token = Keyword.fetch!(opts, :api_token)
    query = Keyword.get(opts, :query)
    payload = Keyword.get(opts, :payload)

    url = @base_url <> path <> if(query, do: "?" <> URI.encode_query(query), else: "")

    req_opts =
      [
        method: method |> String.downcase() |> String.to_atom(),
        url: url,
        headers: [{"authorization", "Bearer #{api_token}"}],
        retry: false
      ]

    req_opts = if payload, do: Keyword.put(req_opts, :json, payload), else: req_opts

    case Req.request(req_opts) do
      {:ok, %{body: body}} when is_map(body) -> body
      {:ok, %{body: body}} -> Jason.decode!(body)
      {:error, reason} -> %{"success" => false, "errors" => [inspect(reason)]}
    end
  end
end
