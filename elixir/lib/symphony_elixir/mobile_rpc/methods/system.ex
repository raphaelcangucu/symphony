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
    @impl true
    def name, do: "system.identity"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 1_000
    @impl true
    def validate(params) when map_size(params) == 0, do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}

    @impl true
    def call(_params, context) do
      {:ok, %{"host_id" => context.host_id, "name" => context.host_name}}
    end
  end

  defmodule Health do
    @behaviour SymphonyElixir.MobileRpc.Method
    @impl true
    def name, do: "system.health"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 1_000
    @impl true
    def validate(params) when map_size(params) == 0, do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}
    @impl true
    def call(_params, _context), do: {:ok, %{"status" => "healthy"}}
  end

  defmodule Capabilities do
    @behaviour SymphonyElixir.MobileRpc.Method
    @impl true
    def name, do: "system.capabilities"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 1_000
    @impl true
    def validate(params) when map_size(params) == 0, do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}

    @impl true
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
    @impl true
    def name, do: "system.heartbeat"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 1_000
    @impl true
    def validate(%{"nonce" => nonce} = params) when is_binary(nonce), do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}
    @impl true
    def call(%{"nonce" => nonce}, _context), do: {:ok, %{"nonce" => nonce}}
  end

  defmodule Usage do
    @behaviour SymphonyElixir.MobileRpc.Method
    @impl true
    def name, do: "system.usage"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 1_000
    @impl true
    def validate(params) when map_size(params) == 0, do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}

    @impl true
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

    @impl true
    def name, do: "devices.list"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 1_000
    @impl true
    def validate(params) when map_size(params) == 0, do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}

    @impl true
    def call(_params, context) do
      devices =
        Devices.list_paired()
        |> Enum.map(&Devices.public_metadata(&1, context.device_id))

      {:ok, %{"devices" => devices}}
    end
  end

  defmodule RevokeDevice do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.Devices

    @impl true
    def name, do: "devices.revoke"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 1_000

    @impl true
    def validate(%{"device_id" => device_id} = params)
        when is_binary(device_id) and device_id != "" and map_size(params) == 1,
        do: {:ok, params}

    def validate(_params), do: {:error, :invalid_params}

    @impl true
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
    @impl true
    def name, do: "devices.self_revoke"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 1_000
    @impl true
    def validate(params) when map_size(params) == 0, do: {:ok, params}
    def validate(_params), do: {:error, :invalid_params}

    @impl true
    def call(_params, context) do
      :ok = SymphonyElixir.MobileRpc.Devices.revoke(context.device_id)
      {:ok, %{"revoked" => true}}
    end
  end

  defmodule Tracker do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.TrackerRequest

    @impl true
    def name, do: "system.tracker"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 30_000
    @impl true
    defdelegate validate(params), to: TrackerRequest
    @impl true
    def call(params, context), do: TrackerRequest.call(:system, params, context)
  end
end
