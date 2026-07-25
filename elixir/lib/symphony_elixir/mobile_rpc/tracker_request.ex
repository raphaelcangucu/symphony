defmodule SymphonyElixir.MobileRpc.TrackerRequest do
  @moduledoc false

  @methods ~w(GET POST PATCH DELETE)
  @keys ~w(path method body idempotency_key)

  def validate(%{"path" => path} = params)
      when is_binary(path) and byte_size(path) in 1..2_048 do
    method = Map.get(params, "method", "GET")
    body = Map.get(params, "body")
    idempotency_key = Map.get(params, "idempotency_key")

    if method in @methods and
         (is_nil(body) or is_map(body)) and
         (is_nil(idempotency_key) or
            (is_binary(idempotency_key) and byte_size(idempotency_key) in 1..128)) and
         Enum.all?(Map.keys(params), &(&1 in @keys)) do
      {:ok,
       %{
         "path" => path,
         "method" => method,
         "body" => body,
         "idempotency_key" => idempotency_key
       }}
    else
      {:error, :invalid_params}
    end
  end

  def validate(_params), do: {:error, :invalid_params}

  def call(domain, params, context) do
    bridge = Map.get(context, :tracker_bridge, SymphonyElixir.MobileRpc.TrackerBridge)

    if function_exported?(bridge, :request, 3) do
      bridge.request(domain, params, context)
    else
      bridge.request(domain, params)
    end
  end
end
