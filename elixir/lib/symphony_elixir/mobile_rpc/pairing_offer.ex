defmodule SymphonyElixir.MobileRpc.PairingOffer do
  @moduledoc "Creates and decodes versioned QR/deep-link offers for direct host pairing."

  alias SymphonyElixir.MobileRpc.{Devices, HostIdentity}

  @protocol_version 1

  @spec generate(String.t(), String.t(), String.t()) ::
          {:ok, %{url: String.t(), offer: map()}} | {:error, term()}
  def generate(endpoint, host_name, device_name)
      when is_binary(endpoint) and is_binary(host_name) and is_binary(device_name) do
    with {:ok, normalized_endpoint} <- normalize_endpoint(endpoint),
         {:ok, identity} <- HostIdentity.get_or_create(host_name),
         {:ok, %{device: device, token: token}} <- Devices.create_pairing(device_name) do
      offer = %{
        "v" => 1,
        "endpoint" => normalized_endpoint,
        "host_id" => identity.host_id,
        "host_name" => identity.name,
        "host_public_key" => Base.url_encode64(identity.public_key, padding: false),
        "device_id" => device.device_id,
        "device_token" => token,
        "scope" => "mobile",
        "protocol_min" => @protocol_version,
        "protocol_max" => @protocol_version
      }

      code = offer |> Jason.encode!() |> Base.url_encode64(padding: false)
      {:ok, %{url: "symphony://pair?" <> URI.encode_query(%{"code" => code}), offer: offer}}
    end
  end

  @spec decode(String.t()) :: {:ok, map()} | {:error, atom()}
  def decode(url) when is_binary(url) do
    parsed = URI.parse(url)

    with true <- parsed.scheme == "symphony" and parsed.host == "pair",
         query when is_binary(query) <- parsed.query,
         %{"code" => code} = params when map_size(params) == 1 <- URI.decode_query(query),
         {:ok, json} <- Base.url_decode64(code, padding: false),
         {:ok, %{} = offer} <- Jason.decode(json) do
      {:ok, offer}
    else
      _reason -> {:error, :invalid_pairing_offer}
    end
  rescue
    _error -> {:error, :invalid_pairing_offer}
  end

  def decode(_url), do: {:error, :invalid_pairing_offer}

  defp normalize_endpoint(endpoint) do
    parsed = endpoint |> String.trim() |> URI.parse()

    cond do
      parsed.scheme not in ["ws", "wss"] ->
        {:error, :unsupported_endpoint_scheme}

      is_nil(parsed.host) or parsed.host == "" ->
        {:error, :endpoint_missing_host}

      is_binary(parsed.userinfo) and parsed.userinfo != "" ->
        {:error, :endpoint_contains_credentials}

      is_binary(parsed.query) or is_binary(parsed.fragment) ->
        {:error, :endpoint_contains_query_or_fragment}

      true ->
        {:ok, URI.to_string(parsed)}
    end
  end
end
