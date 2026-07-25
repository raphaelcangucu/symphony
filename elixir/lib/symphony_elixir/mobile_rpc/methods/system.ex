defmodule SymphonyElixir.MobileRpc.Methods.System do
  @moduledoc "Allowlisted host identity, health and lifecycle methods."

  @spec modules() :: [module()]
  def modules do
    [
      SymphonyElixir.MobileRpc.Methods.System.Identity,
      SymphonyElixir.MobileRpc.Methods.System.Health,
      SymphonyElixir.MobileRpc.Methods.System.Capabilities,
      SymphonyElixir.MobileRpc.Methods.System.Heartbeat,
      SymphonyElixir.MobileRpc.Methods.System.Usage,
      SymphonyElixir.MobileRpc.Methods.System.SelfRevoke
    ]
  end

  defmodule Identity do
    @behaviour SymphonyElixir.MobileRpc.Method
    def name, do: "system.identity"
    def scope, do: :mobile
    def timeout_ms, do: 1_000
    def validate(params) when map_size(params) == 0, do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}

    def call(_params, context) do
      {:ok, %{"host_id" => context.host_id, "name" => context.host_name}}
    end
  end

  defmodule Health do
    @behaviour SymphonyElixir.MobileRpc.Method
    def name, do: "system.health"
    def scope, do: :mobile
    def timeout_ms, do: 1_000
    def validate(params) when map_size(params) == 0, do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}
    def call(_params, _context), do: {:ok, %{"status" => "healthy"}}
  end

  defmodule Capabilities do
    @behaviour SymphonyElixir.MobileRpc.Method
    def name, do: "system.capabilities"
    def scope, do: :mobile
    def timeout_ms, do: 1_000
    def validate(params) when map_size(params) == 0, do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}

    def call(_params, context) do
      {:ok,
       %{
         "methods" => context.capabilities,
         "protocol_min" => 1,
         "protocol_max" => 1,
         "heartbeat_interval_ms" => 15_000
       }}
    end
  end

  defmodule Heartbeat do
    @behaviour SymphonyElixir.MobileRpc.Method
    def name, do: "system.heartbeat"
    def scope, do: :mobile
    def timeout_ms, do: 1_000
    def validate(%{"nonce" => nonce} = params) when is_binary(nonce), do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}
    def call(%{"nonce" => nonce}, _context), do: {:ok, %{"nonce" => nonce}}
  end

  defmodule Usage do
    @behaviour SymphonyElixir.MobileRpc.Method
    def name, do: "system.usage"
    def scope, do: :mobile
    def timeout_ms, do: 1_000
    def validate(params) when map_size(params) == 0, do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}

    def call(_params, _context) do
      {:ok,
       %{
         "paired_devices" => length(SymphonyElixir.MobileRpc.Devices.list_paired()),
         "memory_bytes" => :erlang.memory(:total),
         "uptime_ms" => :erlang.statistics(:wall_clock) |> elem(0)
       }}
    end
  end

  defmodule SelfRevoke do
    @behaviour SymphonyElixir.MobileRpc.Method
    def name, do: "devices.self_revoke"
    def scope, do: :mobile
    def timeout_ms, do: 1_000
    def validate(params) when map_size(params) == 0, do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}

    def call(_params, context) do
      :ok = SymphonyElixir.MobileRpc.Devices.revoke(context.device_id)
      {:ok, %{"revoked" => true}}
    end
  end
end
