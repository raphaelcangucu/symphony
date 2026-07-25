defmodule SymphonyElixir.MobileRpc.Methods.Terminal do
  @moduledoc "Interactive terminal stream and commands over encrypted mobile RPC."

  def modules, do: [__MODULE__.Subscribe, __MODULE__.Command]

  defmodule Subscribe do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.{SessionBridge, TerminalBridge}

    def name, do: "terminal.subscribe"
    def scope, do: :mobile
    def timeout_ms, do: 10_000

    def validate(%{"thread_id" => thread_id, "project_slug" => project_slug} = params)
        when is_integer(thread_id) and thread_id > 0 and is_binary(project_slug) and
               project_slug != "" and map_size(params) == 2,
        do: {:ok, params}

    def validate(_params), do: {:error, :invalid_params}

    def call(%{"thread_id" => thread_id, "project_slug" => project_slug}, context) do
      subscription_id =
        "terminal:" <>
          Integer.to_string(thread_id) <>
          ":" <> Integer.to_string(System.unique_integer([:positive, :monotonic]))

      with connection_pid when is_pid(connection_pid) <- Map.get(context, :connection_pid),
           {:ok, bridge} <-
             TerminalBridge.subscribe(
               connection_pid,
               thread_id,
               project_slug,
               subscription_id
             ) do
        cleanup = fn ->
          if Process.alive?(bridge), do: GenServer.stop(bridge, :normal)
        end

        {:ok, {:subscription, subscription_id, %{"subscription_id" => subscription_id}, cleanup, fn -> SessionBridge.activate(bridge) end}}
      else
        _reason -> {:error, :terminal_subscription_failed}
      end
    end
  end

  defmodule Command do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.{SessionBridge, TerminalBridge}

    @events ~w(input resize)

    def name, do: "terminal.command"
    def scope, do: :mobile
    def timeout_ms, do: 10_000

    def validate(%{"thread_id" => thread_id, "event" => event, "payload" => payload} = params)
        when is_integer(thread_id) and thread_id > 0 and event in @events and
               is_map(payload) and map_size(params) == 3,
        do: {:ok, params}

    def validate(_params), do: {:error, :invalid_params}

    def call(%{"thread_id" => thread_id, "event" => event, "payload" => payload}, context) do
      with connection_pid when is_pid(connection_pid) <- Map.get(context, :connection_pid),
           {:ok, bridge} <- TerminalBridge.lookup(connection_pid, thread_id),
           result <- SessionBridge.command(bridge, event, payload) do
        case result do
          :ok -> {:ok, %{"accepted" => true}}
          {:ok, response} -> {:ok, %{"accepted" => true, "response" => response}}
          {:error, reason} -> {:error, reason}
        end
      else
        _reason -> {:error, :terminal_command_failed}
      end
    end
  end
end
