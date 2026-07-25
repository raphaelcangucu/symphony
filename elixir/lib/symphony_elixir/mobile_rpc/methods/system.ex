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
      SymphonyElixir.MobileRpc.Methods.System.ListDevices,
      SymphonyElixir.MobileRpc.Methods.System.RevokeDevice,
      SymphonyElixir.MobileRpc.Methods.System.SelfRevoke,
      SymphonyElixir.MobileRpc.Methods.System.Tracker
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

  defmodule ListDevices do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.Devices

    def name, do: "devices.list"
    def scope, do: :mobile
    def timeout_ms, do: 1_000
    def validate(params) when map_size(params) == 0, do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}

    def call(_params, context) do
      devices =
        Devices.list_paired()
        |> Enum.map(fn device ->
          %{
            "device_id" => device.device_id,
            "name" => device.name,
            "scope" => device.scope,
            "paired_at" => iso8601(device.paired_at),
            "last_seen_at" => iso8601(device.last_seen_at),
            "protocol_version" => device.protocol_version,
            "current" => device.device_id == context.device_id
          }
        end)

      {:ok, %{"devices" => devices}}
    end

    defp iso8601(nil), do: nil
    defp iso8601(%DateTime{} = value), do: DateTime.to_iso8601(value)
  end

  defmodule RevokeDevice do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.Devices

    def name, do: "devices.revoke"
    def scope, do: :mobile
    def timeout_ms, do: 1_000

    def validate(%{"device_id" => device_id} = params)
        when is_binary(device_id) and device_id != "" and map_size(params) == 1,
        do: {:ok, params}

    def validate(_params), do: {:error, :invalid_params}

    def call(%{"device_id" => device_id}, %{device_id: device_id}),
      do: {:error, :use_self_revoke}

    def call(%{"device_id" => device_id}, _context) do
      with {:ok, _device} <- Devices.get_paired(device_id),
           :ok <- Devices.revoke(device_id) do
        {:ok, %{"revoked" => true}}
      end
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

  defmodule Tracker do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.TrackerRequest

    def name, do: "system.tracker"
    def scope, do: :mobile
    def timeout_ms, do: 30_000
    defdelegate validate(params), to: TrackerRequest
    def call(params, context), do: TrackerRequest.call(:system, params, context)
  end
end
