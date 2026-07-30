defmodule SymphonyElixir.MobileRpc.Methods.Sessions do
  @moduledoc "Allowlisted session operations over the encrypted mobile channel."

  @spec modules() :: [module()]
  def modules, do: [__MODULE__.Request, __MODULE__.Subscribe, __MODULE__.Command]

  defmodule Request do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.TrackerRequest

    @impl true
    def name, do: "sessions.request"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 30_000
    @impl true
    defdelegate validate(params), to: TrackerRequest
    @impl true
    def call(params, context), do: TrackerRequest.call(:sessions, params, context)
  end

  defmodule Subscribe do
    @behaviour SymphonyElixir.MobileRpc.Method
    alias SymphonyElixir.MobileRpc.SessionBridge

    @impl true
    def name, do: "sessions.subscribe"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 5_000

    @impl true
    def validate(%{"thread_id" => thread_id} = params)
        when is_integer(thread_id) and thread_id > 0 and map_size(params) == 1,
        do: {:ok, params}

    def validate(_params), do: {:error, :invalid_params}

    @impl true
    def call(%{"thread_id" => thread_id}, context) do
      subscription_id =
        "session:" <>
          Integer.to_string(thread_id) <>
          ":" <> Integer.to_string(System.unique_integer([:positive, :monotonic]))

      with connection_pid when is_pid(connection_pid) <- Map.get(context, :connection_pid),
           {:ok, bridge} <-
             SessionBridge.subscribe_channel(
               connection_pid,
               {:session, thread_id},
               subscription_id,
               thread_id: thread_id,
               emit_joined: true
             ) do
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
      kill_tool
      set_turn_preferences
      set_goal_mode
      goal_status
      goal_pause
      goal_resume
      goal_clear
      goal_set_objective
    )

    @impl true
    def name, do: "sessions.command"
    @impl true
    def scope, do: :mobile
    @impl true
    def timeout_ms, do: 30_000

    @impl true
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

    @impl true
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
