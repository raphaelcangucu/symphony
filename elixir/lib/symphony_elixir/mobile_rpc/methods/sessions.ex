defmodule SymphonyElixir.MobileRpc.Methods.Sessions do
  @moduledoc "Allowlisted session operations over the encrypted mobile channel."

  def modules, do: [__MODULE__.Request, __MODULE__.Subscribe, __MODULE__.Command]

  defmodule Request do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.TrackerRequest

    def name, do: "sessions.request"
    def scope, do: :mobile
    def timeout_ms, do: 30_000
    defdelegate validate(params), to: TrackerRequest
    def call(params, context), do: TrackerRequest.call(:sessions, params, context)
  end

  defmodule Subscribe do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.SessionBridge

    def name, do: "sessions.subscribe"
    def scope, do: :mobile
    def timeout_ms, do: 5_000

    def validate(%{"thread_id" => thread_id} = params)
        when is_integer(thread_id) and thread_id > 0 and map_size(params) == 1,
        do: {:ok, params}

    def validate(_params), do: {:error, :invalid_params}

    def call(%{"thread_id" => thread_id}, context) do
      subscription_id =
        "session:" <>
          Integer.to_string(thread_id) <>
          ":" <> Integer.to_string(System.unique_integer([:positive, :monotonic]))

      with connection_pid when is_pid(connection_pid) <- Map.get(context, :connection_pid),
           {:ok, bridge} <-
             SessionBridge.subscribe(connection_pid, thread_id, subscription_id) do
        cleanup = fn ->
          if Process.alive?(bridge), do: GenServer.stop(bridge, :normal)
        end

        activate = fn -> SessionBridge.activate(bridge) end

        {:ok, {:subscription, subscription_id, %{"subscription_id" => subscription_id}, cleanup, activate}}
      else
        _reason -> {:error, :session_subscription_failed}
      end
    end
  end

  defmodule Command do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.SessionBridge

    @events ~w(
      send_message
      sync_history
      submit_approval
      submit_user_input
      stop_turn
      resume_turn
    )

    def name, do: "sessions.command"
    def scope, do: :mobile
    def timeout_ms, do: 30_000

    def validate(
          %{
            "thread_id" => thread_id,
            "event" => event,
            "payload" => payload
          } = params
        )
        when is_integer(thread_id) and thread_id > 0 and event in @events and
               is_map(payload) and map_size(params) == 3,
        do: {:ok, params}

    def validate(_params), do: {:error, :invalid_params}

    def call(%{"thread_id" => thread_id, "event" => event, "payload" => payload}, context) do
      with connection_pid when is_pid(connection_pid) <- Map.get(context, :connection_pid),
           {:ok, bridge} <- SessionBridge.lookup(connection_pid, thread_id),
           result when result in [:ok] or elem(result, 0) == :ok <-
             SessionBridge.command(bridge, event, payload) do
        case result do
          :ok -> {:ok, %{"accepted" => true}}
          {:ok, response} -> {:ok, %{"accepted" => true, "response" => response}}
        end
      else
        {:error, reason} -> {:error, reason}
        _reason -> {:error, :session_command_failed}
      end
    end
  end
end
